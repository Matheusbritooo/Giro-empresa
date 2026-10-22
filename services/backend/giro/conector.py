"""Conector GIRO: pega 1 foto a cada 10 segundos da câmera e manda para o serviço de visão.

Roda num computador que já existe no restaurante, ou no notebook do vendedor na demonstração,
na mesma rede do gravador (DVR/NVR). Nenhuma foto é gravada em disco.

  uv run --extra conector python -m giro.conector --token cam_... --visao https://SEU-DOMINIO \\
      --fonte "rtsp://usuario:senha@192.168.0.20:554/cam/realmonitor?channel=1&subtype=0"

Token e fonte também podem vir das variáveis GIRO_TOKEN e GIRO_FONTE, para a senha do
gravador não ficar no histórico do terminal nem na lista de processos.

Fontes aceitas:
  rtsp://...            transmissão do DVR (Intelbras, Hikvision e afins)
  http(s)://...         endereço de foto do DVR, ex. http://192.168.0.20/cgi-bin/snapshot.cgi
  arquivo de vídeo      .mp4 .avi .mkv .mov: para testar com vídeo gravado do salão
  pasta com fotos       .jpg .png em ordem alfabética: para testes
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import cv2
import httpx
import numpy as np

LARGURA_MAXIMA = 1280  # suficiente para contar pessoas; deixa cada foto com ~100 a 200 KB
QUALIDADE_JPEG = 75
EXTENSOES_VIDEO = {".mp4", ".avi", ".mkv", ".mov", ".m4v"}
EXTENSOES_FOTO = {".jpg", ".jpeg", ".png"}
HOSTS_LOCAIS = {"localhost", "127.0.0.1", "::1"}
# Alguns gravadores pedem usuário e senha no endereço (?user=admin&password=...).
PARAMETROS_SECRETOS = ("pass", "pwd", "senha", "user", "login", "token", "auth")

_mostrar = partial(print, flush=True)


@dataclass(frozen=True)
class Quadro:
    imagem: np.ndarray  # BGR, como o OpenCV entrega
    em: datetime


def esconder_senha(url: str) -> str:
    """Para aparecer no terminal sem expor usuário e senha do DVR."""
    partes = urlsplit(url)
    if partes.scheme.lower() not in ("rtsp", "rtsps", "http", "https"):
        return url
    if partes.password is not None or partes.username is not None:
        host = partes.hostname or ""
        if partes.port:
            host += f":{partes.port}"
        partes = partes._replace(netloc=f"***@{host}")
    if partes.query:
        parametros = [
            (nome, "***" if any(s in nome.lower() for s in PARAMETROS_SECRETOS) else valor)
            for nome, valor in parse_qsl(partes.query, keep_blank_values=True)
        ]
        partes = partes._replace(query=urlencode(parametros, safe="*"))
    return urlunsplit(partes)


def conferir_visao(url: str) -> str:
    """A foto sai do restaurante: fora da própria máquina, só por HTTPS."""
    partes = urlsplit(url)
    if partes.scheme == "https" or (partes.scheme == "http" and partes.hostname in HOSTS_LOCAIS):
        return url.rstrip("/")
    raise SystemExit("--visao precisa começar com https:// (http só vale para localhost)")


def preparar_jpeg(imagem: np.ndarray) -> bytes:
    altura, largura = imagem.shape[:2]
    if largura > LARGURA_MAXIMA:
        nova_altura = round(altura * LARGURA_MAXIMA / largura)
        imagem = cv2.resize(imagem, (LARGURA_MAXIMA, nova_altura), interpolation=cv2.INTER_AREA)
    ok, codificada = cv2.imencode(".jpg", imagem, [cv2.IMWRITE_JPEG_QUALITY, QUALIDADE_JPEG])
    if not ok:
        raise ValueError("não deu para gerar o JPEG")
    return codificada.tobytes()


# Fontes ao vivo: uma foto por chamada, na hora.


def foto_rtsp(url: str) -> np.ndarray | None:
    captura = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    try:
        captura.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok, imagem = captura.read()
        return imagem if ok else None
    finally:
        captura.release()


def foto_http(url: str, cliente: httpx.Client) -> np.ndarray | None:
    partes = urlsplit(url)
    limpa = urlunsplit(
        partes._replace(netloc=partes.hostname + (f":{partes.port}" if partes.port else ""))
    )
    auth = None
    if partes.username:
        # Intelbras usa "digest"; alguns modelos aceitam só "basic".
        auth = httpx.DigestAuth(partes.username, partes.password or "")
    resposta = cliente.get(limpa, auth=auth, timeout=10)
    if resposta.status_code == 401 and partes.username:
        resposta = cliente.get(limpa, auth=(partes.username, partes.password or ""), timeout=10)
    if resposta.status_code != 200:
        return None
    return cv2.imdecode(np.frombuffer(resposta.content, np.uint8), cv2.IMREAD_COLOR)


def ao_vivo(
    pegar: Callable[[], np.ndarray | None],
    intervalo: float,
    dormir: Callable[[float], None],
    relogio: Callable[[], datetime],
) -> Iterator[Quadro | None]:
    """Uma foto a cada `intervalo` segundos. None quando a câmera não respondeu."""
    while True:
        inicio = time.monotonic()
        imagem = pegar()
        yield Quadro(imagem, relogio()) if imagem is not None else None
        dormir(max(0.0, intervalo - (time.monotonic() - inicio)))


# Fontes gravadas: o tempo da foto acompanha o tempo do vídeo.


def de_video(caminho: Path, intervalo: float) -> Iterator[tuple[float, np.ndarray]]:
    captura = cv2.VideoCapture(str(caminho))
    if not captura.isOpened():
        raise SystemExit(f"não consegui abrir o vídeo {caminho}")
    try:
        quadros = captura.get(cv2.CAP_PROP_FRAME_COUNT)
        fps = captura.get(cv2.CAP_PROP_FPS) or 30
        duracao = quadros / fps if quadros > 0 else float("inf")
        segundo = 0.0
        while segundo < duracao:
            captura.set(cv2.CAP_PROP_POS_MSEC, segundo * 1000)
            ok, imagem = captura.read()
            if not ok:
                break
            yield segundo, imagem
            segundo += intervalo
    finally:
        captura.release()


def de_pasta(pasta: Path, intervalo: float) -> Iterator[tuple[float, np.ndarray]]:
    fotos = sorted(p for p in pasta.iterdir() if p.suffix.lower() in EXTENSOES_FOTO)
    if not fotos:
        raise SystemExit(f"nenhuma foto .jpg ou .png em {pasta}")
    for i, foto in enumerate(fotos):
        imagem = cv2.imread(str(foto))
        if imagem is not None:
            yield i * intervalo, imagem


def gravado(
    fonte: Iterator[tuple[float, np.ndarray]],
    duracao_estimada: float,
    velocidade: float,
    dormir: Callable[[float], None],
    relogio: Callable[[], datetime],
) -> Iterator[Quadro]:
    """Velocidade 1 = no ritmo real. Maior que 1 = repassa rápido, com a hora no passado,
    como se o vídeo tivesse acabado de ser gravado (a API não aceita hora no futuro)."""
    inicio = relogio() - (timedelta(seconds=duracao_estimada) if velocidade > 1 else timedelta())
    anterior = 0.0
    for segundo, imagem in fonte:
        dormir((segundo - anterior) / velocidade)
        anterior = segundo
        yield Quadro(imagem, inicio + timedelta(seconds=segundo))


def duracao_de(fonte: str, intervalo: float) -> float:
    caminho = Path(fonte)
    if caminho.is_dir():
        return len([p for p in caminho.iterdir() if p.suffix.lower() in EXTENSOES_FOTO]) * intervalo
    captura = cv2.VideoCapture(str(caminho))
    try:
        fps = captura.get(cv2.CAP_PROP_FPS) or 30
        return captura.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    finally:
        captura.release()


def abrir_fonte(
    fonte: str,
    intervalo: float,
    velocidade: float,
    cliente: httpx.Client,
    dormir: Callable[[float], None] = time.sleep,
    relogio: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> Iterator[Quadro | None]:
    esquema = urlsplit(fonte).scheme.lower()
    if esquema in ("rtsp", "rtsps"):
        return ao_vivo(partial(foto_rtsp, fonte), intervalo, dormir, relogio)
    if esquema in ("http", "https"):
        return ao_vivo(partial(foto_http, fonte, cliente), intervalo, dormir, relogio)
    caminho = Path(fonte)
    if caminho.is_dir():
        origem = de_pasta(caminho, intervalo)
    elif caminho.suffix.lower() in EXTENSOES_VIDEO and caminho.exists():
        origem = de_video(caminho, intervalo)
    else:
        raise SystemExit(f"fonte não reconhecida: {esconder_senha(fonte)}")
    return gravado(origem, duracao_de(fonte, intervalo), velocidade, dormir, relogio)


def enviar(cliente: httpx.Client, token: str, quadro: Quadro) -> httpx.Response:
    return cliente.post(
        "/visao/quadros",
        content=preparar_jpeg(quadro.imagem),
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "image/jpeg",
            "x-giro-em": quadro.em.isoformat(),
        },
    )


def rodar(
    fonte: str,
    token: str,
    cliente_visao: httpx.Client,
    intervalo: float = 10,
    velocidade: float = 1,
    limite: int | None = None,
    dormir: Callable[[float], None] = time.sleep,
    saida: Callable[[str], None] = _mostrar,
) -> int:
    """Manda as fotos até a fonte acabar (ou `limite` fotos). Devolve quantas foram aceitas."""
    with httpx.Client() as cliente_dvr:
        quadros = abrir_fonte(fonte, intervalo, velocidade, cliente_dvr, dormir)
        aceitas = falhas_seguidas = 0
        for numero, quadro in enumerate(quadros, start=1):
            if quadro is None:
                falhas_seguidas += 1
                saida(f"  câmera não respondeu ({falhas_seguidas}x seguidas)")
            else:
                resposta = enviar(cliente_visao, token, quadro)
                hora = quadro.em.astimezone().strftime("%H:%M:%S")
                if resposta.status_code == 200:
                    aceitas += 1
                    falhas_seguidas = 0
                    dados = resposta.json()
                    ocupadas = [m for m in dados["mesas"] if m["sentados"] or m["em_pe"]]
                    resumo = ", ".join(
                        f"mesa {m['mesa']}: {m['sentados']} sentado(s)"
                        + (f" e {m['em_pe']} em pé" if m["em_pe"] else "")
                        for m in ocupadas
                    )
                    saida(f"  {hora}  {dados['pessoas']} pessoa(s)  {resumo or 'mesas vazias'}")
                elif resposta.status_code == 401:
                    raise SystemExit("token da câmera recusado: confira em Ajustes > Câmeras")
                else:
                    saida(f"  {hora}  serviço de visão respondeu {resposta.status_code}")
            if limite and numero >= limite:
                break
    return aceitas


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="giro.conector",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--fonte",
        default=os.environ.get("GIRO_FONTE"),
        help="rtsp://, http(s)://, vídeo ou pasta (ou a variável GIRO_FONTE)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("GIRO_TOKEN"),
        help="chave da câmera, em Ajustes > Câmeras (ou a variável GIRO_TOKEN)",
    )
    parser.add_argument(
        "--visao", default="http://localhost:8001", help="endereço do serviço de visão"
    )
    parser.add_argument("--intervalo", type=float, default=10, help="segundos entre fotos")
    parser.add_argument(
        "--velocidade", type=float, default=1, help="só para vídeo/pasta: 1 = tempo real"
    )
    args = parser.parse_args()
    if not args.fonte or not args.token:
        parser.error("informe --fonte e --token (ou GIRO_FONTE e GIRO_TOKEN)")
    visao = conferir_visao(args.visao)

    _mostrar(f"Conector GIRO: {esconder_senha(args.fonte)} → {visao}")
    with httpx.Client(base_url=visao, timeout=30) as cliente:
        try:
            aceitas = rodar(args.fonte, args.token, cliente, args.intervalo, args.velocidade)
        except KeyboardInterrupt:
            _mostrar("\nConector parado.")
            return 0
    _mostrar(f"Fonte terminou. {aceitas} foto(s) aceitas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
