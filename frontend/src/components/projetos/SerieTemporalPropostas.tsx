export interface SeriePonto {
  mes: string;
  criadas: number;
  aprovadas: number;
}

interface SerieTemporalPropostasProps {
  serie: SeriePonto[];
}

const mesLabelFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

function labelMes(mes: string): string {
  return mesLabelFormatter.format(new Date(`${mes}-01T00:00:00Z`)).replace(".", "");
}

// Duas séries com a mesma unidade (contagem) — cabem no mesmo eixo, sem dual-axis.
// "Criadas" fica em cinza (base/total) e "Aprovadas" em verde (subconjunto de destaque),
// já que o tema não tem uma segunda cor categórica distinta de `primary`/`success`.
export function SerieTemporalPropostas({ serie }: SerieTemporalPropostasProps) {
  const maior = Math.max(1, ...serie.map((p) => p.criadas));

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
          Propostas criadas × aprovadas (12 meses)
        </p>
        <div className="flex items-center gap-4 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-muted" /> Criadas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" /> Aprovadas
          </span>
        </div>
      </div>

      <div className="flex h-40 items-end gap-2">
        {serie.map((ponto) => (
          <div key={ponto.mes} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-32 w-full items-end justify-center gap-0.5">
              <div
                className="w-2.5 rounded-t bg-muted"
                style={{ height: `${Math.max(2, (ponto.criadas / maior) * 100)}%` }}
                title={`${labelMes(ponto.mes)} — ${ponto.criadas} criadas`}
              />
              <div
                className="w-2.5 rounded-t bg-success"
                style={{ height: `${Math.max(2, (ponto.aprovadas / maior) * 100)}%` }}
                title={`${labelMes(ponto.mes)} — ${ponto.aprovadas} aprovadas`}
              />
            </div>
            <span className="text-[10px] text-muted">{labelMes(ponto.mes)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
