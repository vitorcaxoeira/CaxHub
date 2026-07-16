export interface AgingBucket {
  bucket: string;
  label: string;
  valor: number;
  quantidade: number;
  pct: number;
}

interface AgingBucketsChartProps {
  buckets: AgingBucket[];
  selecionado: string | null;
  onSelectBucket: (bucket: string | null) => void;
  formatarValor?: (valor: number) => string;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatarValorPadrao = (valor: number) => `R$ ${currency.format(valor)}`;

// Buckets clicáveis — clicar filtra a tabela de clientes em risco abaixo;
// clicar de novo no mesmo bucket limpa o filtro.
export function AgingBucketsChart({ buckets, selecionado, onSelectBucket, formatarValor = formatarValorPadrao }: AgingBucketsChartProps) {
  const maiorValor = Math.max(1, ...buckets.map((b) => b.valor));

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">Aging da carteira vencida</p>

      <div className="space-y-3">
        {buckets.map((b) => {
          const ativo = selecionado === b.bucket;
          return (
            <button
              key={b.bucket}
              onClick={() => onSelectBucket(ativo ? null : b.bucket)}
              className={`block w-full rounded-md p-1.5 text-left transition ${ativo ? "bg-surface-2 ring-1 ring-primary" : "hover:bg-surface-2"}`}
            >
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm text-foreground">
                  {b.label} <span className="text-muted">({b.quantidade})</span>
                </span>
                <span className="flex-none font-mono text-sm font-semibold tabular-nums text-foreground">
                  {formatarValor(b.valor)} · {b.pct.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full transition-all ${ativo ? "bg-primary" : "bg-primary/60"}`}
                  style={{ width: `${Math.max(2, (b.valor / maiorValor) * 100)}%` }}
                />
              </div>
            </button>
          );
        })}
        {buckets.length === 0 && <p className="text-sm text-muted">Sem títulos vencidos para os filtros atuais.</p>}
      </div>
    </section>
  );
}
