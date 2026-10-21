"""Caminho completo da Fase 2: foto ► serviço de visão ► API ► painel, com detector falso."""

from datetime import timedelta
from io import BytesIO

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")
pytest.importorskip("onnxruntime")

import httpx  # noqa: E402

from giro.api.cliente_visao import ClienteVisao  # noqa: E402
from giro.banco import agora  # noqa: E402
from giro.visao import servico as modulo_servico  # noqa: E402
from giro.visao.detector import Pessoa  # noqa: E402
from giro.visao.servico import ConfigVisao, criar_app  # noqa: E402
from tests.conftest import TOKEN_CAMERA, TOKEN_CAMERA_OUTRO  # noqa: E402

SEGREDO = "segredo-interno-de-teste"
MESA_1 = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]]
MESA_2 = [[0.6, 0.1], [0.9, 0.1], [0.9, 0.4], [0.6, 0.4]]


class DetectorFalso:
    """Devolve sempre as mesmas pessoas: duas sentadas na mesa 1 e o garçom em pé ao lado."""

    def __init__(self) -> None:
        self.chamadas = 0
        self.pessoas = [
            Pessoa(0.15, 0.2, 0.22, 0.3, 0.9, 1.2),
            Pessoa(0.3, 0.2, 0.37, 0.35, 0.9, 1.3),
            Pessoa(0.42, 0.05, 0.47, 0.38, 0.9, 3.0),
        ]

    def detectar(self, imagem, limiar=0.35):
        self.chamadas += 1
        return [p for p in self.pessoas if p.confianca >= limiar]


def jpeg(largura=320, altura=240) -> bytes:
    saida = BytesIO()
    Image.new("RGB", (largura, altura), (120, 90, 60)).save(saida, format="JPEG")
    return saida.getvalue()


@pytest.fixture
def detector():
    return DetectorFalso()


@pytest.fixture
def visao(app, cliente, detector, como):
    """Serviço de visão de teste ligado na API de teste, e a API ligada nele."""
    gerente = como("gerente@cantina.demo")
    camera_id = next(c["id"] for c in gerente.get("/api/cameras").json())
    mesas = {m["numero"]: m["id"] for m in gerente.get("/api/mesas").json()}
    for numero, poligono in ((1, MESA_1), (2, MESA_2)):
        resposta = gerente.patch(
            f"/api/mesas/{mesas[numero]}", json={"camera_id": camera_id, "poligono": poligono}
        )
        assert resposta.status_code == 200, resposta.text

    servico = criar_app(
        ConfigVisao(segredo=SEGREDO, cache_config_seg=0),
        detector=detector,
        cliente_api=TestClient(app),
    )
    cliente_visao = TestClient(servico)
    app.state.visao = ClienteVisao(
        app.state.config.model_copy(update={"visao_segredo": SEGREDO}), cliente=cliente_visao
    )
    return cliente_visao, camera_id


def enviar(cliente_visao, em=None, token=TOKEN_CAMERA, corpo=None):
    cabecalhos = {"authorization": f"Bearer {token}", "content-type": "image/jpeg"}
    if em is not None:
        cabecalhos["x-giro-em"] = em.isoformat()
    return cliente_visao.post("/visao/quadros", content=corpo or jpeg(), headers=cabecalhos)


def test_foto_vira_contagem_por_mesa_e_mesa_ocupa_no_painel(visao, como):
    cliente_visao, _ = visao
    inicio = agora() - timedelta(minutes=5)
    for i in range(3):  # 20 s vendo gente sentada confirma a ocupação
        resposta = enviar(cliente_visao, em=inicio + timedelta(seconds=10 * i))
        assert resposta.status_code == 200, resposta.text
    assert resposta.json() == {
        "pessoas": 3,
        "mesas": [
            {"mesa": 1, "sentados": 2, "em_pe": 1},
            {"mesa": 2, "sentados": 0, "em_pe": 0},
        ],
    }
    salao = como("gerente@cantina.demo").get("/api/salao").json()
    mesa_1 = next(m for m in salao["mesas"] if m["numero"] == 1)
    assert mesa_1["estado"] == "aguardando"
    assert mesa_1["pessoas"] == 2
    assert salao["cameras"][0]["ultima_observacao_em"] is not None


def test_token_errado_nem_chega_no_detector(visao, detector):
    cliente_visao, _ = visao
    assert enviar(cliente_visao, token="cam_inventado").status_code == 401
    assert enviar(cliente_visao, token="sem-prefixo").status_code == 401
    assert detector.chamadas == 0


def test_arquivo_que_nao_e_foto_e_recusado(visao):
    cliente_visao, _ = visao
    assert enviar(cliente_visao, corpo=b"isto nao e uma foto").status_code == 422


