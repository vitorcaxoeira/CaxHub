import axios from "axios";
import { useEffect, useState } from "react";
import { KpiCard } from "../ui/KpiCard";
import { Skeleton } from "../ui/Skeleton";
import { RankingBarra, RankingItem } from "../ui/RankingBarra";

const currency = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

interface ServicosResposta {
  anoBase: number;
  total: number;
  totalServicos: number;
  totalProdutos: number;
  ranking: RankingItem[];
}

export function FaturamentoServicosTab({ ano }: { ano: number }) {
  const [dados, setDados] = useState<ServicosResposta | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios
      .get("/api/analise-faturamento/servicos", { params: { ano } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar serviços"))
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

  const pctServicos = dados.total > 0 ? (dados.totalServicos / dados.total) * 100 : 0;
  const pctProdutos = dados.total > 0 ? (dados.totalProdutos / dados.total) * 100 : 0;

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Faturamento Total" tone="primary" quantidade={0} total={1} valor={fmtMoney(dados.total)} rodape="Serviços + produtos" />
        <KpiCard label="Serviços" tone="primary" quantidade={0} total={1} valor={fmtMoney(dados.totalServicos)} rodape={`${fmtPct(pctServicos)} do total`} />
        <KpiCard label="Produtos" tone="neutral" quantidade={0} total={1} valor={fmtMoney(dados.totalProdutos)} rodape={`${fmtPct(pctProdutos)} do total`} />
      </div>

      <RankingBarra titulo="Top 10 Serviços/Produtos mais Faturados" itens={dados.ranking} descricao="Por valor bruto de NF fechada" unidade="itens" />

      <p className="mt-4 text-[11px] text-muted">
        Produtos hoje representam uma fatia marginal do faturamento (histórico ~0,15%) — o negócio é predominantemente prestação de serviço.
      </p>
    </>
  );
}
