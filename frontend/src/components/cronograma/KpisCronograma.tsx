import { OrcamentoItem, formatHorasCompacto } from "../../lib/cronograma";

// Grid de 5 metric cards com o somatório de todos os itens do projeto — não é o
// orçamento de um item, é a soma deles (ver somarOrcamentos); por isso "A distribuir"
// pode ficar negativo mesmo que nenhum item individual esteja estourado (ou o
// contrário: o total ficar positivo escondendo um item estourado — o alerta por item
// continua sendo a fonte de verdade, isso aqui é só o placar geral).
export function RodapeOrcamento({ totais, larguraHoras }: { totais: OrcamentoItem; larguraHoras: number }) {
  const cards = [
    { label: "Contratado", valor: totais.horasContratadas, cor: "text-foreground" },
    { label: "Distribuído", valor: totais.horasDistribuidas, cor: "text-foreground" },
    { label: "Realizado", valor: totais.horasRealizadas, cor: "text-primary" },
    { label: "A distribuir", valor: totais.saldoDistribuicao, cor: totais.saldoDistribuicao < 0 ? "text-destructive" : "text-success" },
    { label: "Saldo real", valor: totais.saldoReal, cor: totais.saldoReal < 0 ? "text-destructive" : "text-foreground" },
  ];

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg bg-surface-2 p-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-muted">{card.label}</p>
          <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${card.cor}`}>{formatHorasCompacto(card.valor, larguraHoras)}</p>
        </div>
      ))}
    </div>
  );
}
