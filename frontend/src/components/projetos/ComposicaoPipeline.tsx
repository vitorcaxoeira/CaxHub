import { RankingBarra, RankingItem } from "../ui/RankingBarra";
import { DonutChart, DonutItem } from "../ui/DonutChart";
import { formatHoras } from "../../utils/horas";

export interface ComposicaoItem {
  qtd: number;
  valor: number;
}
export interface ComposicaoTipoVenda extends ComposicaoItem {
  tipven: number;
  label: string;
}
export interface ComposicaoProduto extends ComposicaoItem {
  sispro: number;
  label: string;
}
export interface ComposicaoClassificacao extends ComposicaoItem {
  clapro: number | null;
  label: string;
  horas: number;
}

interface ComposicaoPipelineProps {
  porTipoVenda: ComposicaoTipoVenda[];
  porProduto: ComposicaoProduto[];
  porClassificacao: ComposicaoClassificacao[];
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

// Todos os 3 blocos usam a mesma cohort "abertas em decisão" (sitpro IN 1,2,3) —
// diferente do card antigo "Propostas Abertas", que inclui Levantamento Interno.
export function ComposicaoPipeline({ porTipoVenda, porProduto, porClassificacao }: ComposicaoPipelineProps) {
  const itensTipoVenda: RankingItem[] = porTipoVenda.map((r) => ({ chave: r.tipven, nome: r.label, quantidade: r.qtd, valor: r.valor }));
  const itensProduto: DonutItem[] = porProduto
    .filter((r) => r.qtd > 0)
    .map((r) => ({ chave: r.sispro, nome: r.label, valor: r.valor, pct: 0 }));
  const totalProduto = itensProduto.reduce((acc, i) => acc + i.valor, 0);
  const itensProdutoComPct = itensProduto.map((i) => ({ ...i, pct: totalProduto > 0 ? (i.valor / totalProduto) * 100 : 0 }));

  const maiorClassificacao = Math.max(1, ...porClassificacao.map((r) => r.valor));

  return (
    <section className="mb-6">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">Composição do Pipeline (abertas em decisão)</p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankingBarra titulo="Valor por Tipo de Venda" itens={itensTipoVenda} unidade="propostas" />
        <DonutChart titulo="Valor por Produto" itens={itensProdutoComPct} />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-6 shadow-sm">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">Pipeline por Classificação de Projeto</p>
        <div className="space-y-3">
          {porClassificacao.map((c) => (
            <div key={c.label}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-foreground">{c.label}</span>
                <span className="flex-none font-mono text-sm font-semibold tabular-nums text-foreground">
                  {fmtMoney(c.valor)} · {formatHoras(c.horas)} · {c.qtd.toLocaleString("pt-BR")} propostas
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(2, (c.valor / maiorClassificacao) * 100)}%` }} />
              </div>
            </div>
          ))}
          {porClassificacao.length === 0 && <p className="text-sm text-muted">Sem dados para os filtros atuais.</p>}
        </div>
      </div>
    </section>
  );
}
