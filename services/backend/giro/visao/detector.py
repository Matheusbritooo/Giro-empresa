"""Encontra pessoas numa foto com o YOLOX rodando no ONNX Runtime (só CPU, sem placa de vídeo)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

PESSOA = 0  # classe "person" do COCO, a única que interessa
LIMIAR_NMS = 0.45


@dataclass(frozen=True)
class Pessoa:
    """Uma pessoa encontrada. Coordenadas de 0 a 1 na foto (0,0 = canto superior esquerdo)."""

    x1: float
    y1: float
    x2: float
    y2: float
    confianca: float
    proporcao: float  # altura / largura da caixa, em pixels: em pé costuma dar bem mais que sentado

    @property
    def apoio(self) -> tuple[float, float]:
        """Ponto onde a pessoa "encosta" no salão: o meio da base da caixa."""
        return ((self.x1 + self.x2) / 2, self.y2)


class DetectorYolox:
    def __init__(self, caminho_modelo: Path, tamanho: int, threads: int | None = None) -> None:
        opcoes = ort.SessionOptions()
        opcoes.intra_op_num_threads = threads or min(4, os.cpu_count() or 1)
        self.sessao = ort.InferenceSession(
            str(caminho_modelo), sess_options=opcoes, providers=["CPUExecutionProvider"]
        )
        self.entrada = self.sessao.get_inputs()[0].name
        self.tamanho = tamanho

    def detectar(self, imagem: Image.Image, limiar: float = 0.35) -> list[Pessoa]:
        tensor, escala = preparar(imagem, self.tamanho)
        saida = self.sessao.run(None, {self.entrada: tensor[None]})[0][0]
        return interpretar(saida, self.tamanho, escala, imagem.size, limiar)


def preparar(imagem: Image.Image, tamanho: int) -> tuple[np.ndarray, float]:
    """Redimensiona sem distorcer e completa com cinza, como o YOLOX foi treinado (BGR, 0 a 255)."""
    imagem = imagem.convert("RGB")
    largura, altura = imagem.size
    escala = min(tamanho / largura, tamanho / altura)
    nova = imagem.resize((int(largura * escala), int(altura * escala)), Image.Resampling.BILINEAR)
    quadro = np.full((tamanho, tamanho, 3), 114, dtype=np.uint8)
    quadro[: nova.height, : nova.width] = np.asarray(nova)[:, :, ::-1]  # RGB para BGR
    return np.ascontiguousarray(quadro.transpose(2, 0, 1), dtype=np.float32), escala


def _grades(tamanho: int) -> tuple[np.ndarray, np.ndarray]:
    grades, passos = [], []
    for passo in (8, 16, 32):
        lado = tamanho // passo
        xs, ys = np.meshgrid(np.arange(lado), np.arange(lado))
        grades.append(np.stack((xs, ys), 2).reshape(-1, 2))
        passos.append(np.full((lado * lado, 1), passo))
    return np.concatenate(grades), np.concatenate(passos)


def interpretar(
    saida: np.ndarray,
    tamanho: int,
    escala: float,
    tamanho_imagem: tuple[int, int],
    limiar: float,
) -> list[Pessoa]:
    """Transforma a saída bruta do YOLOX (uma linha por ponto da grade) em pessoas."""
    grade, passo = _grades(tamanho)
    centro = (saida[:, :2] + grade) * passo
    medida = np.exp(np.clip(saida[:, 2:4], -10, 10)) * passo
    nota = saida[:, 4] * saida[:, 5 + PESSOA]

    manter = nota >= limiar
    if not manter.any():
        return []
    centro, medida, nota = centro[manter], medida[manter], nota[manter]
    caixas = np.concatenate([centro - medida / 2, centro + medida / 2], axis=1) / escala

    largura, altura = tamanho_imagem
    caixas[:, [0, 2]] = caixas[:, [0, 2]].clip(0, largura)
    caixas[:, [1, 3]] = caixas[:, [1, 3]].clip(0, altura)

    pessoas = []
    for i in _nms(caixas, nota, LIMIAR_NMS):
        x1, y1, x2, y2 = caixas[i]
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        pessoas.append(
            Pessoa(
                x1=float(x1 / largura),
                y1=float(y1 / altura),
                x2=float(x2 / largura),
                y2=float(y2 / altura),
                confianca=float(nota[i]),
                proporcao=float((y2 - y1) / (x2 - x1)),
            )
        )
    return pessoas


def _nms(caixas: np.ndarray, notas: np.ndarray, limiar: float) -> list[int]:
    """Remove caixas repetidas da mesma pessoa, ficando com a de maior nota."""
    areas = (caixas[:, 2] - caixas[:, 0]) * (caixas[:, 3] - caixas[:, 1])
    ordem = notas.argsort()[::-1]
    escolhidas = []
    while ordem.size:
        i = ordem[0]
        escolhidas.append(int(i))
        x1 = np.maximum(caixas[i, 0], caixas[ordem[1:], 0])
        y1 = np.maximum(caixas[i, 1], caixas[ordem[1:], 1])
        x2 = np.minimum(caixas[i, 2], caixas[ordem[1:], 2])
        y2 = np.minimum(caixas[i, 3], caixas[ordem[1:], 3])
        intersecao = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
        iou = intersecao / (areas[i] + areas[ordem[1:]] - intersecao + 1e-9)
        ordem = ordem[1:][iou <= limiar]
    return escolhidas
