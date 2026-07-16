export interface DonutItem {
  chave: string | number;
  nome: string;
  valor: number;
  pct: number;
}

interface DonutChartProps {
  titulo: string;
  itens: DonutItem[];
  formatarValor?: (valor: number) => string;
  alerta?: string;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatarValorPadrao = (valor: number) => `R$ ${currency.format(valor)}`;

// Gradiente monocromático (tons decrescentes da cor primária) — comunica
// ranking/concentração sem precisar de uma paleta categórica arbitrária.
function corSegmento(i: number, total: number, ehUltimoDemais: boolean): string {
  if (ehUltimoDemais) return "var(--border)";
  const opacidade = total <= 1 ? 100 : Math.max(28, 100 - i * (60 / (total - 1)));
  return `color-mix(in srgb, var(--primary) ${opacidade}%, transparent)`;
}

export function DonutChart({ titulo, itens, formatarValor = formatarValorPadrao, alerta }: DonutChartProps) {
  const cores = itens.map((_, i) => corSegmento(i, itens.length, i === itens.length - 1 && itens[i].chave === "demais"));

  let acumulado = 0;
  const gradiente = itens
    .map((item, i) => {
      const inicio = acumulado;
      acumulado += item.pct;
      return `${cores[i]} ${inicio}% ${acumulado}%`;
    })
    .join(", ");

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</p>

      {alerta && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive">
          {alerta}
        </p>
      )}

      {itens.length === 0 ? (
        <p className="text-sm text-muted">Sem dados para os filtros atuais.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <div className="relative h-32 w-32 flex-none rounded-full" style={{ background: `conic-gradient(${gradiente})` }}>
            <div className="absolute inset-[18%] rounded-full bg-surface" />
          </div>

          <div className="flex-1 space-y-2">
            {itens.map((item, i) => (
              <div key={item.chave} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: cores[i] }} />
                <span className="flex-1 truncate text-foreground">{item.nome}</span>
                <span className="flex-none font-mono text-[12.5px] tabular-nums text-muted">
                  {formatarValor(item.valor)} · {item.pct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
