export interface AgingBucketPropostas {
  bucket: string;
  label: string;
  quantidade: number;
  valor: number;
  pct: number;
}

interface AgingPipelineChartProps {
  buckets: AgingBucketPropostas[];
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

// Só visualização (sem clique/drill-down), diferente dos 4 cards de Alertas de Ação.
// Cohort "em decisão" (sitpro IN 1,2,3), idade contada desde datpro.
export function AgingPipelineChart({ buckets }: AgingPipelineChartProps) {
  const maiorValor = Math.max(1, ...buckets.map((b) => b.valor));

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">Aging do Pipeline Aberto</p>

      <div className="space-y-3">
        {buckets.map((b) => (
          <div key={b.bucket}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-sm text-foreground">
                {b.label} <span className="text-muted">({b.quantidade})</span>
              </span>
              <span className="flex-none font-mono text-sm font-semibold tabular-nums text-foreground">
                {fmtMoney(b.valor)} · {b.pct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${Math.max(2, (b.valor / maiorValor) * 100)}%` }} />
            </div>
          </div>
        ))}
        {buckets.length === 0 && <p className="text-sm text-muted">Sem propostas em decisão para os filtros atuais.</p>}
      </div>
    </section>
  );
}
