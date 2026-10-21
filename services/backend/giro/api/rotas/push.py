from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, select

from giro.api.deps import ConfigAtual, Db, UsuarioAtual
from giro.esquemas import ChavePublicaPush, InscricaoPushEntrada
from giro.modelos import InscricaoPush

router = APIRouter(prefix="/api/push", tags=["notificações"])


@router.get("/chave-publica")
def chave_publica(config: ConfigAtual) -> ChavePublicaPush:
    """Vazio quando o servidor ainda não tem chaves configuradas: o painel esconde o botão."""
    configurado = config.vapid_chave_privada and config.vapid_chave_publica
    return ChavePublicaPush(chave_publica=config.vapid_chave_publica if configurado else None)


@router.post("/inscricoes", status_code=status.HTTP_204_NO_CONTENT)
def inscrever(dados: InscricaoPushEntrada, db: Db, usuario: UsuarioAtual) -> None:
    if usuario.restaurante_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "só usuários de restaurante recebem alertas"
        )
    inscricao = db.scalar(select(InscricaoPush).where(InscricaoPush.endpoint == dados.endpoint))
    if inscricao is None:
        inscricao = InscricaoPush(endpoint=dados.endpoint)
        db.add(inscricao)
    # O mesmo celular pode trocar de usuário: a inscrição fica com quem logou por último.
    inscricao.usuario_id = usuario.id
    inscricao.restaurante_id = usuario.restaurante_id
    inscricao.p256dh = dados.keys.p256dh
    inscricao.auth = dados.keys.auth
    db.commit()


@router.delete("/inscricoes", status_code=status.HTTP_204_NO_CONTENT)
def cancelar(dados: InscricaoPushEntrada, db: Db, usuario: UsuarioAtual) -> None:
    db.execute(
        delete(InscricaoPush).where(
            InscricaoPush.endpoint == dados.endpoint, InscricaoPush.usuario_id == usuario.id
        )
    )
    db.commit()
