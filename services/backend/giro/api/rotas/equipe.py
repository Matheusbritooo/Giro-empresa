"""Usuários do restaurante e restaurantes (admin GIRO)."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from giro.api.deps import Db, RestauranteAlvo, UsuarioAtual, exigir_papel, restaurante_permitido
from giro.esquemas import (
    RestauranteAtualizacao,
    RestauranteEntrada,
    RestauranteSaida,
    UsuarioAtualizacao,
    UsuarioEntrada,
    UsuarioSaida,
)
from giro.modelos import Papel, Restaurante, Usuario
from giro.seguranca import gerar_hash_senha

router = APIRouter(prefix="/api", tags=["equipe e cadastro"])

DONO_OU_ADMIN = exigir_papel(Papel.ADMIN_GIRO, Papel.DONO)

# Quem pode criar quem.
PODE_CRIAR = {
    Papel.ADMIN_GIRO: {Papel.DONO, Papel.GERENTE, Papel.EQUIPE},
    Papel.DONO: {Papel.GERENTE, Papel.EQUIPE},
}


def _email_em_uso(erro: IntegrityError) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "já existe um usuário com esse e-mail")


@router.get("/usuarios", dependencies=[DONO_OU_ADMIN])
def listar_usuarios(db: Db, restaurante_id: RestauranteAlvo) -> list[UsuarioSaida]:
    usuarios = db.scalars(
        select(Usuario).where(Usuario.restaurante_id == restaurante_id).order_by(Usuario.nome)
    ).all()
    return [UsuarioSaida.model_validate(u) for u in usuarios]


@router.post("/usuarios", status_code=status.HTTP_201_CREATED, dependencies=[DONO_OU_ADMIN])
def criar_usuario(
    dados: UsuarioEntrada, db: Db, usuario: UsuarioAtual, restaurante_id: RestauranteAlvo
) -> UsuarioSaida:
    if dados.papel not in PODE_CRIAR[Papel(usuario.papel)]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "você não pode criar esse perfil")
    novo = Usuario(
        restaurante_id=restaurante_id,
        nome=dados.nome,
        email=dados.email,
        senha_hash=gerar_hash_senha(dados.senha),
        papel=dados.papel.value,
    )
    db.add(novo)
    try:
        db.commit()
    except IntegrityError as erro:
        raise _email_em_uso(erro) from erro
    return UsuarioSaida.model_validate(novo)


@router.patch("/usuarios/{usuario_id}", dependencies=[DONO_OU_ADMIN])
def atualizar_usuario(
    usuario_id: int, dados: UsuarioAtualizacao, db: Db, usuario: UsuarioAtual
) -> UsuarioSaida:
    alvo = db.get(Usuario, usuario_id)
    if alvo is None or alvo.restaurante_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "usuário não encontrado")
    restaurante_permitido(usuario, alvo.restaurante_id)
    permitidos = PODE_CRIAR[Papel(usuario.papel)]
    if Papel(alvo.papel) not in permitidos or (dados.papel and dados.papel not in permitidos):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "você não pode alterar esse perfil")
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(alvo, campo, valor.value if isinstance(valor, Papel) else valor)
    db.commit()
    return UsuarioSaida.model_validate(alvo)


@router.get("/restaurantes", dependencies=[exigir_papel(Papel.ADMIN_GIRO)])
def listar_restaurantes(db: Db) -> list[RestauranteSaida]:
    restaurantes = db.scalars(select(Restaurante).order_by(Restaurante.nome)).all()
    return [RestauranteSaida.model_validate(r) for r in restaurantes]


@router.post(
    "/restaurantes",
    status_code=status.HTTP_201_CREATED,
    dependencies=[exigir_papel(Papel.ADMIN_GIRO)],
)
def criar_restaurante(dados: RestauranteEntrada, db: Db) -> RestauranteSaida:
    """Ativação de cliente novo: cria o restaurante e o acesso do dono."""
    restaurante = Restaurante(nome=dados.nome, cidade=dados.cidade)
    db.add(restaurante)
    db.flush()
    db.add(
        Usuario(
            restaurante_id=restaurante.id,
            nome=dados.dono.nome,
            email=dados.dono.email,
            senha_hash=gerar_hash_senha(dados.dono.senha),
            papel=Papel.DONO.value,
        )
    )
    try:
        db.commit()
    except IntegrityError as erro:
        raise _email_em_uso(erro) from erro
    return RestauranteSaida.model_validate(restaurante)


@router.patch("/restaurantes/{restaurante_id}", dependencies=[DONO_OU_ADMIN])
def atualizar_restaurante(
    restaurante_id: int, dados: RestauranteAtualizacao, db: Db, usuario: UsuarioAtual
) -> RestauranteSaida:
    restaurante_permitido(usuario, restaurante_id)
    restaurante = db.get(Restaurante, restaurante_id)
    if restaurante is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "restaurante não encontrado")
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(restaurante, campo, valor)
    db.commit()
    return RestauranteSaida.model_validate(restaurante)
