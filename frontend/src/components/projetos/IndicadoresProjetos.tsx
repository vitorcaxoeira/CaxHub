import { FunilSituacao } from "./FunilSituacao";
import { RankingBarra } from "../ui/RankingBarra";
import { formatHoras } from "../../utils/horas";

export interface IndicadoresProjetosData {
  totalBacklog: number;
  horasBacklog: number;
  totalAtrasadas: number;
  pctAtrasadas: number | null;
  slaPct: number | null;
  slaAmostra: number;
  porSituacao: { colunaId: number | null; nome: string; corBadge: string | null; qtd: number; horas: number }[];
  porDepartamento: { depexe: number; depexeLabel: string; qtd: number; horas: number; atrasadas: number }[];
  porConsultor: { codfor: number; nome: string; qtd: number; horas: number; atrasadas: number }[];
}

interface IndicadoresProjetosProps {
  dados: IndicadoresProjetosData;
}

const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

const toneText: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  neutral: "text-foreground",
};
const toneBg: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-muted",
};

function toneAtraso(pct: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 50) return "destructive";
  if (pct >= 20) return "warning";
  return "success";
}

function toneSla(pct: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 80) return "success";
  if (pct >= 50) return "warning";
  return "destructive";
}

export function IndicadoresProjetos({ dados }: IndicadoresProjetosProps) {
  const totalSituacoes = dados.porSituacao.reduce((soma, s) => soma + s.qtd, 0);
  const funilItens = dados.porSituacao
    .slice()
    .sort((a, b) => (a.colunaId ?? 0) - (b.colunaId ?? 0))
    .map((s) => ({
      key: String(s.colunaId),
      label: s.nome,
      quantidade: s.qtd,
      valor: s.horas,
      pct: totalSituacoes > 0 ? Math.round((s.qtd / totalSituacoes) * 100) : 0,
      tone: (s.corBadge ?? "neutral") as "success" | "warning" | "destructive" | "neutral",
    }));

  const departamentoItens = dados.porDepartamento.map((d) => ({
    chave: d.depexe,
    nome: d.depexeLabel,
    quantidade: d.qtd,
    valor: d.horas,
  }));

  const cards = [
    {
      label: "Backlog",
      value: dados.totalBacklog.toLocaleString("pt-BR"),
      sub: `${formatHoras(dados.horasBacklog)} previstas`,
      tone: "neutral" as const,
    },
    {
      label: "Atrasadas",
      value: dados.totalAtrasadas.toLocaleString("pt-BR"),
      sub: `${fmtPct(dados.pctAtrasadas)} do backlog`,
      tone: toneAtraso(dados.pctAtrasadas),
    },
    {
      label: "SLA (concluídas no prazo)",
      value: fmtPct(dados.slaPct),
      sub: dados.slaAmostra > 0 ? `${dados.slaAmostra.toLocaleString("pt-BR")} concluídas com histórico` : "sem amostra ainda",
      tone: toneSla(dados.slaPct),
    },
  ];

  return (
    <div className="mb-6 space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">{card.label}</p>
            <span className={`block font-mono text-2xl font-semibold tabular-nums ${toneText[card.tone]}`}>{card.value}</span>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span className={`h-1.5 w-1.5 flex-none rounded-full ${toneBg[card.tone]}`} />
              {card.sub}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FunilSituacao
          itens={funilItens}
          titulo="Funil por situação (quantidade)"
          formatarValor={formatHoras}
          unidade="atividades"
        />
        <RankingBarra
          titulo="Backlog por departamento"
          itens={departamentoItens}
          unidade="atividades"
          formatarValor={formatHoras}
          descricao="horas previstas"
        />
      </div>
    </div>
  );
}
