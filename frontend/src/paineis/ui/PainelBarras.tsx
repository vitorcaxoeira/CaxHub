export interface ItemBarraPainel {
  label: string;
  valor: number;
}

// Ranking em escala de TV — SEM truncate (RankingBarra.tsx corta o nome e só mostra
// completo no title=, que não existe pra quem está de pé olhando de longe) e SEM
// overflow-x-auto (ninguém rola uma TV). Server já limita a quantidade de linhas
// (ver painelCatalogo.ts) — aqui só desenha o que chegou.
export function PainelBarras({ itens }: { itens: ItemBarraPainel[] }) {
  const maior = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <div className="space-y-5">
      {itens.map((item) => (
        <div key={item.label}>
          <div className="flex items-baseline justify-between font-mono text-3xl">
            <span className="text-foreground">{item.label}</span>
            <span className="text-muted">{item.valor}</span>
          </div>
          <div className="mt-2 h-4 overflow-hidden rounded-full bg-muted/20">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, (item.valor / maior) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
