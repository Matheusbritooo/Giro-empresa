"""Cria dados de demonstração: a Cantina do Marcos (persona do TCM) com 14 mesas.

Uso: uv run python -m giro.seed
Só roda fora de produção. Pode rodar de novo sem duplicar nada.
"""

import os
import sys

from sqlalchemy import select

from giro.banco import criar_engine, criar_sessoes
from giro.config import obter_config
from giro.modelos import Camera, Mesa, Papel, Restaurante, Usuario
from giro.seguranca import gerar_hash_senha, hash_token

SENHA_DEMO = "giro1234"
TOKEN_CAMERA_DEMO = os.environ.get("GIRO_TOKEN_CAMERA_DEMO", "cam_demo_cantina_do_marcos")

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


def semear() -> None:
    config = obter_config()
    if config.ambiente == "producao":
        sys.exit("seed é só para desenvolvimento e demonstração")

    engine = criar_engine(config.database_url)
    with criar_sessoes(engine)() as db:
        if db.scalar(select(Usuario).where(Usuario.email == USUARIOS[0][1])):
            print("Dados de demonstração já existem.")
            return

        cantina = Restaurante(nome="Cantina do Marcos", cidade="Cotia")
        db.add(cantina)
        db.flush()

        for nome, email, papel in USUARIOS:
            db.add(
                Usuario(
                    restaurante_id=None if papel == Papel.ADMIN_GIRO else cantina.id,
                    nome=nome,
                    email=email,
                    senha_hash=gerar_hash_senha(SENHA_DEMO),
                    papel=papel.value,
                )
            )
        camera = Camera(
            restaurante_id=cantina.id,
            nome="Salão (simulador)",
            token_hash=hash_token(TOKEN_CAMERA_DEMO),
        )
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
        db.commit()

    print("Dados de demonstração criados. Senha de todos: " + SENHA_DEMO)
    for nome, email, papel in USUARIOS:
        print(f"  {papel.value:<11} {email:<24} {nome}")
    print(f"Token da câmera do simulador: {TOKEN_CAMERA_DEMO}")


if __name__ == "__main__":
    semear()
