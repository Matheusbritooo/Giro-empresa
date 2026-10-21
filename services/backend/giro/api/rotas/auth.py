from collections import defaultdict, deque
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from giro.api.deps import COOKIE_SESSAO, ConfigAtual, Db, UsuarioAtual
from giro.banco import agora
from giro.esquemas import LoginEntrada, RestauranteSaida, SessaoSaida, UsuarioSaida
from giro.modelos import Usuario
from giro.seguranca import criar_token_sessao, gerar_hash_senha, verificar_senha

router = APIRouter(prefix="/api/auth", tags=["sessão"])

# Comparar com um hash qualquer quando o e-mail não existe deixa a resposta com o mesmo tempo,
# para ninguém descobrir quais e-mails têm conta.
_HASH_FALSO = gerar_hash_senha("senha-que-ninguem-usa")


class LimiteTentativas:
    """Bloqueia o e-mail por alguns minutos depois de muitas senhas erradas."""

    def __init__(self, maximo: int = 10, janela: timedelta = timedelta(minutes=5)) -> None:
        self.maximo = maximo
        self.janela = janela
        self._falhas: dict[str, deque[datetime]] = defaultdict(deque)

    def bloqueado(self, chave: str, momento: datetime) -> bool:
        falhas = self._falhas[chave]
        while falhas and momento - falhas[0] > self.janela:
            falhas.popleft()
        return len(falhas) >= self.maximo

    def falhou(self, chave: str, momento: datetime) -> None:
        self._falhas[chave].append(momento)

    def limpar(self, chave: str) -> None:
        self._falhas.pop(chave, None)


def sessao_de(usuario: Usuario) -> SessaoSaida:
    return SessaoSaida(
        usuario=UsuarioSaida.model_validate(usuario),
        restaurante=RestauranteSaida.model_validate(usuario.restaurante)
        if usuario.restaurante
        else None,
    )


@router.post("/entrar")
def entrar(
    dados: LoginEntrada, request: Request, response: Response, db: Db, config: ConfigAtual
) -> SessaoSaida:
    email = dados.email.strip().lower()
    limite: LimiteTentativas = request.app.state.limite_login
    momento = agora()
    if limite.bloqueado(email, momento):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "muitas tentativas, espere alguns minutos"
        )

    usuario = db.scalar(select(Usuario).where(Usuario.email == email))
    senha_ok = verificar_senha(usuario.senha_hash if usuario else _HASH_FALSO, dados.senha)
    if usuario is None or not senha_ok or not usuario.ativo:
        limite.falhou(email, momento)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "e-mail ou senha incorretos")

    limite.limpar(email)
    response.set_cookie(
        COOKIE_SESSAO,
        criar_token_sessao(usuario.id, config.segredo_jwt, config.sessao_horas),
        max_age=config.sessao_horas * 3600,
        httponly=True,
        secure=config.cookie_seguro,
        samesite="lax",
        path="/",
    )
    return sessao_de(usuario)


@router.post("/sair", status_code=status.HTTP_204_NO_CONTENT)
def sair(response: Response) -> None:
    response.delete_cookie(COOKIE_SESSAO, path="/")


@router.get("/sessao")
def sessao(usuario: UsuarioAtual) -> SessaoSaida:
    return sessao_de(usuario)
