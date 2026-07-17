export interface PontoTendenciaMensal {
  mes: string;
  criadas: number;
  ganhas: number;
  perdidas: number;
  winRatePct: number | null;
}

interface TendenciaMensalPropostasProps {
  serie: PontoTendenciaMensal[];
}

const mesLabelFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
function labelMes(mes: string): string {
  const label = mesLabelFormatter.format(new Date(`${mes}-01T00:00:00Z`));
  return label.endsWith(".") ? label.slice(0, -1) : label;
}

// Distinto do /serie-temporal existente (que só conta sitpro=4 como "aprovadas").
// Criadas por datpro; ganhas/perdidas por datret (mês da decisão real).
export function TendenciaMensalPropostas({ serie }: TendenciaMensalPropostasProps) {
  const maiorContagem = Math.max(1, ...serie.map((p) => p.criadas));
  const n = serie.length;

  const pontosLinha = serie
    .map((p, i) => {
      if (p.winRatePct === null) return null;
      const x = n > 1 ? (i / (n - 1)) * 100 : 50;
      const y = 100 - p.winRatePct;
      return `${x},${y}`;
    })
    .filter((v): v is string => v !== null)
    .join(" ");

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Evolução Mensal (criadas × ganhas × perdidas)</p>
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-muted" /> Criadas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" /> Ganhas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-destructive" /> Perdidas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" /> Win Rate
          </span>
        </div>
      </div>

      {serie.length === 0 ? (
        <p className="text-sm text-muted">Sem dados para os filtros atuais.</p>
      ) : (
        <>
          <div className="relative h-32">
            <div className="absolute inset-0 flex items-end gap-2">
              {serie.map((p) => (
                <div key={p.mes} className="flex h-full flex-1 items-end justify-center gap-0.5">
                  <div
                    title={`${labelMes(p.mes)} — criadas: ${p.criadas}`}
                    className="w-2 rounded-t bg-muted"
                    style={{ height: `${Math.max(2, (p.criadas / maiorContagem) * 100)}%` }}
                  />
                  <div
                    title={`${labelMes(p.mes)} — ganhas: ${p.ganhas}`}
                    className="w-2 rounded-t bg-success"
                    style={{ height: `${Math.max(2, (p.ganhas / maiorContagem) * 100)}%` }}
                  />
                  <div
                    title={`${labelMes(p.mes)} — perdidas: ${p.perdidas}`}
                    className="w-2 rounded-t bg-destructive"
                    style={{ height: `${Math.max(2, (p.perdidas / maiorContagem) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
              <polyline points={pontosLinha} fill="none" stroke="var(--primary)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="mt-1 flex gap-2">
            {serie.map((p) => (
              <div key={p.mes} className="flex-1 text-center text-[10px] text-muted">
                {labelMes(p.mes)}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted">Linha de win rate mensal (0–100%) sobreposta às barras.</p>
        </>
      )}
    </section>
  );
}
