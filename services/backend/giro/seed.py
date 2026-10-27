"""Cria dados de demonstração: a Cantina do Marcos (persona do TCM) com 14 mesas.

Uso: uv run python -m giro.seed [--zerar-salao]
Pode rodar de novo sem duplicar nada. Em produção só roda no servidor de demonstração
(GIRO_DEMO=1), com a senha de GIRO_SENHA_DEMO e o token de GIRO_TOKEN_CAMERA_DEMO.
--zerar-salao deixa todas as mesas livres, para a demonstração começar do zero ao subir.
Também cria 4 semanas de histórico (giro/demo_historico.py) para os resultados e o Copiloto.
"""

import argparse
import os
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from giro.banco import agora, criar_engine, criar_sessoes
from giro.config import Config, obter_config
from giro.demo_historico import gerar_historico
from giro.dominio.indicadores import noite_de
from giro.dominio.mesa import Estado
from giro.modelos import Alerta, Camera, Mesa, Ocupacao, Papel, Restaurante, Usuario
from giro.seguranca import gerar_hash_senha, hash_token, verificar_senha

SENHA_DEMO = "giro1234"
TOKEN_PADRAO = "cam_demo_cantina_do_marcos"
TOKEN_CAMERA_DEMO = os.environ.get("GIRO_TOKEN_CAMERA_DEMO", TOKEN_PADRAO)
NOME_RESTAURANTE = "Cantina do Marcos"
NOME_CAMERA = "Salão (simulador)"

USUARIOS = [
    ("Equipe GIRO", "admin@giro.demo", Papel.ADMIN_GIRO),
    ("Marcos Andrade", "marcos@cantina.demo", Papel.DONO),
    ("Gerente da Cantina", "gerente@cantina.demo", Papel.GERENTE),
    ("Garçom da Cantina", "equipe@cantina.demo", Papel.EQUIPE),
]

# (número, lugares, coluna, linha) — o salão da cantina tem 14 mesas.
MESAS = [
    (1, 2, 0, 0), (2, 2, 1, 0), (3, 4, 2, 0), (4, 4, 3, 0),
    (5, 4, 0, 1), (6, 4, 1, 1), (7, 6, 2, 1), (8, 4, 3, 1),
    (9, 4, 0, 2), (10, 4, 1, 2), (11, 2, 2, 2), (12, 2, 3, 2),
    (13, 8, 0, 3), (14, 6, 2, 3),
]  # fmt: skip


def _acesso(config: Config) -> tuple[str, str]:
    """Senha e token da demonstração. Num endereço público, nada de senha conhecida."""
    if config.ambiente != "producao":
        return SENHA_DEMO, TOKEN_CAMERA_DEMO
    if os.environ.get("GIRO_DEMO") != "1":
        sys.exit("seed em produção só no servidor de demonstração (GIRO_DEMO=1)")
    senha = os.environ.get("GIRO_SENHA_DEMO", "")
    if len(senha) < 10:
        sys.exit("defina GIRO_SENHA_DEMO com pelo menos 10 caracteres")
    token = os.environ.get("GIRO_TOKEN_CAMERA_DEMO", "")
    if not token.startswith("cam_") or token == TOKEN_PADRAO:
        sys.exit("defina GIRO_TOKEN_CAMERA_DEMO (cam_...) diferente do padrão")
    return senha, token


def zerar_salao(db: Session, restaurante_id: int) -> None:
    """Todas as mesas livres e nenhum alerta aberto. O histórico de visitas fica."""
    momento = agora()
    for mesa in db.scalars(select(Mesa).where(Mesa.restaurante_id == restaurante_id)):
        mesa.estado, mesa.estado_desde, mesa.estado_maquina = Estado.LIVRE.value, momento, None
    abertas = select(Ocupacao).where(
        Ocupacao.restaurante_id == restaurante_id, Ocupacao.liberada_em.is_(None)
    )
    for ocupacao in db.scalars(abertas):
        ocupacao.saiu_em = ocupacao.saiu_em or momento
        ocupacao.liberada_em = momento
    alertas = select(Alerta).where(
        Alerta.restaurante_id == restaurante_id, Alerta.resolvido_em.is_(None)
    )
    for alerta in db.scalars(alertas):
        alerta.resolvido_em = momento


def _atualizar_acesso(db: Session, senha: str, token: str) -> None:
    """Quem troca GIRO_SENHA_DEMO no servidor não precisa apagar o banco."""
    usuarios = db.scalars(select(Usuario).where(Usuario.email.in_([u[1] for u in USUARIOS]))).all()
    if usuarios and not verificar_senha(usuarios[0].senha_hash, senha):
        novo_hash = gerar_hash_senha(senha)
        for usuario in usuarios:
            usuario.senha_hash = novo_hash
    camera = db.scalar(select(Camera).where(Camera.nome == NOME_CAMERA))
    if camera:
        camera.token_hash = hash_token(token)


def semear(config: Config | None = None, zerar: bool = False) -> None:
    config = config or obter_config()
    senha, token = _acesso(config)
    publica = config.ambiente == "producao"

    engine = criar_engine(config.database_url)
    with criar_sessoes(engine)() as db:
        if db.scalar(select(Usuario).where(Usuario.email == USUARIOS[0][1])):
            if publica:
                _atualizar_acesso(db, senha, token)
            cantina = db.scalar(select(Restaurante).where(Restaurante.nome == NOME_RESTAURANTE))
            if cantina and zerar:
                zerar_salao(db, cantina.id)
            # Quem criou a demonstração antes dos resultados ganha o histórico agora.
            historico = gerar_historico(db, cantina.id, noite_de(agora())) if cantina else 0
            db.commit()
            print(
                "Dados de demonstração já existem."
                + (" Salão zerado." if zerar else "")
                + (f" Histórico: {historico} visitas." if historico else "")
            )
            return

        cantina = Restaurante(nome=NOME_RESTAURANTE, cidade="Cotia")
        db.add(cantina)
        db.flush()

        senha_hash = gerar_hash_senha(senha)  # um hash para todos: argon2 é lento de propósito
        for nome, email, papel in USUARIOS:
            db.add(
                Usuario(
                    restaurante_id=None if papel == Papel.ADMIN_GIRO else cantina.id,
                    nome=nome,
                    email=email,
                    senha_hash=senha_hash,
                    papel=papel.value,
                )
            )
        camera = Camera(restaurante_id=cantina.id, nome=NOME_CAMERA, token_hash=hash_token(token))
        db.add(camera)
        db.flush()
        for numero, lugares, x, y in MESAS:
            db.add(
                Mesa(
                    restaurante_id=cantina.id,
                    camera_id=camera.id,
                    numero=numero,
                    lugares=lugares,
                    pos_x=x,
                    pos_y=y,
                )
            )
        db.flush()
        historico = gerar_historico(db, cantina.id, noite_de(agora()))
        db.commit()

    if publica:  # endereço público: senha e token não vão para o log
        print("Dados de demonstração criados. Senha: a de GIRO_SENHA_DEMO.")
    else:
        print("Dados de demonstração criados. Senha de todos: " + senha)
    for nome, email, papel in USUARIOS:
        print(f"  {papel.value:<11} {email:<24} {nome}")
    print(f"Histórico de 4 semanas para os resultados: {historico} visitas.")
    if not publica:
        print(f"Token da câmera do simulador: {token}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog="giro.seed", description=__doc__)
    parser.add_argument("--zerar-salao", action="store_true", help="todas as mesas livres")
    semear(zerar=parser.parse_args().zerar_salao)
