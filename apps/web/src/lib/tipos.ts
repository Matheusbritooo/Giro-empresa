// Espelha os formatos da API (services/backend/giro/esquemas.py).

export type Papel = "admin_giro" | "dono" | "gerente" | "equipe";

export type EstadoMesa = "livre" | "aguardando" | "ocupada" | "para_limpar";

export type TipoAlerta = "sem_atendimento" | "mesa_vaga";

export interface Restaurante {
  id: number;
  nome: string;
  cidade: string | null;
  alerta_atendimento_seg: number;
  ticket_medio_centavos: number;
  abre_as: string; // "HH:MM" em São Paulo
  fecha_as: string;
}

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  restaurante_id: number | null;
}

export interface Sessao {
  usuario: Usuario;
  restaurante: Restaurante | null;
}

export interface Mesa {
  id: number;
  numero: number;
  lugares: number;
  pos_x: number;
  pos_y: number;
  ativa: boolean;
  estado: EstadoMesa;
  estado_desde: string | null;
  camera_id: number | null;
  poligono: [number, number][] | null; // desenho sobre a imagem da câmera, de 0 a 1
  sentou_em: string | null;
  atendida_em: string | null;
  saiu_em: string | null;
  pessoas: number;
}

export interface Alerta {
  id: number;
  tipo: TipoAlerta;
  mesa_id: number;
  mesa_numero: number;
  criado_em: string;
  reconhecido_em: string | null;
  resolvido_em: string | null;
}

export interface AjustesVisao {
  proporcao_em_pe?: number;
  margem_atendimento?: number;
  confianca_minima?: number;
}

export interface Camera {
  id: number;
  nome: string;
  ativa: boolean;
  ultima_observacao_em: string | null;
  ajustes_visao: AjustesVisao | null;
}

/** O que a visão achou na última foto da câmera. Sem imagem. */
export interface LeituraCamera {
  em: string;
  pessoas: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    em_pe: boolean;
    mesa: number | null;
  }[];
  mesas: { mesa: number; sentados: number; em_pe: number }[];
}

export interface Salao {
  restaurante: Restaurante;
  mesas: Mesa[];
  alertas: Alerta[];
  cameras: Camera[];
  agora: string;
}

export type MensagemAoVivo =
  | { tipo: "salao"; salao: Salao }
  | { tipo: "mesa"; mesa: Mesa }
  | { tipo: "alerta"; alerta: Alerta }
  | { tipo: "camera"; camera: Camera };

// Resultados, replay, "E se?" e Copiloto (Fase 3)

export type Periodo = "noite" | "semana" | "mes";

export interface PorHora {
  hora: number;
  chegadas: number;
  ocupacao: number; // 0 a 1
}

export interface PorMesa {
  numero: number;
  lugares: number;
  visitas: number;
  desistencias: number;
  espera_media_seg: number | null;
  parada_media_seg: number | null;
  parada_total_seg: number;
  perdido_centavos: number;
}

export interface Indicadores {
  inicio: string;
  fim: string;
  noites: number;
  mesas_atendidas: number;
  pessoas_atendidas: number;
  desistencias: number;
  pessoas_desistiram: number;
  giro_medio: number;
  espera_media_seg: number | null;
  esperas_acima_do_limite: number;
  permanencia_media_seg: number | null;
  parada_media_seg: number | null;
  parada_total_seg: number;
  hora_pico: number | null;
  ticket_medio_centavos: number;
  perdido_desistencias_centavos: number;
  perdido_mesa_parada_centavos: number;
  perdido_total_centavos: number;
  por_hora: PorHora[];
  por_mesa: PorMesa[];
}

export interface ResumoNoite {
  dia: string;
  mesas_atendidas: number;
  giro_medio: number;
  desistencias: number;
  perdido_total_centavos: number;
}

export interface Resultados {
  periodo: Periodo;
  dia: string;
  atual: Indicadores;
  anterior: Indicadores;
  noites: ResumoNoite[];
}

export interface MesaReplay {
  id: number;
  numero: number;
  lugares: number;
  pos_x: number;
  pos_y: number;
}

/** Uma visita à mesa, só com horários (nunca imagem). */
export interface VisitaReplay {
  mesa_id: number;
  sentou_em: string;
  atendida_em: string | null;
  saiu_em: string | null;
  liberada_em: string | null;
  pessoas: number;
  sem_atendimento: boolean;
}

export interface Replay {
  dia: string;
  inicio: string;
  fim: string;
  limite_alerta_seg: number;
  mesas: MesaReplay[];
  visitas: VisitaReplay[];
}

export interface ResultadoCenario {
  turmas_a_mais: number;
  desistencias_evitadas: number;
  desistencias_novas: number;
  espera_media_atual_seg: number | null;
  espera_media_nova_seg: number | null;
  parada_media_atual_seg: number | null;
  parada_media_nova_seg: number | null;
  ganho_centavos: number;
  ganho_mes_centavos: number;
}

export interface BriefingCopiloto {
  dia: string;
  dia_semana: string;
  frases: string[];
  dicas: string[];
  ia_ligada: boolean;
}

export interface RespostaCopiloto {
  resposta: string;
  fonte: "ia" | "regras";
}
