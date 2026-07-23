import { formatHoras } from "../../utils/horas";
import { FunilSituacao } from "./FunilSituacao";
import { RankingBarra } from "../ui/RankingBarra";
import type { IndicadoresProjetosData } from "./IndicadoresProjetos";

interface WorkloadItem {
  codfor: number;
  nome: string;
  qtd: number;
  horas: number;
  atrasadas: number;
}

interface WorkloadConsultoresProps {
  itens: WorkloadItem[];
  porSituacao: IndicadoresProjetosData["porSituacao"];
  porDepartamento: IndicadoresProjetosData["porDepartamento"];
}

function toneAtraso(pctAtrasadas: number): string {
  if (pctAtrasadas >= 50) return "bg-destructive";
  if (pctAtrasadas >= 20) return "bg-warning";
  return "bg-primary";
}

// Carga de backlog (atividades ainda não concluídas) por consultor — mostra capacidade
// atual, não histórico. Ordenado por horas previstas (maior carga primeiro).
export function WorkloadConsultores({ itens, porSituacao, porDepartamento }: WorkloadConsultoresProps) {
  const maiorHoras = Math.max(1, ...itens.map((i) => i.horas));

  const totalSituacoes = porSituacao.reduce((soma, s) => soma + s.qtd, 0);
  const funilItens = porSituacao
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

  const departamentoItens = porDepartamento.map((d) => ({
    chave: d.depexe,
    nome: d.depexeLabel,
    quantidade: d.qtd,
    valor: d.horas,
  }));

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">
          Workload por consultor · backlog atual
        </p>
        <div className="space-y-4">
          {itens.map((item) => {
            const pctAtrasadas = item.qtd > 0 ? (item.atrasadas / item.qtd) * 100 : 0;
            return (
              <div key={item.codfor}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{item.nome}</span>
                  <span className="flex-none font-mono text-sm tabular-nums text-muted">
                    {item.qtd} atividades · {formatHoras(item.horas)}
                    {item.atrasadas > 0 && <span className="ml-2 text-destructive">{item.atrasadas} atrasada(s)</span>}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full transition-all ${toneAtraso(pctAtrasadas)}`}
                    style={{ width: `${Math.max(2, (item.horas / maiorHoras) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
          {itens.length === 0 && <p className="text-sm text-muted">Sem atividades em backlog para os filtros atuais.</p>}
        </div>
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
