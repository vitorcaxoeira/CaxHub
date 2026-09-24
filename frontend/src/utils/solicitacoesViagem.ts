import type { Tone } from "../components/ui/badges";

// Tipos, rótulos e helpers do módulo Gestão de Solicitações (viagens). Os tipos espelham o que
// backend/src/routes/solicitacoesViagem.ts devolve em serializar().

export type StatusViagem =
  | "solicitada"
  | "em_cotacao"
  | "aguardando_aprovacao"
  | "aprovada"
  | "reprovada"
  | "reservada"
  | "finalizada"
  | "cancelada";

export const STATUS_ROTULO: Record<StatusViagem, string> = {
  solicitada: "Solicitada",
  em_cotacao: "Em cotação",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovada: "Aprovada",
  reprovada: "Reprovada",
  reservada: "Reservada",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
};

export const STATUS_TOM: Record<StatusViagem, Tone> = {
  solicitada: "neutral",
  em_cotacao: "warning",
  aguardando_aprovacao: "warning",
  aprovada: "success",
  reprovada: "destructive",
  reservada: "success",
  finalizada: "neutral",
  cancelada: "destructive",
};

// Ordem do fluxo feliz, pro stepper do detalhe.
export const FLUXO: StatusViagem[] = ["solicitada", "em_cotacao", "aguardando_aprovacao", "aprovada", "reservada", "finalizada"];

export type Finalidade = "projeto" | "comercial" | "interna" | "treinamento" | "outro";

export const FINALIDADE_ROTULO: Record<Finalidade, string> = {
  projeto: "Projeto / consultoria",
  comercial: "Visita comercial",
  interna: "Interna",
  treinamento: "Treinamento",
  outro: "Outro",
};

// projeto → proposta obrigatória (o cliente vem dela); comercial → cliente obrigatório.
export const FINALIDADE_DICA: Record<Finalidade, string> = {
  projeto: "Informe a proposta — o cliente vem dela.",
  comercial: "Informe o cliente. A proposta é opcional.",
  interna: "Cliente e proposta são opcionais.",
  treinamento: "Cliente e proposta são opcionais.",
  outro: "Cliente e proposta são opcionais.",
};

export type TipoItem = "hospedagem" | "aereo" | "carro";

export const TIPO_ROTULO: Record<TipoItem, string> = {
  hospedagem: "Hospedagem",
  aereo: "Passagem aérea",
  carro: "Aluguel de carro",
};

export interface Viajante {
  id?: number;
  userId: number | null;
  nome: string;
  cpf: string;
}

export interface ItemViagem {
  id?: number;
  tipo: TipoItem;
  /** Hoje: índices em `viajantes` (formulário). No detalhe: ids de viajante. */
  viajantes: number[];
  cidade: string;
  origem: string;
  destino: string;
  dataInicio: string;
  dataFim: string;
  horaInicio: string;
  horaFim: string;
  tipoAcomodacao: string;
  hotelPreferencia: string;
  necessidades: string;
  flexibilidadeHorario: string;
  bagagem: string;
  companhiaPreferencia: string;
  localRetirada: string;
  localDevolucao: string;
  categoriaVeiculo: string;
  observacoes: string;
  fornecedor?: string | null;
  localizador?: string | null;
  valorReservado?: number | null;
}

export function itemVazio(tipo: TipoItem): ItemViagem {
  return {
    tipo,
    viajantes: [],
    cidade: "",
    origem: "",
    destino: "",
    dataInicio: "",
    dataFim: "",
    horaInicio: "",
    horaFim: "",
    tipoAcomodacao: "individual",
    hotelPreferencia: "",
    necessidades: "",
    flexibilidadeHorario: "",
    bagagem: "",
    companhiaPreferencia: "",
    localRetirada: "",
    localDevolucao: "",
    categoriaVeiculo: "",
    observacoes: "",
  };
}

// ---------- CPF ----------

export function soDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

export function mascararCpfDigitado(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// Mesma regra do backend (domain/solicitacoesViagem.ts): dígito verificador + sem repetidos.
export function cpfValido(v: string): boolean {
  const cpf = soDigitos(v);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(cpf.slice(0, 9), 10) === Number(cpf[9]) && digito(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

// O detalhe já traz o CPF completo (só dígitos) ou mascarado pelo servidor ("***.456.789-**").
export function formatarCpfExibicao(v: string): string {
  return v.includes("*") ? v : mascararCpfDigitado(v);
}

// ---------- datas / valores ----------

export function formatarDia(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function diaMes(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

export function formatarPeriodo(inicio: string | null, fim: string | null): string {
  if (!inicio) return "—";
  return fim && fim !== inicio ? `${formatarDia(inicio)} a ${formatarDia(fim)}` : formatarDia(inicio);
}

export const formatarMoeda = (v: number | null | undefined): string =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------- roteiro ----------

export interface LinhaRoteiro {
  ordenacao: string;
  texto: string;
}

// Roteiro por viajante no formato do pedido do cliente ("01/10 – Rio do Sul → São Paulo",
// "01/10 a 03/10 – Hospedagem em São Paulo"): junta passagem + hospedagem + carro da mesma
// pessoa, em ordem de data. `viajantesDoItem` traduz o item pra chaves de viajante (índice no
// formulário, id no detalhe) — quem chama passa a mesma chave usada em `viajantes`.
export function montarRoteiro(
  viajantes: { chave: number; nome: string }[],
  itens: { tipo: TipoItem; viajantes: number[]; cidade?: string | null; origem?: string | null; destino?: string | null; dataInicio?: string | null; dataFim?: string | null; localRetirada?: string | null; localDevolucao?: string | null }[]
): { nome: string; linhas: string[] }[] {
  return viajantes
    .map((v) => {
      const linhas: LinhaRoteiro[] = [];
      for (const i of itens) {
        if (!i.viajantes.includes(v.chave) || !i.dataInicio) continue;
        const ini = diaMes(i.dataInicio);
        const fim = i.dataFim && i.dataFim !== i.dataInicio ? ` a ${diaMes(i.dataFim)}` : "";
        if (i.tipo === "aereo") {
          linhas.push({ ordenacao: i.dataInicio, texto: `${ini} – ${i.origem || "?"} → ${i.destino || "?"}` });
          if (i.dataFim) linhas.push({ ordenacao: i.dataFim, texto: `${diaMes(i.dataFim)} – ${i.destino || "?"} → ${i.origem || "?"} (retorno)` });
        } else if (i.tipo === "hospedagem") {
          linhas.push({ ordenacao: i.dataInicio, texto: `${ini}${fim} – Hospedagem em ${i.cidade || "?"}` });
        } else {
          linhas.push({ ordenacao: i.dataInicio, texto: `${ini}${fim} – Carro: retirada em ${i.localRetirada || "?"}, devolução em ${i.localDevolucao || "?"}` });
        }
      }
      linhas.sort((a, b) => a.ordenacao.localeCompare(b.ordenacao));
      return { nome: v.nome, linhas: linhas.map((l) => l.texto) };
    })
    .filter((r) => r.linhas.length > 0);
}

export function mensagemDeErro(err: unknown, padrao: string): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error ?? padrao;
}
