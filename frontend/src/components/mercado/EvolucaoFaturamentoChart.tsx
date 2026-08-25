// Gráfico "Evolução do Valor Faturamento" — barras + rótulo de % de crescimento por barra.
// Não existe componente parecido no repo (SerieTemporalBarra.tsx não suporta rótulo por
// barra), construído do zero seguindo o mesmo estilo visual (ver componente irmão).
export interface PontoEvolucaoAnual {
  ano: number;
  valor: number;
  percCrescimento: number | null;
}

interface EvolucaoFaturamentoChartProps {
  titulo: string;
  pontos: PontoEvolucaoAnual[];
  formatarValor?: (valor: number) => string;
}

const formatarValorPadrao = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export function EvolucaoFaturamentoChart({ titulo, pontos, formatarValor = formatarValorPadrao }: EvolucaoFaturamentoChartProps) {
  const maior = Math.max(1, ...pontos.map((p) => p.valor));

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</p>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-2 w-2 rounded-full bg-primary" /> Valor Faturamento
        </span>
      </div>

      <div className="flex h-56 items-end gap-4">
        {pontos.map((ponto) => (
          <div key={ponto.ano} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="font-mono text-[11px] tabular-nums text-muted">{formatarValor(ponto.valor)}</span>
            <div className="flex w-full flex-1 items-end justify-center">
              <div
                className="w-full max-w-[64px] rounded-t bg-primary"
                style={{ height: `${Math.max(2, (ponto.valor / maior) * 100)}%` }}
                title={`${ponto.ano} — ${formatarValor(ponto.valor)}`}
              />
            </div>
            {ponto.percCrescimento != null ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                  ponto.percCrescimento >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                }`}
              >
                {ponto.percCrescimento >= 0 ? "+" : ""}
                {ponto.percCrescimento.toFixed(2).replace(".", ",")}%
              </span>
            ) : (
              <span className="text-[10px] text-muted">—</span>
            )}
            <span className="text-[11px] text-muted">{ponto.ano}</span>
          </div>
        ))}
        {pontos.length === 0 && <p className="text-sm text-muted">Sem dados para o período.</p>}
      </div>
    </section>
  );
}
