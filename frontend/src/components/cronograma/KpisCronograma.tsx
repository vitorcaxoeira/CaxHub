import { OrcamentoItem, formatHorasCompacto } from "../../lib/cronograma";

// Placar da proposta, no topo da tela: somatório de TODOS os itens (ver somarOrcamentos),
// não o orçamento de um item. Por isso "A alocar" pode ficar negativo mesmo sem nenhum
// item estourado — e o contrário também: o total positivo pode esconder um item
// estourado. O alerta por item continua sendo a fonte de verdade; isto é só o placar.
//
// Os três primeiros cards são as MESMAS grandezas das três colunas da árvore, e usam de
// propósito as mesmas palavras: ler "Contratado" aqui e "Orçado" na coluna logo abaixo
// faria parecer que são números diferentes.
export function KpisCronograma({ totais, larguraHoras }: { totais: OrcamentoItem; larguraHoras: number }) {
  const cards = [
    { label: "Orçado", valor: totais.horasContratadas, cor: "text-foreground" },
    { label: "Realizado", valor: totais.horasRealizadas, cor: "text-primary" },
    { label: "Alocado", valor: totais.horasDistribuidas, cor: "text-foreground" },
    { label: "A alocar", valor: totais.saldoDistribuicao, cor: totais.saldoDistribuicao < 0 ? "text-destructive" : "text-success" },
    { label: "Saldo real", valor: totais.saldoReal, cor: totais.saldoReal < 0 ? "text-destructive" : "text-foreground" },
  ];

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border border-border bg-surface p-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-muted">{card.label}</p>
          <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${card.cor}`}>{formatHorasCompacto(card.valor, larguraHoras)}</p>
        </div>
      ))}
    </div>
  );
}
