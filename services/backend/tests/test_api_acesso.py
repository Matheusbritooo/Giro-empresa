"""Login, perfis e isolamento: um restaurante nunca enxerga o outro."""

from tests.conftest import SENHA, entrar


def test_login_cria_cookie_de_sessao_protegido(cliente):
    resposta = cliente.post(
        "/api/auth/entrar", json={"email": " Gerente@Cantina.demo ", "senha": SENHA}
    )
    assert resposta.status_code == 200
    assert resposta.json()["usuario"]["papel"] == "gerente"
    assert resposta.json()["restaurante"]["nome"] == "Cantina do Marcos"
    cookie = resposta.headers["set-cookie"]
    assert "giro_sessao=" in cookie
    assert "HttpOnly" in cookie
    assert "samesite=lax" in cookie.lower()
    assert cliente.get("/api/auth/sessao").json()["usuario"]["email"] == "gerente@cantina.demo"


def test_senha_errada_e_email_inexistente_dao_a_mesma_resposta(cliente):
    errada = cliente.post("/api/auth/entrar", json={"email": "dono@cantina.demo", "senha": "x"})
    inexistente = cliente.post("/api/auth/entrar", json={"email": "ninguem@x.demo", "senha": "x"})
    assert errada.status_code == inexistente.status_code == 401
    assert errada.json() == inexistente.json()


def test_muitas_tentativas_bloqueiam_o_email(cliente):
    for _ in range(10):
        cliente.post("/api/auth/entrar", json={"email": "dono@cantina.demo", "senha": "errada"})
    resposta = cliente.post("/api/auth/entrar", json={"email": "dono@cantina.demo", "senha": SENHA})
    assert resposta.status_code == 429


def test_sair_apaga_a_sessao(cliente):
    entrar(cliente, "equipe@cantina.demo")
    assert cliente.post("/api/auth/sair").status_code == 204
    assert cliente.get("/api/auth/sessao").status_code == 401


def test_sem_login_nada_abre(cliente):
    for url in ("/api/salao", "/api/mesas", "/api/usuarios", "/api/restaurantes"):
        assert cliente.get(url).status_code == 401, url


def test_restaurante_nao_ve_salao_do_outro(como):
    vizinho = como("dono@vizinha.demo")
    assert vizinho.get("/api/salao").json()["restaurante"]["nome"] == "Pizzaria Vizinha"
    cantina_id = como("dono@cantina.demo").get("/api/salao").json()["restaurante"]["id"]
    assert vizinho.get(f"/api/salao?restaurante_id={cantina_id}").status_code == 404


def test_restaurante_nao_mexe_em_mesa_do_outro(como):
    mesas_cantina = como("dono@cantina.demo").get("/api/mesas").json()
    vizinho = como("dono@vizinha.demo")
    mesa_id = mesas_cantina[0]["id"]
    assert vizinho.patch(f"/api/mesas/{mesa_id}", json={"lugares": 8}).status_code == 404
    assert vizinho.post(f"/api/mesas/{mesa_id}/liberar").status_code == 404


def test_admin_giro_escolhe_o_restaurante(como):
    admin = como("admin@giro.demo")
    assert admin.get("/api/salao").status_code == 400
    restaurantes = admin.get("/api/restaurantes").json()
    assert {r["nome"] for r in restaurantes} == {"Cantina do Marcos", "Pizzaria Vizinha"}
    cantina = next(r for r in restaurantes if r["nome"] == "Cantina do Marcos")
    assert len(admin.get(f"/api/salao?restaurante_id={cantina['id']}").json()["mesas"]) == 4


def test_equipe_so_ve_o_salao(como):
    equipe = como("equipe@cantina.demo")
    assert equipe.get("/api/salao").status_code == 200
    assert equipe.get("/api/mesas").status_code == 403
    assert equipe.post("/api/mesas", json={"numero": 9}).status_code == 403
    assert equipe.get("/api/usuarios").status_code == 403


def test_gerente_cadastra_mesas_mas_nao_equipe(como):
    gerente = como("gerente@cantina.demo")
    criada = gerente.post("/api/mesas", json={"numero": 9, "lugares": 6, "pos_x": 1, "pos_y": 2})
    assert criada.status_code == 201
    assert criada.json()["estado"] == "livre"
    assert gerente.post("/api/mesas", json={"numero": 9}).status_code == 409
    assert gerente.get("/api/usuarios").status_code == 403


def test_dono_cria_gerente_e_equipe_mas_nao_outro_dono(como):
    dono = como("dono@cantina.demo")
    novo = {"nome": "Ana", "email": "ana@cantina.demo", "senha": "12345678", "papel": "equipe"}
    assert dono.post("/api/usuarios", json=novo).status_code == 201
    assert dono.post("/api/usuarios", json=novo).status_code == 409  # e-mail repetido
    outro_dono = {**novo, "email": "socio@cantina.demo", "papel": "dono"}
    assert dono.post("/api/usuarios", json=outro_dono).status_code == 403
    admin = {**novo, "email": "hacker@cantina.demo", "papel": "admin_giro"}
    assert dono.post("/api/usuarios", json=admin).status_code == 403


def test_usuario_desativado_perde_acesso(como):
    dono = como("dono@cantina.demo")
    equipe = como("equipe@cantina.demo")
    equipe_id = equipe.get("/api/auth/sessao").json()["usuario"]["id"]
    assert dono.patch(f"/api/usuarios/{equipe_id}", json={"ativo": False}).status_code == 200
    assert equipe.get("/api/salao").status_code == 401


def test_admin_ativa_cliente_novo_com_acesso_do_dono(como, cliente):
    admin = como("admin@giro.demo")
    resposta = admin.post(
        "/api/restaurantes",
        json={
            "nome": "Bar do Zé",
            "cidade": "Barueri",
            "dono": {"nome": "Zé", "email": "ze@bar.demo", "senha": "senha-forte-1"},
        },
    )
    assert resposta.status_code == 201
    login = cliente.post(
        "/api/auth/entrar", json={"email": "ze@bar.demo", "senha": "senha-forte-1"}
    )
    assert login.json()["restaurante"]["nome"] == "Bar do Zé"


def test_dono_ajusta_tempo_do_alerta_do_proprio_restaurante(como):
    dono = como("dono@cantina.demo")
    restaurante_id = dono.get("/api/auth/sessao").json()["restaurante"]["id"]
    resposta = dono.patch(
        f"/api/restaurantes/{restaurante_id}", json={"alerta_atendimento_seg": 240}
    )
    assert resposta.json()["alerta_atendimento_seg"] == 240
    vizinho = como("dono@vizinha.demo")
    patch_alheio = vizinho.patch(f"/api/restaurantes/{restaurante_id}", json={"nome": "Outro nome"})
    assert patch_alheio.status_code == 404


def test_camera_nova_mostra_token_uma_vez(como):
    dono = como("dono@cantina.demo")
    criada = dono.post("/api/cameras", json={"nome": "Varanda"}).json()
    assert criada["token"].startswith("cam_")
    assert all("token" not in c for c in dono.get("/api/cameras").json())
