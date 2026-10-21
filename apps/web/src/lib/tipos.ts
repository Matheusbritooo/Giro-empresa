// Espelha os formatos da API (services/backend/giro/esquemas.py).

export type Papel = "admin_giro" | "dono" | "gerente" | "equipe";

export type EstadoMesa = "livre" | "aguardando" | "ocupada" | "para_limpar";

export type TipoAlerta = "sem_atendimento" | "mesa_vaga";

export interface Restaurante {
  id: number;
  nome: string;
  cidade: string | null;
  alerta_atendimento_seg: number;
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

export interface Camera {
  id: number;
  nome: string;
  ativa: boolean;
  ultima_observacao_em: string | null;
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
  | { tipo: "alerta"; alerta: Alerta };
