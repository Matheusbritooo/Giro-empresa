"""Prévia da câmera para o técnico desenhar as mesas, sem mostrar o rosto de ninguém.

A foto original nunca é guardada. A prévia é uma cópia reduzida em que cada pessoa vira um
bloco de pixels grandes, e ela só vive na memória do serviço de visão por alguns minutos.
"""

from __future__ import annotations

from io import BytesIO

from PIL import Image

from giro.visao.detector import Pessoa

LARGURA_PREVIA = 960
FOLGA = 0.12  # aumenta a área borrada em 12% para cobrir cabelo, ombros e mãos
BLOCOS = 6


def previa_sem_rostos(imagem: Image.Image, pessoas: list[Pessoa]) -> bytes:
    imagem = imagem.convert("RGB")
    if imagem.width > LARGURA_PREVIA:
        altura = round(imagem.height * LARGURA_PREVIA / imagem.width)
        imagem = imagem.resize((LARGURA_PREVIA, altura), Image.Resampling.BILINEAR)
    else:
        imagem = imagem.copy()

    largura, altura = imagem.size
    for pessoa in pessoas:
        folga_x = (pessoa.x2 - pessoa.x1) * FOLGA
        folga_y = (pessoa.y2 - pessoa.y1) * FOLGA
        caixa = (
            max(0, int((pessoa.x1 - folga_x) * largura)),
            max(0, int((pessoa.y1 - folga_y) * altura)),
            min(largura, int((pessoa.x2 + folga_x) * largura) + 1),
            min(altura, int((pessoa.y2 + folga_y) * altura) + 1),
        )
        if caixa[2] - caixa[0] < 2 or caixa[3] - caixa[1] < 2:
            continue
        recorte = imagem.crop(caixa)
        # Pixelização forte: 6 blocos na largura da pessoa deixam o rosto com uns 2 blocos.
        blocos_y = max(1, round(BLOCOS * recorte.height / recorte.width))
        pequeno = recorte.resize((BLOCOS, blocos_y), Image.Resampling.BILINEAR)
        imagem.paste(pequeno.resize(recorte.size, Image.Resampling.NEAREST), caixa[:2])

    saida = BytesIO()
    imagem.save(saida, format="JPEG", quality=70)
    return saida.getvalue()