def test_foto_grande_demais_e_recusada(app, cliente, detector):
    servico = criar_app(
        ConfigVisao(tamanho_max_mb=0.001), detector=detector, cliente_api=TestClient(app)
    )
    resposta = enviar(TestClient(servico), corpo=jpeg(800, 600))
    assert resposta.status_code == 413
    assert detector.chamadas == 0


def test_foto_em_pedacos_sem_tamanho_declarado_tambem_tem_limite(app, cliente, detector):
    servico = criar_app(
        ConfigVisao(tamanho_max_mb=0.001), detector=detector, cliente_api=TestClient(app)
    )
    pedacos = iter([b"x" * 600] * 10)  # 6 KB enviados em partes, sem content-length
    resposta = TestClient(servico).post(
        "/visao/quadros",
        content=pedacos,
        headers={"authorization": f"Bearer {TOKEN_CAMERA}", "content-type": "image/jpeg"},
    )
    assert resposta.status_code == 413
    assert detector.chamadas == 0


def test_foto_com_pixels_demais_e_recusada_antes_de_abrir(app, cliente, detector):
    servico = criar_app(
        ConfigVisao(pixels_max=10_000), detector=detector, cliente_api=TestClient(app)
    )
    resposta = enviar(TestClient(servico), corpo=jpeg(320, 240))
    assert resposta.status_code == 413
    assert detector.chamadas == 0


def test_so_aceita_jpeg_ou_png(visao, detector):
    cliente_visao, _ = visao
    bmp = BytesIO()
    Image.new("RGB", (32, 24)).save(bmp, format="BMP")
    assert enviar(cliente_visao, corpo=bmp.getvalue()).status_code == 422
    png = BytesIO()
    Image.new("RGB", (32, 24)).save(png, format="PNG")
    assert enviar(cliente_visao, corpo=png.getvalue()).status_code == 200
    assert detector.chamadas == 1


def test_tamanho_declarado_invalido_e_recusado(visao, detector):
    cliente_visao, _ = visao
    resposta = cliente_visao.post(
        "/visao/quadros",
        content=jpeg(),
        headers={"authorization": f"Bearer {TOKEN_CAMERA}", "content-length": "muito"},
    )
    assert resposta.status_code == 400
    assert detector.chamadas == 0


def test_previa_pixela_ate_quem_nao_entra_na_contagem(visao, detector, monkeypatch):
    """Pessoa achada com pouca certeza não conta na mesa, mas some da prévia do mesmo jeito."""
    cliente_visao, _ = visao
    detector.pessoas.append(Pessoa(0.7, 0.2, 0.77, 0.3, 0.2, 1.2))  # na mesa 2, certeza 20%
    pixeladas = []
    original = modulo_servico.previa_sem_rostos

    def espiar(imagem, pessoas):
        pixeladas.extend(pessoas)
        return original(imagem, pessoas)

    monkeypatch.setattr(modulo_servico, "previa_sem_rostos", espiar)
    resposta = enviar(cliente_visao).json()
    assert resposta["pessoas"] == 3
    assert {"mesa": 2, "sentados": 0, "em_pe": 0} in resposta["mesas"]
    assert len(pixeladas) == 4


def test_cache_de_token_tem_tamanho_maximo(monkeypatch):
    monkeypatch.setattr(modulo_servico, "MAX_CONFIGS", 3)
    memoria = modulo_servico._Memoria()
    for i in range(10):
        memoria.guardar_config(f"chute-{i}", None, 60)
    assert len(memoria._configs) == 3
    assert memoria.config("chute-9") == (True, None)
    assert memoria.config("chute-0") == (False, None)


def test_previa_pixelada_e_leitura_para_quem_desenha_as_mesas(visao, como):
    cliente_visao, camera_id = visao
    enviar(cliente_visao)
    gerente = como("gerente@cantina.demo")

    previa = gerente.get(f"/api/cameras/{camera_id}/previa")
    assert previa.status_code == 200
    assert previa.headers["content-type"] == "image/jpeg"
    assert previa.headers["cache-control"] == "no-store"
    assert Image.open(BytesIO(previa.content)).size == (320, 240)

    leitura = gerente.get(f"/api/cameras/{camera_id}/leitura").json()
    assert [p["mesa"] for p in leitura["pessoas"]] == [1, 1, 1]
    assert [p["em_pe"] for p in leitura["pessoas"]] == [False, False, True]


