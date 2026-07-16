export interface PontoAcumulado {
  periodo: string;
  realizadoAcumulado: number | null;
  previstoPassadoAcumulado: number | null;
  previstoFuturoAcumulado: number | null;
}

interface PrevistoRealizadoAcumuladoChartProps {
  pontos: PontoAcumulado[];
  granularidade: "semana" | "mes";
  onGranularidadeChange: (g: "semana" | "mes") => void;
  formatarValor: (valor: number) => string;
}

const W = 100;
const H = 40;

function ultimoValor(
  pontos: PontoAcumulado[],
  campo: keyof Pick<PontoAcumulado, "realizadoAcumulado" | "previstoPassadoAcumulado" | "previstoFuturoAcumulado">
): number | null {
  for (let i = pontos.length - 1; i >= 0; i -= 1) {
    const v = pontos[i][campo];
    if (v !== null) return v;
  }
  return null;
}

function construirPontosSvg(
  pontos: PontoAcumulado[],
  campo: keyof Pick<PontoAcumulado, "realizadoAcumulado" | "previstoPassadoAcumulado" | "previstoFuturoAcumulado">,
  scaleMax: number
): string {
  const n = pontos.length;
  if (n < 2) return "";
  return pontos
    .map((p, i) => ({ i, valor: p[campo] }))
    .filter((p): p is { i: number; valor: number } => p.valor !== null)
    .map((p) => {
      const x = (p.i / (n - 1)) * W;
      const y = H - (scaleMax > 0 ? (p.valor / scaleMax) * H : 0);
      return `${x},${y}`;
    })
    .join(" ");
}

// Duas curvas independentes: realizado acumulado só existe até "hoje", previsto
// futuro acumulado zera em "hoje" e só existe dali pra frente — nunca uma soma
// contínua única, pra não recriar o mesmo problema de misturar futuro/passado
// que motivou reconstruir essa tela.
export function PrevistoRealizadoAcumuladoChart({
  pontos,
  granularidade,
  onGranularidadeChange,
  formatarValor,
}: PrevistoRealizadoAcumuladoChartProps) {
  const valores = pontos.flatMap((p) => [p.realizadoAcumulado, p.previstoPassadoAcumulado, p.previstoFuturoAcumulado]).filter((v): v is number => v !== null);
  const scaleMax = Math.max(1, ...valores);

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Previsto × Realizado acumulado</p>
        <select
          value={granularidade}
          onChange={(e) => onGranularidadeChange(e.target.value as "semana" | "mes")}
          className="rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="semana">Por semana</option>
          <option value="mes">Por mês</option>
        </select>
      </div>

      {pontos.length < 2 ? (
        <p className="text-sm text-muted">Sem dados suficientes para os filtros atuais.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full">
            <polyline
              points={construirPontosSvg(pontos, "previstoPassadoAcumulado", scaleMax)}
              fill="none"
              stroke="var(--muted)"
              strokeWidth="0.5"
              strokeDasharray="1.5 1"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={construirPontosSvg(pontos, "realizadoAcumulado", scaleMax)}
              fill="none"
              stroke="var(--success)"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={construirPontosSvg(pontos, "previstoFuturoAcumulado", scaleMax)}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div className="mt-2 flex justify-between text-[10px] text-muted">
            <span>{pontos[0].periodo}</span>
            <span>{pontos[pontos.length - 1].periodo}</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success" /> Realizado acumulado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-primary" /> Previsto futuro acumulado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-muted" /> Previsto do passado (referência)
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted">
            {ultimoValor(pontos, "realizadoAcumulado") !== null && (
              <span>Realizado até hoje: {formatarValor(ultimoValor(pontos, "realizadoAcumulado") ?? 0)}</span>
            )}
            {ultimoValor(pontos, "previstoFuturoAcumulado") !== null && (
              <span>Previsto acumulado (futuro): {formatarValor(ultimoValor(pontos, "previstoFuturoAcumulado") ?? 0)}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
