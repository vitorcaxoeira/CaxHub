export interface PontoRecebidoDia {
  dia: string;
  valor: number;
}

interface RecebidoPorDiaChartProps {
  titulo: string;
  pontos: PontoRecebidoDia[];
}

const currencyFull = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoneyFull = (v: number) => `R$ ${currencyFull.format(v)}`;

function abreviarValor(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const milhoes = v / 1_000_000;
    return `${Number.isInteger(milhoes) ? milhoes.toFixed(0) : milhoes.toFixed(1)}M`;
  }
  if (abs >= 1_000) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v)}`;
}

function calcularMediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 !== 0 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

const hojeLabel = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

// Barras de "Recebido por dia" com eixo de referência, tratamento de outlier
// (clamp em ~2,5x a mediana dos dias com recebimento) e linha de média —
// componente dedicado (não o SerieTemporalBarra genérico) pois essas regras
// só fazem sentido pra uma série monetária diária, não pros gráficos de
// comparação de 2 séries (Fluxo de Caixa, Histórico).
export function RecebidoPorDiaChart({ titulo, pontos }: RecebidoPorDiaChartProps) {
  const valores = pontos.map((p) => p.valor);
  const total = valores.reduce((a, b) => a + b, 0);
  const mediaDiaria = pontos.length > 0 ? total / pontos.length : 0;
  const mediana = calcularMediana(valores.filter((v) => v > 0));
  const maior = valores.reduce((max, v) => (v > max ? v : max), 0);

  const outlierAtivo = mediana > 0 && maior > mediana * 4;
  const scaleMax = outlierAtivo ? mediana * 2.5 : Math.max(1, maior);

  const top3 = new Set(
    valores
      .map((valor, i) => ({ i, valor }))
      .filter((x) => x.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 3)
      .map((x) => x.i)
  );

  const ticks = [scaleMax / 3, (scaleMax * 2) / 3, scaleMax];
  const mediaPct = scaleMax > 0 ? Math.min(100, (mediaDiaria / scaleMax) * 100) : 0;

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</p>
        {pontos.length > 0 && (
          <p className="text-[11px] text-muted">
            Total {fmtMoneyFull(total)} · Média {fmtMoneyFull(mediaDiaria)}/dia
          </p>
        )}
      </div>

      {pontos.length === 0 ? (
        <p className="text-sm text-muted">Sem dados para os filtros atuais.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="relative h-32">
            {ticks.map((tick, idx) => (
              <div key={idx} className="absolute inset-x-0 flex items-center" style={{ bottom: `${(tick / scaleMax) * 100}%` }}>
                <span className="w-9 shrink-0 pr-1.5 text-right font-mono text-[9px] text-muted">{abreviarValor(tick)}</span>
                <span className="h-px flex-1 bg-border/40" />
              </div>
            ))}

            {mediaDiaria > 0 && (
              <div className="absolute inset-x-0 flex items-center" style={{ bottom: `${mediaPct}%` }}>
                <span className="w-9 shrink-0" />
                <span className="h-0 flex-1 border-t border-dashed border-muted/60" />
                <span className="ml-1.5 shrink-0 whitespace-nowrap text-[9px] text-muted">média</span>
              </div>
            )}

            <div className="flex h-full items-end gap-1.5 pl-9">
              {pontos.map((ponto, i) => {
                const valor = ponto.valor;
                const isOutlier = outlierAtivo && valor > scaleMax;
                const barPct = valor <= 0 ? 0 : Math.max(4, Math.min(100, (Math.min(valor, scaleMax) / scaleMax) * 100));
                const mostrarValorLabel = valor > 0 && (isOutlier || top3.has(i));
                const vsMedia = mediaDiaria > 0 ? valor / mediaDiaria : 0;
                const pctPeriodo = total > 0 ? (valor / total) * 100 : 0;
                const tooltip = `${ponto.dia} — ${fmtMoneyFull(valor)} · ${pctPeriodo.toFixed(0)}% do período · ${vsMedia
                  .toFixed(1)
                  .replace(".", ",")}x a média`;

                return (
                  <div key={ponto.dia} className="relative flex h-full min-w-[10px] flex-1 items-end justify-center">
                    {mostrarValorLabel && (
                      <span
                        className="pointer-events-none absolute whitespace-nowrap font-mono text-[10px] text-muted"
                        style={{ bottom: `calc(${barPct}% + 4px)` }}
                      >
                        {abreviarValor(valor)}
                      </span>
                    )}
                    {isOutlier && (
                      <span className="pointer-events-none absolute top-0 flex gap-[3px]" aria-hidden="true">
                        <span className="block h-2.5 w-px rotate-[22deg] bg-surface" />
                        <span className="block h-2.5 w-px rotate-[22deg] bg-surface" />
                      </span>
                    )}
                    <div
                      title={tooltip}
                      className={`w-[65%] rounded-t-[2px] ${valor > 0 ? "bg-success" : "bg-border"}`}
                      style={{ height: valor > 0 ? `${barPct}%` : "2px" }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-1 flex items-start gap-1.5 pl-9">
            {pontos.map((ponto, i) => {
              const mostrar = i === 0 || i === pontos.length - 1 || i % 3 === 0;
              const isHoje = ponto.dia === hojeLabel;
              return (
                <div key={ponto.dia} className="flex min-w-[10px] flex-1 justify-center">
                  <span
                    className={`whitespace-nowrap text-[10px] ${
                      mostrar ? (isHoje ? "font-semibold text-primary" : "text-muted") : "invisible"
                    }`}
                  >
                    {ponto.dia}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
