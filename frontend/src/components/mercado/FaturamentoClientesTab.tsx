import axios from "axios";
import { useEffect, useState } from "react";
import { KpiCard } from "../ui/KpiCard";
import { Skeleton } from "../ui/Skeleton";
import { RankingBarra, RankingItem } from "../ui/RankingBarra";
import { DonutChart, DonutItem } from "../ui/DonutChart";
import { CurvaABC, ClasseABC } from "../financeiro/CurvaABC";

const currency = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

interface ClientesResposta {
  anoBase: number;
  total: number;
  ranking: RankingItem[];
  curvaABC: ClasseABC[];
  concentracao: { top1Pct: number; top5Pct: number; top10Pct: number; donut: DonutItem[] };
  movimentacao: {
    novos: { clientes: number; valor: number };
    recorrentes: { clientes: number; valor: number };
    perdidos: { clientes: number; valor: number };
  };
}

// Curva ABC em contexto de faturamento: A = maior concentração de receita, o resultado
// desejado — não a semântica de risco de inadimplência (A vermelho lá). Tons e legendas
// próprios pra não confundir as duas telas.
const TONS_ABC: Record<string, string> = { A: "bg-success", B: "bg-warning", C: "bg-muted" };
const DESCRICOES_ABC: Record<string, string> = {
  A: "maior concentração de faturamento",
  B: "faixa intermediária",
  C: "cauda longa, mais pulverizada",
};

export function FaturamentoClientesTab({ ano }: { ano: number }) {
  const [dados, setDados] = useState<ClientesResposta | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios
      .get("/api/analise-faturamento/clientes", { params: { ano } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar clientes"))
      .finally(() => setLoading(false));
  }, [ano]);

  if (erro) {
    return <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>;
  }

  if (loading || !dados) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-5">
            <Skeleton className="mb-2 h-3.5 w-24" />
            <Skeleton className="h-6 w-28" />
          </div>
        ))}
      </div>
    );
  }

  const { movimentacao } = dados;

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Concentração Top 1" tone="primary" quantidade={0} total={1} valor={fmtPct(dados.concentracao.top1Pct)} rodape="Maior cliente do ano" />
        <KpiCard label="Concentração Top 5" tone="primary" quantidade={0} total={1} valor={fmtPct(dados.concentracao.top5Pct)} rodape="5 maiores clientes" />
        <KpiCard label="Concentração Top 10" tone="primary" quantidade={0} total={1} valor={fmtPct(dados.concentracao.top10Pct)} rodape="10 maiores clientes" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Clientes Novos"
          tone="success"
          quantidade={movimentacao.novos.clientes}
          total={Math.max(1, movimentacao.novos.clientes + movimentacao.recorrentes.clientes)}
          valor={String(movimentacao.novos.clientes)}
          rodape={`1º faturamento no ano · ${fmtMoney(movimentacao.novos.valor)}`}
        />
        <KpiCard
          label="Clientes Recorrentes"
          tone="primary"
          quantidade={movimentacao.recorrentes.clientes}
          total={Math.max(1, movimentacao.novos.clientes + movimentacao.recorrentes.clientes)}
          valor={String(movimentacao.recorrentes.clientes)}
          rodape={`Já faturavam antes · ${fmtMoney(movimentacao.recorrentes.valor)}`}
        />
        <KpiCard
          label="Clientes Perdidos"
          tone={movimentacao.perdidos.clientes > 0 ? "warning" : "neutral"}
          quantidade={movimentacao.perdidos.clientes}
          total={Math.max(1, movimentacao.perdidos.clientes)}
          valor={String(movimentacao.perdidos.clientes)}
          rodape={`Faturaram no ano anterior, não no base · ${fmtMoney(movimentacao.perdidos.valor)}`}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankingBarra titulo="Top 10 Clientes" itens={dados.ranking} descricao="Por valor bruto de NF fechada" unidade="NFs" />
        <DonutChart titulo="Concentração — Top 5 Clientes" itens={dados.concentracao.donut} />
      </div>

      <CurvaABC
        curva={dados.curvaABC}
        titulo="Curva ABC de Clientes (concentração de faturamento)"
        rotuloEntidade="clientes"
        tons={TONS_ABC}
        descricoes={DESCRICOES_ABC}
      />

      <p className="mt-4 text-[11px] text-muted">
        Ranking por valor bruto de NF fechada (diferente do "Top Clientes" de Pedidos, que mede carteira/backlog por valor de pedido). "Novos" =
        primeiro ano de faturamento igual ao Ano Base; "Perdidos" = faturaram no ano anterior e nada no Ano Base.
      </p>
    </>
  );
}
