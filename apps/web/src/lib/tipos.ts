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
  // Pedido da visita em curso: quanto a mesa já gastou e quantos itens estão na cozinha.
  total_pedido_centavos: number;
  itens_na_cozinha: number;
  // Pediu a conta: quando o garçom avisou e quando a mesa deve vagar.
  conta_pedida_em?: string | null;
  vaga_prevista_em?: string | null;
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
  | { tipo: "camera"; camera: Camera }
  | AvisoAoVivo;

/** Avisos que não mudam o mapa: quem precisa busca de novo (pedido da mesa, cardápio). */
export type AvisoAoVivo = { tipo: "pedido"; mesa_id: number } | { tipo: "cardapio" };

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
  ticket_real: boolean; // o ticket veio dos pedidos lançados, não de Ajustes
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

// Cardápio e pedidos

export interface CategoriaCardapio {
  id: number;
  nome: string;
  ordem: number;
  bebida: boolean;
  ativa: boolean;
}

export interface ItemCardapio {
  id: number;
  categoria_id: number;
  nome: string;
  descricao: string | null;
  preco_centavos: number;
  custo_centavos: number | null; // só o dono recebe
  ativo: boolean;
  disponivel: boolean; // "tem hoje"
}

export interface Cardapio {
  categorias: CategoriaCardapio[];
  itens: ItemCardapio[];
  mostra_custo: boolean;
  mais_pedidos: number[];
}

export interface ItemPedido {
  id: number;
  mesa_id: number;
  ocupacao_id: number;
  item_id: number;
  nome: string;
  preco_unit_centavos: number;
  quantidade: number;
  observacao: string | null;
  lancado_em: string;
  pronto_em: string | null;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
}

export interface ItemCozinha extends ItemPedido {
  mesa_numero: number;
}

export interface PedidoMesa {
  mesa: Mesa;
  itens: ItemPedido[];
  total_centavos: number;
}

export const MOTIVOS_CANCELAMENTO = [
  "Cliente desistiu",
  "Lançado errado",
  "Demorou demais",
  "Prato voltou",
  "Outro",
] as const;

export interface ItemVendido {
  item_id: number;
  nome: string;
  categoria: string;
  bebida: boolean;
  quantidade: number;
  receita_centavos: number;
}

export interface MesaCardapio {
  numero: number;
  visitas: number;
  pessoas: number;
  total_centavos: number;
  prato: string | null;
  prato_quantidade: number;
  bebida: string | null;
  bebida_quantidade: number;
}

export type Quadrante = "estrela" | "burro_de_carga" | "quebra_cabeca" | "cao";

export interface ItemMatriz {
  item_id: number;
  nome: string;
  quantidade: number;
  lucro_unidade_centavos: number;
  quadrante: Quadrante;
}

export interface MatrizCategoria {
  categoria: string;
  matriz: { itens: ItemMatriz[]; lucro_medio_centavos: number; sem_custo: string[] };
}

export interface Combinacao {
  item: string;
  acompanha: { nome: string; percentual: number }[];
}

export interface TempoDoItem {
  nome: string;
  tempo: {
    minutos: number;
    minutos_fim_de_semana: number | null;
    minutos_semana: number | null;
    amostras: number;
  };
}

export interface ResultadosCardapio {
  periodo: Periodo;
  dia: string;
  faturamento_centavos: number;
  visitas_com_pedido: number;
  pessoas: number;
  ticket_real_centavos: number | null;
  itens: ItemVendido[];
  mesas: MesaCardapio[];
  matrizes: MatrizCategoria[] | null; // só o dono recebe
  combinacoes: Combinacao[];
  tempos: TempoDoItem[];
}
