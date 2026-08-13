import axios from "axios";
import { useEffect, useState } from "react";
import { MatrizContabil, LinhaMatrizContabil } from "./MatrizContabil";

interface CentroCustoTabProps {
  anos: number[];
  meses: number[];
  centrosCusto: string[];
}

interface RespostaCentrosCusto {
  meses: string[];
  linhas: LinhaMatrizContabil[];
  totalGeral: { valores: number[]; total: number };
}

const RESULTADO_VAZIO: RespostaCentrosCusto = { meses: [], linhas: [], totalGeral: { valores: [], total: 0 } };

export function CentroCustoTab({ anos, meses, centrosCusto }: CentroCustoTabProps) {
  const [resultado, setResultado] = useState<RespostaCentrosCusto>(RESULTADO_VAZIO);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (anos.length === 0) return;
    setLoading(true);
    const params: Record<string, string> = { anos: anos.join(",") };
    if (meses.length > 0) params.meses = meses.join(",");
    if (centrosCusto.length > 0) params.codccu = centrosCusto.join(",");
    axios
      .get("/api/contabil/centros-custo", { params })
      .then(({ data }) => {
        setResultado(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar o resultado por centro de custo"))
      .finally(() => setLoading(false));
  }, [anos, meses, centrosCusto]);

  return (
    <div>
      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {anos.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          Selecione ao menos um ano pra ver o resultado por centro de custo.
        </p>
      ) : (
        <MatrizContabil
          meses={resultado.meses}
          linhas={resultado.linhas}
          totalGeral={resultado.totalGeral}
          loading={loading}
          rotuloColuna="Centro de Custo"
        />
      )}

      <p className="mt-4 text-[11px] text-muted">
        Mesmo realizado da Matriz, na outra dimensão: por centro de custo em vez de por conta —
        não herda o filtro de Grupo/Conta Paralela (dimensão só de conta), e o total geral bate
        com o da Matriz no mesmo recorte de ano/mês/CC.
      </p>
    </div>
  );
}
