import hashlib
import secrets
from datetime import timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

from giro.banco import agora

_hasher = PasswordHasher()
ALGORITMO = "HS256"


def gerar_hash_senha(senha: str) -> str:
    return _hasher.hash(senha)


def verificar_senha(senha_hash: str, senha: str) -> bool:
    try:
        return _hasher.verify(senha_hash, senha)
    except VerificationError:
        return False


def criar_token_sessao(usuario_id: int, segredo: str, horas: int) -> str:
    payload = {"sub": str(usuario_id), "exp": agora() + timedelta(hours=horas)}
    return jwt.encode(payload, segredo, algorithm=ALGORITMO)


def ler_token_sessao(token: str, segredo: str) -> int | None:
    try:
        payload = jwt.decode(token, segredo, algorithms=[ALGORITMO])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def gerar_token_camera() -> str:
    return "cam_" + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
