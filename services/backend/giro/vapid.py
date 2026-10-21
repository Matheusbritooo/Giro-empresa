"""Gera o par de chaves para notificação no celular (Web Push).

Uso: uv run python -m giro.vapid
Cole as duas linhas no .env do backend. A chave pública também vai para o painel via API.
"""

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import b64urlencode


def gerar() -> tuple[str, str]:
    chave = ec.generate_private_key(ec.SECP256R1())
    privada = b64urlencode(chave.private_numbers().private_value.to_bytes(32, "big"))
    publica = b64urlencode(
        chave.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )
    return privada, publica


if __name__ == "__main__":
    privada, publica = gerar()
    print(f"GIRO_VAPID_CHAVE_PRIVADA={privada}")
    print(f"GIRO_VAPID_CHAVE_PUBLICA={publica}")
