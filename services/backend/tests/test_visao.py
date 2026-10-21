"""Visão computacional: regras de mesa com pessoas inventadas e o detector com foto pública."""

from io import BytesIO
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")
pytest.importorskip("onnxruntime")

from giro.visao.detector import Pessoa, interpretar, preparar  # noqa: E402
from giro.visao.leitura import Ajustes, ZonaMesa, dentro, distancia, ler  # noqa: E402
from giro.visao.privacidade import previa_sem_rostos  # noqa: E402

QUADRADO = [(0.2, 0.2), (0.4, 0.2), (0.4, 0.4), (0.2, 0.4)]


def pessoa(cx, base, largura=0.06, proporcao=1.2, confianca=0.9, imagem=(1000, 1000)):
    """Pessoa com o ponto de apoio em (cx, base). Proporção = altura/largura em pixels."""
    altura = largura * proporcao * imagem[0] / imagem[1]
    return Pessoa(
        x1=cx - largura / 2,
        y1=base - altura,
        x2=cx + largura / 2,
        y2=base,
        confianca=confianca,
        proporcao=proporcao,
    )


def test_ponto_dentro_e_fora_do_poligono():
    assert dentro((0.3, 0.3), QUADRADO)
    assert not dentro((0.5, 0.3), QUADRADO)
    assert distancia((0.3, 0.3), QUADRADO) == 0
    assert distancia((0.5, 0.3), QUADRADO) == pytest.approx(0.1)


def test_sentados_e_garcom_em_pe_na_mesa_certa():
    mesas = [ZonaMesa(4, QUADRADO), ZonaMesa(5, [(0.6, 0.2), (0.8, 0.2), (0.8, 0.4), (0.6, 0.4)])]
    pessoas = [
        pessoa(0.25, 0.35),  # sentada na 4
        pessoa(0.35, 0.38),  # sentada na 4
        pessoa(0.43, 0.39, proporcao=3.0),  # garçom em pé ao lado da 4, fora do desenho
        pessoa(0.7, 0.3),  # sentada na 5
        pessoa(0.5, 0.9, proporcao=3.0),  # alguém no corredor, longe de tudo
    ]
    leitura = ler(pessoas, mesas, Ajustes())
    assert leitura.por_mesa == {4: (2, 1), 5: (1, 0)}
    assert leitura.observacoes() == [
        {"mesa": 4, "sentados": 2, "em_pe": 1},
        {"mesa": 5, "sentados": 1, "em_pe": 0},
    ]
    assert [p.mesa for p in leitura.pessoas] == [4, 4, 4, 5, None]


def test_sentado_fora_do_desenho_nao_conta():
    # Quem está sentado na mesa vizinha, colado no desenho, não pode inflar a contagem.
    leitura = ler([pessoa(0.42, 0.3)], [ZonaMesa(4, QUADRADO)], Ajustes())
    assert leitura.por_mesa == {4: (0, 0)}


def test_mesa_vazia_tambem_e_informada():
    # A máquina de estados precisa saber que a mesa esvaziou, então zero também vai.
    assert ler([], [ZonaMesa(4, QUADRADO)], Ajustes()).observacoes() == [
        {"mesa": 4, "sentados": 0, "em_pe": 0}
    ]


def test_mesas_sobrepostas_ficam_com_a_mais_proxima():
    a = ZonaMesa(1, [(0.0, 0.0), (0.5, 0.0), (0.5, 0.5), (0.0, 0.5)])
    b = ZonaMesa(2, [(0.3, 0.3), (0.8, 0.3), (0.8, 0.8), (0.3, 0.8)])
    assert ler([pessoa(0.45, 0.45)], [a, b], Ajustes()).por_mesa == {1: (0, 0), 2: (1, 0)}


def test_deteccao_fraca_e_ignorada_e_ajustes_vem_do_banco():
    ajustes = Ajustes.de_dict({"confianca_minima": "0.6", "outra_coisa": 1})
    assert ajustes.confianca_minima == 0.6
    leitura = ler([pessoa(0.3, 0.3, confianca=0.5)], [ZonaMesa(4, QUADRADO)], ajustes)
    assert leitura.por_mesa == {4: (0, 0)}


