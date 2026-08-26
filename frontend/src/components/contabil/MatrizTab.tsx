import axios from "axios";
import { useEffect, useState } from "react";
import { MatrizContabil, LinhaMatrizContabil } from "./MatrizContabil";

interface MatrizTabProps {
  anos: number[];
  meses: number[];
  niveis: number[];
  grupos: string[];
  centrosCusto: string[];
  incluirSemGrupo: boolean;
  ordenarPor: "clacta" | "ctared";
}

interface RespostaResultado {
  meses: string[];
  linhas: LinhaMatrizContabil[];
  totalGeral: { valores: number[]; total: number };
}

const RESULTADO_VAZIO: RespostaResultado = { meses: [], linhas: [], totalGeral: { valores: [], total: 0 } };

export function MatrizTab({ anos, meses, niveis, grupos, centrosCusto, incluirSemGrupo, ordenarPor }: MatrizTabProps) {
  const [resultado, setResultado] = useState<RespostaResultado>(RESULTADO_VAZIO);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (anos.length === 0) return;
    setLoading(true);
    const params: Record<string, string> = { anos: anos.join(",") };
    if (meses.length > 0) params.meses = meses.join(",");
    if (niveis.length > 0) params.niveis = niveis.join(",");
    if (grupos.length > 0) params.grupo = grupos.join(",");
    if (centrosCusto.length > 0) params.codccu = centrosCusto.join(",");
    if (incluirSemGrupo) params.incluirSemGrupo = "true";
    if (ordenarPor !== "clacta") params.ordenarPor = ordenarPor;
    axios
      .get("/api/contabil/resultado", { params })
      .then(({ data }) => {
        setResultado(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar o resultado analítico"))
      .finally(() => setLoading(false));
  }, [anos, meses, niveis, grupos, centrosCusto, incluirSemGrupo, ordenarPor]);

  return (
    <div>
      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {anos.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          Selecione ao menos um ano pra ver o resultado.
        </p>
      ) : (
        <MatrizContabil meses={resultado.meses} linhas={resultado.linhas} totalGeral={resultado.totalGeral} loading={loading} />
      )}

      <p className="mt-4 text-[11px] text-muted">
        Realizado = rateios contabilizados (situação "Contabilizado" no lançamento), crédito soma e débito subtrai.
        Por padrão só entram contas com grupo gerencial (Conta Paralela) definido. A hierarquia é
        Conta Paralela › Receitas/Despesas › níveis do plano de contas; omitir um nível no filtro não muda
        valor nenhum — as contas abaixo passam a somar no nível visível acima.
      </p>
    </div>
  );
}
