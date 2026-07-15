export interface FunilItem {
  key: string;
  label: string;
  quantidade: number;
  valor: number;
  pct: number;
  tone: "success" | "warning" | "destructive" | "neutral";
}

interface FunilSituacaoProps {
  itens: FunilItem[];
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const toneBg: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-muted",
};

export function FunilSituacao({ itens }: FunilSituacaoProps) {
  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">
        Funil por situação (quantidade)
      </p>

      <div className="mb-4 flex h-8 gap-0.5 overflow-hidden rounded-md" role="img" aria-label="Funil por situação">
        {itens.map((item) => (
          <div
            key={item.key}
            className={`${toneBg[item.tone]} transition-transform hover:scale-y-105`}
            style={{ width: `${item.pct}%` }}
            title={`${item.label} — ${item.quantidade} propostas — R$ ${currency.format(item.valor)} (${item.pct}%)`}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-6">
        {itens.map((item) => (
          <div key={item.key} className="flex items-baseline gap-2">
            <span className={`h-6 w-[3px] flex-none self-center rounded-sm ${toneBg[item.tone]}`} />
            <span>
              <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
                {item.quantidade} · R$ {currency.format(item.valor)}
              </span>
              <span className="mt-0.5 block text-[10.5px] text-muted">
                {item.label} · {item.pct}%
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