def test_saida_do_yolox_vira_caixa_na_escala_da_foto():
    tamanho = 64
    linhas = sum((tamanho // p) ** 2 for p in (8, 16, 32))
    saida = np.zeros((linhas, 85), dtype=np.float32)
    # Ponto (2, 3) da grade de passo 8: centro em (20, 28) no quadro de 64 px, caixa 16 x 32:
    # vai de (12, 12) a (28, 44). Com escala 0.5, na foto de 128 px fica de (24, 24) a (56, 88).
    i = 3 * (tamanho // 8) + 2
    saida[i, :4] = [0.5, 0.5, np.log(2), np.log(4)]  # caixa de 16 x 32 px
    saida[i, 4] = 0.9  # tem objeto
    saida[i, 5] = 1.0  # é pessoa
    saida[i + 1, 4], saida[i + 1, 6] = 0.9, 1.0  # bicicleta: ignorada
    [p] = interpretar(saida, tamanho, escala=0.5, tamanho_imagem=(128, 128), limiar=0.3)
    assert (p.x1, p.y1, p.x2, p.y2) == pytest.approx((24 / 128, 24 / 128, 56 / 128, 88 / 128))
    assert p.proporcao == pytest.approx(2.0)
    assert p.confianca == pytest.approx(0.9)


def test_preparo_mantem_proporcao_e_completa_com_cinza():
    tensor, escala = preparar(Image.new("RGB", (200, 100), (255, 0, 0)), 64)
    assert tensor.shape == (3, 64, 64)
    assert escala == pytest.approx(0.32)
    assert tensor[2, 10, 10] == 255  # vermelho vai para o canal R, o último no formato BGR
    assert tensor[0, 60, 10] == 114  # faixa de baixo completada com cinza


def test_previa_pixeliza_as_pessoas_e_reduz_a_foto():
    rng = np.random.default_rng(1)
    original = Image.fromarray(rng.integers(0, 255, (1200, 1600, 3), dtype=np.uint8))
    alvo = Pessoa(x1=0.25, y1=0.25, x2=0.5, y2=0.75, confianca=0.9, proporcao=2.0)
    previa = Image.open(BytesIO(previa_sem_rostos(original, [alvo])))
    assert previa.width == 960
    regiao = np.asarray(previa.convert("L"))[300:400, 260:440].astype(float)
    fora = np.asarray(previa.convert("L"))[50:150, 700:880].astype(float)
    # Dentro da pessoa a imagem vira blocos lisos; fora continua com o ruído original.
    assert np.abs(np.diff(regiao, axis=1)).mean() < np.abs(np.diff(fora, axis=1)).mean() / 4


FOTO_PUBLICA = "https://github.com/ultralytics/assets/releases/download/v0.0.0/bus.jpg"


@pytest.fixture(scope="module")
def detector():
    from giro.visao.detector import DetectorYolox
    from giro.visao.modelo import MODELOS, pasta_padrao

    caminho = pasta_padrao() / "yolox_s.onnx"
    if not caminho.exists():
        pytest.skip("modelo yolox_s não baixado (uv run python -m giro.visao.modelo)")
    return DetectorYolox(caminho, MODELOS["yolox_s"].tamanho, threads=2)


@pytest.fixture(scope="module")
def foto_onibus(tmp_path_factory) -> Path:
    """Foto pública (4 pessoas em pé), baixada na hora e nunca guardada no repositório."""
    import httpx

    destino = tmp_path_factory.mktemp("fotos") / "onibus.jpg"
    try:
        resposta = httpx.get(FOTO_PUBLICA, follow_redirects=True, timeout=30)
        resposta.raise_for_status()
    except httpx.HTTPError as erro:
        pytest.skip(f"sem acesso à foto pública: {erro}")
    destino.write_bytes(resposta.content)
    return destino


def test_detector_real_encontra_as_pessoas_em_pe(detector, foto_onibus):
    pessoas = detector.detectar(Image.open(foto_onibus))
    assert len(pessoas) == 4
    firmes = [p for p in pessoas if p.confianca > 0.8]
    assert len(firmes) == 3
    assert all(p.proporcao > 2.2 for p in firmes)  # gente em pé tem caixa alta


# Ferramenta de calibração com vídeo real (giro.visao.avaliar).

pytest.importorskip("cv2")

from giro.visao.avaliar import carregar_gabarito, carregar_mesas, comparar, eventos  # noqa: E402


def test_avaliacao_compara_com_o_gabarito_feito_a_mao(tmp_path):
    gabarito = tmp_path / "gabarito.yaml"
    gabarito.write_text('"0:00": {1: [0, 0]}\n"0:10": {1: [2, 1]}\n"0:20": {1: [2, 0]}\n')
    lido = [(0.0, {1: (0, 0)}), (10.0, {1: (2, 0)}), (20.0, {1: (3, 0)})]
    acerto = comparar(lido, carregar_gabarito(gabarito))
    assert acerto.comparacoes == 3
    assert acerto.ocupacao == 1  # sempre acertou se a mesa tinha gente
    assert acerto.sentados == pytest.approx(2 / 3)  # errou o número aos 20 s
    assert acerto.em_pe == pytest.approx(2 / 3)  # não viu o garçom aos 10 s


def test_avaliacao_mostra_os_eventos_que_o_sistema_geraria(tmp_path):
    mesas = tmp_path / "mesas.yaml"
    mesas.write_text("4: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]]\n")
    zonas = carregar_mesas(mesas)
    lido = [(s, {4: (2, 1 if s == 120 else 0)}) for s in range(0, 200, 10)]
    assert eventos(lido, zonas) == ["  0:00  mesa  4  sentou", "  2:00  mesa  4  atendida"]
