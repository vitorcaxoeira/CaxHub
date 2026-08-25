import axios from "axios";
import { useEffect, useState } from "react";
import { KpiCard } from "../ui/KpiCard";
import { Skeleton } from "../ui/Skeleton";
import { RankingBarra, RankingItem } from "../ui/RankingBarra";

const currency = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

interface GeografiaResposta {
  anoBase: number;
  total: number;
  porUf: RankingItem[];
  porCidade: RankingItem[];
}

export function FaturamentoGeografiaTab({ ano }: { ano: number }) {
  const [dados, setDados] = useState<GeografiaResposta | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios
      .get("/api/analise-faturamento/geografia", { params: { ano } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar geografia"))
      .finally(() => setLoading(false));
  }, [ano]);

  if (erro) {
    return <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>;
  }

  if (loading || !dados) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <Skeleton className="mb-3 h-3.5 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <KpiCard label="Faturamento Total" tone="primary" quantidade={0} total={1} valor={fmtMoney(dados.total)} rodape={`${dados.porUf.length} UFs atendidas`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankingBarra titulo="Por UF" itens={dados.porUf} descricao="Por valor bruto de NF fechada" unidade="clientes" />
        <RankingBarra titulo="Top 10 Cidades" itens={dados.porCidade} descricao="Por valor bruto de NF fechada" unidade="clientes" />
      </div>

      <p className="mt-4 text-[11px] text-muted">
        UF e cidade vêm do cadastro do cliente (clientes.sigufs/cidcli), não do endereço de entrega da NF.
      </p>
    </>
  );
}
