import axios from "axios";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FaturamentoVisaoGeralTab } from "../../components/mercado/FaturamentoVisaoGeralTab";
import { FaturamentoRecorrenciaTab } from "../../components/mercado/FaturamentoRecorrenciaTab";
import { FaturamentoClientesTab } from "../../components/mercado/FaturamentoClientesTab";
import { FaturamentoServicosTab } from "../../components/mercado/FaturamentoServicosTab";
import { FaturamentoSazonalidadeTab } from "../../components/mercado/FaturamentoSazonalidadeTab";
import { FaturamentoGeografiaTab } from "../../components/mercado/FaturamentoGeografiaTab";

type Visao = "geral" | "recorrencia" | "clientes" | "servicos" | "sazonalidade" | "geografia";
const VISOES: { value: Visao; label: string }[] = [
  { value: "geral", label: "Visão Geral" },
  { value: "recorrencia", label: "Recorrência" },
  { value: "clientes", label: "Clientes" },
  { value: "servicos", label: "Serviços" },
  { value: "sazonalidade", label: "Sazonalidade" },
  { value: "geografia", label: "Geografia" },
];

export function AnaliseFaturamento() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [anosDisponiveis, setAnosDisponiveis] = useState<number[]>([]);

  const visaoInicial = VISOES.some((v) => v.value === searchParams.get("visao")) ? (searchParams.get("visao") as Visao) : "geral";
  const [visao, setVisao] = useState<Visao>(visaoInicial);

  const anoDaUrl = Number(searchParams.get("ano"));
  const [anoBase, setAnoBase] = useState<number>(Number.isInteger(anoDaUrl) && anoDaUrl > 0 ? anoDaUrl : new Date().getFullYear());

  useEffect(() => {
    axios
      .get("/api/analise-faturamento/opcoes-filtro")
      .then(({ data }) => {
        const anos: number[] = data.anos ?? [];
        setAnosDisponiveis(anos);
        if (anos.length > 0) setAnoBase((atual) => (anos.includes(atual) ? atual : anos[0]));
      })
      .catch(() => {});
  }, []);

  // Aba ativa + Ano Base na URL — recarregar a página (ou compartilhar o link) volta
  // exatamente na mesma visão, mesmo padrão de ResultadoAnalitico.tsx.
  useEffect(() => {
    setSearchParams({ visao, ano: String(anoBase) }, { replace: true });
  }, [visao, anoBase, setSearchParams]);

  const tabClass = (ativa: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      ativa ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Mercado · Análise de Faturamento</p>
          <h1 className="font-display text-2xl font-bold text-foreground">Análise de Faturamento</h1>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Ano Base
          <select
            value={anoBase}
            onChange={(e) => setAnoBase(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(anosDisponiveis.includes(anoBase) ? anosDisponiveis : [anoBase, ...anosDisponiveis]).map((ano) => (
              <option key={ano} value={ano}>
                {ano}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 rounded-md border border-border p-1">
        {VISOES.map((v) => (
          <button key={v.value} onClick={() => setVisao(v.value)} className={tabClass(visao === v.value)}>
            {v.label}
          </button>
        ))}
      </div>

      {visao === "geral" && <FaturamentoVisaoGeralTab ano={anoBase} />}
      {visao === "recorrencia" && <FaturamentoRecorrenciaTab ano={anoBase} />}
      {visao === "clientes" && <FaturamentoClientesTab ano={anoBase} />}
      {visao === "servicos" && <FaturamentoServicosTab ano={anoBase} />}
      {visao === "sazonalidade" && <FaturamentoSazonalidadeTab ano={anoBase} />}
      {visao === "geografia" && <FaturamentoGeografiaTab ano={anoBase} />}
    </div>
  );
}
