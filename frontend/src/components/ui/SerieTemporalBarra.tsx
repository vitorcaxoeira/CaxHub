export interface SeriePonto {
  label: string;
  valores: number[];
}

export interface SerieDef {
  nome: string;
  cor: "muted" | "success" | "warning" | "destructive" | "primary";
}

interface SerieTemporalBarraProps {
  titulo: string;
  pontos: SeriePonto[];
  series: SerieDef[];
  formatarValor?: (valor: number) => string;
}

const corBg: Record<SerieDef["cor"], string> = {
  muted: "bg-muted",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  primary: "bg-primary",
};

const corDot: Record<SerieDef["cor"], string> = corBg;

const formatarValorPadrao = (v: number) => v.toLocaleString("pt-BR");

// Série temporal genérica com 1-2 séries no mesmo eixo (mesma unidade) — usada
// tanto pra 1 série (ex.: Recebido por dia) quanto 2 (ex.: Previsto x Realizado,
// Emitido x Recebido). Barras finas, sem eixo dual — mesma unidade sempre.
export function SerieTemporalBarra({ titulo, pontos, series, formatarValor = formatarValorPadrao }: SerieTemporalBarraProps) {
  const maior = Math.max(1, ...pontos.flatMap((p) => p.valores));

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</p>
        {series.length > 1 && (
          <div className="flex items-center gap-4 text-[11px] text-muted">
            {series.map((s) => (
              <span key={s.nome} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${corDot[s.cor]}`} /> {s.nome}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex h-40 items-end gap-1.5 overflow-x-auto">
        {pontos.map((ponto) => (
          <div key={ponto.label} className="flex min-w-[6px] flex-1 flex-col items-center gap-1">
            <div className="flex h-32 w-full items-end justify-center gap-0.5">
              {ponto.valores.map((valor, i) => (
                <div
                  key={i}
                  className={`w-2.5 rounded-t ${corBg[series[i]?.cor ?? "primary"]}`}
                  style={{ height: `${Math.max(2, (valor / maior) * 100)}%` }}
                  title={`${ponto.label} — ${series[i]?.nome ?? ""}: ${formatarValor(valor)}`}
                />
              ))}
            </div>
            <span className="whitespace-nowrap text-[10px] text-muted">{ponto.label}</span>
          </div>
        ))}
        {pontos.length === 0 && <p className="text-sm text-muted">Sem dados para os filtros atuais.</p>}
      </div>
    </section>
  );
}
