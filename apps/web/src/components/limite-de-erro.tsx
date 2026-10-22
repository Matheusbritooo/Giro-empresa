"use client";

import { Component, type ReactNode } from "react";

/** Se a parte de dentro quebrar, mostra `reserva` no lugar e avisa quem está em volta. */
export class LimiteDeErro extends Component<
  { reserva: ReactNode; aoFalhar?: (erro: Error) => void; children: ReactNode },
  { falhou: boolean }
> {
  state = { falhou: false };

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  componentDidCatch(erro: Error) {
    this.props.aoFalhar?.(erro);
  }

  render() {
    return this.state.falhou ? this.props.reserva : this.props.children;
  }
}
