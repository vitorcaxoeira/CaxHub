export interface RankingItem {
  chave: string | number;
  nome: string;
  quantidade: number;
  valor: number;
}

interface RankingBarraProps {
  titulo: string;
  itens: RankingItem[];
  formatarValor?: (valor: number) => string;
  unidade?: string;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatarValorPadrao = (valor: number) => `R$ ${currency.format(valor)}`;

// Ranking de uma única métrica — comparação de magnitude, não de identidade,
// então usa uma cor só (a marca), não uma cor por barra.
export function RankingBarra({ titulo, itens, formatarValor = formatarValorPadrao, unidade = "registros" }: RankingBarraProps) {
  const maiorValor = Math.max(1, ...itens.map((i) => i.valor));

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</p>

      <div className="space-y-3">
        {itens.map((item) => (
          <div key={item.chave} title={`${item.nome} — ${item.quantidade} ${unidade} — ${formatarValor(item.valor)}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-sm text-foreground">{item.nome}</span>
              <span className="flex-none font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatarValor(item.valor)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.max(2, (item.valor / maiorValor) * 100)}%` }}
              />
            </div>
          </div>
        ))}
        {itens.length === 0 && <p className="text-sm text-muted">Sem dados para os filtros atuais.</p>}
      </div>
    </section>
  );
}