def test_previa_e_leitura_respeitam_restaurante_e_perfil(visao, como):
    cliente_visao, camera_id = visao
    enviar(cliente_visao)
    vizinho, equipe = como("dono@vizinha.demo"), como("equipe@cantina.demo")
    for rota in ("previa", "leitura"):
        assert vizinho.get(f"/api/cameras/{camera_id}/{rota}").status_code == 404
        assert equipe.get(f"/api/cameras/{camera_id}/{rota}").status_code == 403


def test_sem_foto_recente_avisa_para_ligar_o_conector(visao, como):
    _, camera_id = visao
    resposta = como("gerente@cantina.demo").get(f"/api/cameras/{camera_id}/previa")
    assert resposta.status_code == 404
    assert "conector" in resposta.json()["detail"]


def test_rotas_internas_exigem_o_segredo(visao):
    cliente_visao, camera_id = visao
    enviar(cliente_visao)
    assert cliente_visao.get(f"/interno/cameras/{camera_id}/previa").status_code == 403
    errado = {"x-giro-interno": "chute"}
    rota = f"/interno/cameras/{camera_id}/leitura"
    assert cliente_visao.get(rota, headers=errado).status_code == 403
    certo = {"x-giro-interno": SEGREDO}
    assert cliente_visao.get(rota, headers=certo).status_code == 200


def test_api_sem_servico_de_visao_explica(como, cliente):
    gerente = como("gerente@cantina.demo")
    camera_id = gerente.get("/api/cameras").json()[0]["id"]
    resposta = gerente.get(f"/api/cameras/{camera_id}/previa")
    assert resposta.status_code == 503
    assert "não configurado" in resposta.json()["detail"]


def test_configuracao_so_entrega_mesas_desenhadas_desta_camera(visao, cliente):
    resposta = cliente.get(
        "/api/ingest/configuracao", headers={"authorization": f"Bearer {TOKEN_CAMERA}"}
    )
    dados = resposta.json()
    assert [m["numero"] for m in dados["mesas"]] == [1, 2]
    assert dados["mesas"][0]["poligono"] == MESA_1
    assert dados["ajustes"] == {}
    outra = cliente.get(
        "/api/ingest/configuracao", headers={"authorization": f"Bearer {TOKEN_CAMERA_OUTRO}"}
    )
    assert outra.json()["mesas"] == []


def test_apagar_desenho_tira_a_mesa_da_visao_e_mantem_a_camera(visao, como, cliente):
    _, camera_id = visao
    gerente = como("gerente@cantina.demo")
    mesa_1 = next(m for m in gerente.get("/api/mesas").json() if m["numero"] == 1)
    resposta = gerente.patch(f"/api/mesas/{mesa_1['id']}", json={"poligono": None})
    assert resposta.json()["poligono"] is None
    assert resposta.json()["camera_id"] == camera_id
    config = cliente.get(
        "/api/ingest/configuracao", headers={"authorization": f"Bearer {TOKEN_CAMERA}"}
    ).json()
    assert [m["numero"] for m in config["mesas"]] == [2]


def test_desenho_da_mesa_e_validado(como):
    gerente = como("gerente@cantina.demo")
    mesa_id = gerente.get("/api/mesas").json()[0]["id"]
    linha = gerente.patch(f"/api/mesas/{mesa_id}", json={"poligono": [[0.1, 0.1], [0.2, 0.2]]})
    assert linha.status_code == 422  # precisa de pelo menos 3 pontos
    fora = gerente.patch(
        f"/api/mesas/{mesa_id}", json={"poligono": [[0.1, 0.1], [1.5, 0.1], [0.2, 0.3]]}
    )
    assert fora.status_code == 422  # pontos de 0 a 1
    apagar = gerente.patch(f"/api/mesas/{mesa_id}", json={"poligono": None})
    assert apagar.json()["poligono"] is None


def test_mesa_nao_aceita_camera_de_outro_restaurante(como):
    camera_vizinha = como("dono@vizinha.demo").get("/api/cameras").json()[0]["id"]
    gerente = como("gerente@cantina.demo")
    mesa_id = gerente.get("/api/mesas").json()[0]["id"]
    resposta = gerente.patch(f"/api/mesas/{mesa_id}", json={"camera_id": camera_vizinha})
    assert resposta.status_code == 404


def test_calibracao_da_camera(visao, como, cliente):
    _, camera_id = visao
    dono = como("dono@cantina.demo")
    resposta = dono.patch(
        f"/api/cameras/{camera_id}", json={"ajustes_visao": {"proporcao_em_pe": 1.8}}
    )
    assert resposta.json()["ajustes_visao"] == {"proporcao_em_pe": 1.8}
    config = cliente.get(
        "/api/ingest/configuracao", headers={"authorization": f"Bearer {TOKEN_CAMERA}"}
    ).json()
    assert config["ajustes"] == {"proporcao_em_pe": 1.8}
    invalido = dono.patch(
        f"/api/cameras/{camera_id}", json={"ajustes_visao": {"confianca_minima": 0}}
    )
    assert invalido.status_code == 422
    assert (
        como("gerente@cantina.demo")
        .patch(f"/api/cameras/{camera_id}", json={"nome": "Outra"})
        .status_code
        == 403
    )
    vizinho = como("dono@vizinha.demo").patch(f"/api/cameras/{camera_id}", json={"nome": "X1"})
    assert vizinho.status_code == 404


