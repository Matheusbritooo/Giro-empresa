"""Modelos de detecção de pessoas: YOLOX (Megvii, licença Apache 2.0, livre para uso comercial).

Uso: uv run python -m giro.visao.modelo [yolox_s|yolox_tiny|yolox_nano]
Baixa o arquivo uma vez, confere o hash e guarda em ~/.cache/giro/modelos (ou GIRO_VISAO_PASTA).
"""

from __future__ import annotations

import hashlib
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import httpx

ORIGEM = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0"


@dataclass(frozen=True)
class Modelo:
    nome: str
    tamanho: int  # lado da imagem de entrada, em pixels
    sha256: str

    @property
    def url(self) -> str:
        return f"{ORIGEM}/{self.nome}.onnx"


# Do mais preciso ao mais leve, com o tempo medido por foto num núcleo de CPU:
# yolox_s ~220 ms (padrão), yolox_tiny ~65 ms, yolox_nano ~25 ms.
MODELOS = {
    m.nome: m
    for m in (
        Modelo("yolox_s", 640, "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063"),
        Modelo(
            "yolox_tiny", 416, "427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7"
        ),
        Modelo(
            "yolox_nano", 416, "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d"
        ),
    )
}


def pasta_padrao() -> Path:
    return Path(os.environ.get("GIRO_VISAO_PASTA", Path.home() / ".cache" / "giro" / "modelos"))


def _hash(caminho: Path) -> str:
    resumo = hashlib.sha256()
    with caminho.open("rb") as arquivo:
        for bloco in iter(lambda: arquivo.read(1 << 20), b""):
            resumo.update(bloco)
    return resumo.hexdigest()


def garantir_modelo(nome: str = "yolox_s", pasta: Path | None = None) -> Path:
    """Devolve o caminho do modelo, baixando se ainda não existir. Recusa arquivo adulterado."""
    modelo = MODELOS[nome]
    pasta = pasta or pasta_padrao()
    destino = pasta / f"{nome}.onnx"
    if destino.exists():
        if _hash(destino) != modelo.sha256:
            raise RuntimeError(f"{destino} não confere com o hash esperado; apague e baixe de novo")
        return destino

    pasta.mkdir(parents=True, exist_ok=True)
    temporario = destino.with_suffix(".baixando")
    with httpx.stream("GET", modelo.url, follow_redirects=True, timeout=60) as resposta:
        resposta.raise_for_status()
        with temporario.open("wb") as arquivo:
            for bloco in resposta.iter_bytes(1 << 20):
                arquivo.write(bloco)
    if _hash(temporario) != modelo.sha256:
        temporario.unlink()
        raise RuntimeError(f"download de {nome} veio diferente do esperado")
    temporario.rename(destino)
    return destino


if __name__ == "__main__":
    nome = sys.argv[1] if len(sys.argv) > 1 else "yolox_s"
    print(garantir_modelo(nome))
