export interface ClasseABC {
  classe: string;
  qtdClientes: number;
  valor: number;
  pct: number;
}

interface CurvaABCProps {
  curva: ClasseABC[];
  /** Sobrescreve o título fixo original (contexto de inadimplência). */
  titulo?: string;
  /** Sobrescreve as legendas por classe (default = contexto de inadimplência). */
  descricoes?: Record<string, string>;
  /** Sobrescreve "clientes" no rótulo de cada faixa (ex.: "serviços"). */
  rotuloEntidade?: string;
  /** Sobrescreve as cores por classe (default = A vermelho/B amarelo/C verde, semântica de
   * risco — inadequada fora de inadimplência, onde A costuma ser o resultado desejado). */
  tons?: Record<string, string>;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toneBgPadrao: Record<string, string> = {
  A: "bg-destructive",
  B: "bg-warning",
  C: "bg-success",
};

const descricaoPadrao: Record<string, string> = {
  A: "concentram ~80% do valor vencido",
  B: "próximos ~15% do valor",
  C: "restante (~5%), mais pulverizado",
};

// Classificação ABC clássica por % acumulado de valor — A = maior concentração
// de valor, não necessariamente "pior" (a semântica de risco é só o default
// de inadimplência; ver props `tons`/`descricoes` pra outros contextos).
export function CurvaABC({
  curva,
  titulo = "Curva ABC dos devedores (concentração de valor vencido)",
  descricoes = descricaoPadrao,
  rotuloEntidade = "clientes",
  tons = toneBgPadrao,
}: CurvaABCProps) {
  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</p>

      <div className="mb-4 flex h-8 gap-0.5 overflow-hidden rounded-md" role="img" aria-label="Curva ABC">
        {curva.map((c) => (
          <div
            key={c.classe}
            className={`${tons[c.classe] ?? "bg-muted"} transition-transform hover:scale-y-105`}
            style={{ width: `${c.pct}%` }}
            title={`Classe ${c.classe} — ${c.qtdClientes} ${rotuloEntidade} — R$ ${currency.format(c.valor)} (${c.pct}%)`}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-6">
        {curva.map((c) => (
          <div key={c.classe} className="flex items-baseline gap-2">
            <span className={`h-6 w-[3px] flex-none self-center rounded-sm ${tons[c.classe] ?? "bg-muted"}`} />
            <span>
              <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
                Classe {c.classe} · {c.qtdClientes} {rotuloEntidade} · R$ {currency.format(c.valor)}
              </span>
              <span className="mt-0.5 block text-[10.5px] text-muted">
                {c.pct}% do valor · {descricoes[c.classe] ?? ""}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