# Conector: o programa que pega a imagem do DVR e manda para a visão.

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from giro.conector import (  # noqa: E402
    conferir_visao,
    esconder_senha,
    foto_http,
    preparar_jpeg,
    rodar,
)


def test_conector_esconde_a_senha_do_dvr_no_terminal():
    url = "rtsp://admin:Senha123@192.168.0.20:554/cam/realmonitor?channel=1"
    assert esconder_senha(url) == "rtsp://***@192.168.0.20:554/cam/realmonitor?channel=1"
    assert esconder_senha("/videos/salao.mp4") == "/videos/salao.mp4"
    na_busca = "http://192.168.0.20/snap.jpg?usr=admin&pwd=Senha123&loginUse=admin&chn=1"
    assert esconder_senha(na_busca) == (
        "http://192.168.0.20/snap.jpg?usr=admin&pwd=***&loginUse=***&chn=1"
    )


def test_conector_so_manda_foto_por_https_para_fora():
    assert conferir_visao("https://giro.exemplo.com/") == "https://giro.exemplo.com"
    assert conferir_visao("http://localhost:8001") == "http://localhost:8001"
    with pytest.raises(SystemExit, match="https"):
        conferir_visao("http://giro.exemplo.com")


def test_conector_reduz_a_foto_antes_de_mandar():
    grande = np.zeros((1440, 2560, 3), dtype=np.uint8)
    foto = cv2.imdecode(np.frombuffer(preparar_jpeg(grande), np.uint8), cv2.IMREAD_COLOR)
    assert foto.shape[:2] == (720, 1280)


def test_conector_com_pasta_de_fotos_ocupa_a_mesa(visao, tmp_path, como):
    cliente_visao, _ = visao
    for i in range(3):
        cv2.imwrite(str(tmp_path / f"{i:03}.jpg"), np.full((240, 320, 3), 90, dtype=np.uint8))
    linhas = []
    aceitas = rodar(
        str(tmp_path),
        TOKEN_CAMERA,
        cliente_visao,
        velocidade=1000,
        dormir=lambda s: None,
        saida=linhas.append,
    )
    assert aceitas == 3
    assert "mesa 1: 2 sentado(s) e 1 em pé" in linhas[-1]
    mesa_1 = next(
        m
        for m in como("gerente@cantina.demo").get("/api/salao").json()["mesas"]
        if m["numero"] == 1
    )
    assert mesa_1["estado"] == "aguardando"


def test_conector_com_video_gravado_pega_uma_foto_a_cada_10s(visao, tmp_path):
    cliente_visao, _ = visao
    video = tmp_path / "salao.avi"
    gravador = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"MJPG"), 2, (320, 240))
    for _ in range(70):  # 35 segundos a 2 quadros por segundo
        gravador.write(np.full((240, 320, 3), 90, dtype=np.uint8))
    gravador.release()
    aceitas = rodar(
        str(video),
        TOKEN_CAMERA,
        cliente_visao,
        velocidade=1000,
        dormir=lambda s: None,
        saida=lambda _: None,
    )
    assert aceitas == 4  # segundos 0, 10, 20 e 30


def test_conector_tenta_senha_basic_quando_o_dvr_nao_usa_digest():
    foto = preparar_jpeg(np.full((10, 10, 3), 200, dtype=np.uint8))

    def dvr(pedido):
        if pedido.headers.get("authorization", "").startswith("Basic "):
            return httpx.Response(200, content=foto)
        return httpx.Response(401, headers={"www-authenticate": 'Basic realm="dvr"'})

    with httpx.Client(transport=httpx.MockTransport(dvr)) as cliente:
        imagem = foto_http("http://admin:123@192.168.0.20/cgi-bin/snapshot.cgi", cliente)
    assert imagem.shape == (10, 10, 3)


def test_conector_para_com_token_recusado(visao, tmp_path):
    cliente_visao, _ = visao
    cv2.imwrite(str(tmp_path / "a.jpg"), np.zeros((20, 20, 3), dtype=np.uint8))
    with pytest.raises(SystemExit, match="token"):
        rodar(str(tmp_path), "cam_errado", cliente_visao, dormir=lambda s: None, saida=print)
