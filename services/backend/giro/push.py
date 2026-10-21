"""Notificação no celular do gerente e da equipe (Web Push, sem custo por mensagem)."""

import json
import logging
from concurrent.futures import ThreadPoolExecutor

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.orm import sessionmaker

from giro.config import Config
from giro.modelos import InscricaoPush, Papel, Usuario

log = logging.getLogger(__name__)


class EnviadorPush:
    def __init__(self, config: Config, sessoes: sessionmaker) -> None:
        self.config = config
        self.sessoes = sessoes
        self._fila = ThreadPoolExecutor(max_workers=4, thread_name_prefix="push")

    @property
    def ativo(self) -> bool:
        return bool(self.config.vapid_chave_privada and self.config.vapid_chave_publica)

    def enviar(
        self,
        restaurante_id: int,
        titulo: str,
        corpo: str,
        papeis: tuple[Papel, ...],
        url: str = "/salao",
    ) -> None:
        """Dispara em segundo plano para não atrasar a resposta da API."""
        if self.ativo:
            self._fila.submit(self._enviar_agora, restaurante_id, titulo, corpo, papeis, url)

    def _enviar_agora(
        self, restaurante_id: int, titulo: str, corpo: str, papeis: tuple[Papel, ...], url: str
    ) -> None:
        dados = json.dumps({"titulo": titulo, "corpo": corpo, "url": url})
        with self.sessoes() as db:
            inscricoes = db.scalars(
                select(InscricaoPush)
                .join(Usuario, Usuario.id == InscricaoPush.usuario_id)
                .where(
                    InscricaoPush.restaurante_id == restaurante_id,
                    Usuario.ativo.is_(True),
                    Usuario.papel.in_([p.value for p in papeis]),
                )
            ).all()
            vencidas = []
            for inscricao in inscricoes:
                try:
                    webpush(
                        subscription_info={
                            "endpoint": inscricao.endpoint,
                            "keys": {"p256dh": inscricao.p256dh, "auth": inscricao.auth},
                        },
                        data=dados,
                        vapid_private_key=self.config.vapid_chave_privada,
                        vapid_claims={"sub": self.config.vapid_contato},
                        ttl=300,
                        timeout=10,
                    )
                except WebPushException as erro:
                    status = getattr(erro.response, "status_code", None)
                    if status in (404, 410):  # o celular cancelou a inscrição
                        vencidas.append(inscricao.id)
                    else:
                        log.warning("falha ao enviar push: %s", erro)
            if vencidas:
                db.execute(delete(InscricaoPush).where(InscricaoPush.id.in_(vencidas)))
                db.commit()

    def encerrar(self) -> None:
        self._fila.shutdown(wait=False, cancel_futures=True)
