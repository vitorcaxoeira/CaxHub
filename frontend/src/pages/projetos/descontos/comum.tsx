import axios from "axios";
import { useEffect, useState } from "react";
import { classeBotaoPerigo, classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../../components/gestao5s/campos";
import { Modal } from "../../../components/ui/Modal";
import { toneBadge, type Tone } from "../../../components/ui/badges";

// Peças compartilhadas das telas da Gestão de Descontos (Gestão de Projetos › Gestão de Descontos).

export const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const fmtMoeda = (v: number | null | undefined) => (v == null ? "—" : moeda.format(v));

const dataFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
/** Aceita "2026-11-10" e "2026-11-10T00:00:00.000Z": datas puras vêm da API em UTC. */
export const fmtData = (v: string | null | undefined) => (v ? dataFmt.format(new Date(v)) : "—");
/** "2026-11", "2026-11-01" ou ISO completo → "11/2026". */
export function fmtCompetencia(v: string | null | undefined): string {
  if (!v) return "—";
  const [ano, mes] = v.slice(0, 7).split("-");
  return `${mes}/${ano}`;
}
export const fmtDataHora = (v: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(v));

export type StatusProcesso = "ativo" | "quitado" | "cancelado" | "parcialmente_cancelado" | "vigencia_encerrada";
export type SituacaoParcela = "pendente" | "descontada" | "parcial" | "cancelada" | "estornada" | "quitada_antecipadamente";

export const TOM_STATUS: Record<StatusProcesso, Tone> = {
  ativo: "success",
  quitado: "neutral",
  cancelado: "destructive",
  parcialmente_cancelado: "warning",
  vigencia_encerrada: "warning",
};
export const TOM_SITUACAO: Record<SituacaoParcela, Tone> = {
  pendente: "warning",
  descontada: "success",
  parcial: "warning",
  cancelada: "destructive",
  estornada: "destructive",
  quitada_antecipadamente: "neutral",
};
export const STATUS_OPCOES: { valor: StatusProcesso; rotulo: string }[] = [
  { valor: "ativo", rotulo: "Ativo" },
  { valor: "quitado", rotulo: "Quitado" },
  { valor: "cancelado", rotulo: "Cancelado" },
  { valor: "parcialmente_cancelado", rotulo: "Parcialmente cancelado" },
  { valor: "vigencia_encerrada", rotulo: "Vigência encerrada" },
];
export const SITUACAO_OPCOES: { valor: SituacaoParcela; rotulo: string }[] = [
  { valor: "pendente", rotulo: "Pendente" },
  { valor: "descontada", rotulo: "Descontada" },
  { valor: "parcial", rotulo: "Parcial" },
  { valor: "cancelada", rotulo: "Cancelada" },
  { valor: "estornada", rotulo: "Estornada" },
  { valor: "quitada_antecipadamente", rotulo: "Quitada antecipadamente" },
];

export function Selo({ texto, tone }: { texto: string; tone: Tone }) {
  return (
    <span className={`inline-block max-w-full truncate whitespace-nowrap align-bottom rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[tone]}`} title={texto}>
      {texto}
    </span>
  );
}

export interface AcessoDescontos {
  administra: boolean;
  gestao: boolean;
  visualiza: boolean;
  proprioCodfor: number | null;
}

/** Acesso da pessoa ao módulo (o backend decide; as telas só escondem o que ela não pode usar). */
export function useAcessoDescontos(): AcessoDescontos | null {
  const [acesso, setAcesso] = useState<AcessoDescontos | null>(null);
  useEffect(() => {
    let cancelado = false;
    axios
      .get<AcessoDescontos>("/api/descontos/meu-acesso")
      .then(({ data }) => !cancelado && setAcesso(data))
      .catch(() => !cancelado && setAcesso({ administra: false, gestao: false, visualiza: false, proprioCodfor: null }));
    return () => {
      cancelado = true;
    };
  }, []);
  return acesso;
}

export interface OpcaoConsultor {
  codfor: number;
  nome: string;
}
export interface OpcaoTipo {
  id: number;
  nome: string;
  ativo: boolean;
  permiteParcelamento: boolean;
  maxParcelas: number | null;
  valorMinimo: number | null;
  valorMaximo: number | null;
  exigeObservacao: boolean;
}

/** Consultores que a pessoa pode escolher (quem administra: todos; gestor: o time; consultor: ele mesmo) e os tipos cadastrados. */
export function useOpcoesDescontos() {
  const [consultores, setConsultores] = useState<OpcaoConsultor[]>([]);
  const [tipos, setTipos] = useState<OpcaoTipo[]>([]);
  useEffect(() => {
    let cancelado = false;
    axios
      .get<{ consultores: OpcaoConsultor[] }>("/api/descontos/consultores")
      .then(({ data }) => !cancelado && setConsultores(data.consultores))
      .catch(() => undefined);
    axios
      .get<{ tipos: OpcaoTipo[] }>("/api/descontos/tipos")
      .then(({ data }) => !cancelado && setTipos(data.tipos))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);
  return { consultores, tipos };
}

export function mensagemDe(err: unknown, padrao: string): string {
  return axios.isAxiosError(err) ? (err.response?.data?.error ?? padrao) : padrao;
}

/** Classe dos campos soltos do topo das listas (mesmo visual dos filtros de Listar Pedidos). */
export const classeFiltro =
  "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Pede a justificativa (obrigatória: cancelamento, estorno e quitação ficam no histórico com o motivo) e só então executa a ação.
 * Não fecha sozinho com Esc/clique fora: a pessoa pode ter digitado o texto.
 */
export function ModalJustificativa({
  titulo,
  descricao,
  rotuloConfirmar,
  perigo = true,
  onConfirmar,
  onFechar,
}: {
  titulo: string;
  descricao: string;
  rotuloConfirmar: string;
  perigo?: boolean;
  onConfirmar: (justificativa: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const valido = texto.trim().length >= 3;

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      await onConfirmar(texto.trim());
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível concluir a ação"));
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title={titulo} fecharPorFora={false}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{descricao}</p>
        <div>
          <label className={classeRotulo} htmlFor="justificativa-desconto">
            Justificativa
          </label>
          <textarea
            id="justificativa-desconto"
            className={classeCampo}
            rows={3}
            maxLength={500}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Explique o motivo (fica registrado no histórico)"
            autoFocus
          />
        </div>
        {erro && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} disabled={enviando} className={classeBotaoSecundario}>
            Voltar
          </button>
          <button type="button" onClick={confirmar} disabled={!valido || enviando} className={perigo ? classeBotaoPerigo : classeBotaoPrimario}>
            {enviando ? "Aguarde…" : rotuloConfirmar}
          </button>
        </div>
      </div>
    </Modal>
  );
}
