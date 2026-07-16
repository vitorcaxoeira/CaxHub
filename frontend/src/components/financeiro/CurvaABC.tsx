export interface ClasseABC {
  classe: string;
  qtdClientes: number;
  valor: number;
  pct: number;
}

interface CurvaABCProps {
  curva: ClasseABC[];
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toneBg: Record<string, string> = {
  A: "bg-destructive",
  B: "bg-warning",
  C: "bg-success",
};

const descricao: Record<string, string> = {
  A: "concentram ~80% do valor vencido",
  B: "próximos ~15% do valor",
  C: "restante (~5%), mais pulverizado",
};

// Classificação ABC clássica por % acumulado de valor — A = maior concentração
// de risco, não necessariamente "pior" cliente. Ver nota no backend.
export function CurvaABC({ curva }: CurvaABCProps) {
  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">
        Curva ABC dos devedores (concentração de valor vencido)
      </p>

      <div className="mb-4 flex h-8 gap-0.5 overflow-hidden rounded-md" role="img" aria-label="Curva ABC">
        {curva.map((c) => (
          <div
            key={c.classe}
            className={`${toneBg[c.classe] ?? "bg-muted"} transition-transform hover:scale-y-105`}
            style={{ width: `${c.pct}%` }}
            title={`Classe ${c.classe} — ${c.qtdClientes} clientes — R$ ${currency.format(c.valor)} (${c.pct}%)`}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-6">
        {curva.map((c) => (
          <div key={c.classe} className="flex items-baseline gap-2">
            <span className={`h-6 w-[3px] flex-none self-center rounded-sm ${toneBg[c.classe] ?? "bg-muted"}`} />
            <span>
              <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
                Classe {c.classe} · {c.qtdClientes} clientes · R$ {currency.format(c.valor)}
              </span>
              <span className="mt-0.5 block text-[10.5px] text-muted">
                {c.pct}% do valor · {descricao[c.classe] ?? ""}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
