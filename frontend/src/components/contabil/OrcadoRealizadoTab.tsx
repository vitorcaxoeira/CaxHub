import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { MatrizContabil, LinhaMatrizContabil } from "./MatrizContabil";

interface OrcadoRealizadoTabProps {
  anos: number[];
  meses: number[];
  niveis: number[];
  grupos: string[];
  centrosCusto: string[];
  incluirSemGrupo: boolean;
  ordenarPor: "clacta" | "ctared";
}

type Modo = "realizado" | "orcado" | "variacaoR" | "variacaoPct";

const MODOS: { value: Modo; label: string }[] = [
  { value: "realizado", label: "Realizado" },
  { value: "orcado", label: "Orçado" },
  { value: "variacaoR", label: "Variação R$" },
  { value: "variacaoPct", label: "Variação %" },
];

interface LinhaOrcadoRealizado extends Omit<LinhaMatrizContabil, "valores" | "total"> {
  valoresRealizado: number[];
  valoresOrcado: number[];
  totalRealizado: number;
  totalOrcado: number;
}

interface RespostaOrcadoRealizado {
  meses: string[];
  linhas: LinhaOrcadoRealizado[];
  totalGeral: { valoresRealizado: number[]; valoresOrcado: number[]; totalRealizado: number; totalOrcado: number };
}

const RESULTADO_VAZIO: RespostaOrcadoRealizado = {
  meses: [],
  linhas: [],
  totalGeral: { valoresRealizado: [], valoresOrcado: [], totalRealizado: 0, totalOrcado: 0 },
};

// Variação % com orçado 0 vira 0 em vez de Infinity/NaN — não tem "—" no componente de
// matriz (só número), e 0 é menos enganoso do que um NaN aparecendo na tela.
function variacaoPct(realizado: number, orcado: number): number {
  return orcado !== 0 ? ((realizado - orcado) / Math.abs(orcado)) * 100 : 0;
}

function aplicarModo(
  valoresRealizado: number[],
  valoresOrcado: number[],
  totalRealizado: number,
  totalOrcado: number,
  modo: Modo
): { valores: number[]; total: number } {
  switch (modo) {
    case "realizado":
      return { valores: valoresRealizado, total: totalRealizado };
    case "orcado":
      return { valores: valoresOrcado, total: totalOrcado };
    case "variacaoR":
      return {
        valores: valoresRealizado.map((v, i) => v - valoresOrcado[i]),
        total: totalRealizado - totalOrcado,
      };
    case "variacaoPct":
      return {
        valores: valoresRealizado.map((v, i) => variacaoPct(v, valoresOrcado[i])),
        total: variacaoPct(totalRealizado, totalOrcado),
      };
  }
}

export function OrcadoRealizadoTab({
  anos,
  meses,
  niveis,
  grupos,
  centrosCusto,
  incluirSemGrupo,
  ordenarPor,
}: OrcadoRealizadoTabProps) {
  const [modo, setModo] = useState<Modo>("realizado");
  const [resultado, setResultado] = useState<RespostaOrcadoRealizado>(RESULTADO_VAZIO);
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
      .get("/api/contabil/orcado-realizado", { params })
      .then(({ data }) => {
        setResultado(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar orçado x realizado"))
      .finally(() => setLoading(false));
  }, [anos, meses, niveis, grupos, centrosCusto, incluirSemGrupo, ordenarPor]);

  const linhasNoModo = useMemo(
    () =>
      resultado.linhas.map((l) => ({
        ...l,
        ...aplicarModo(l.valoresRealizado, l.valoresOrcado, l.totalRealizado, l.totalOrcado, modo),
      })),
    [resultado.linhas, modo]
  );
  const totalGeralNoModo = useMemo(
    () =>
      aplicarModo(
        resultado.totalGeral.valoresRealizado,
        resultado.totalGeral.valoresOrcado,
        resultado.totalGeral.totalRealizado,
        resultado.totalGeral.totalOrcado,
        modo
      ),
    [resultado.totalGeral, modo]
  );

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-md border border-border p-1" style={{ width: "fit-content" }}>
        {MODOS.map((m) => (
          <button
            key={m.value}
            onClick={() => setModo(m.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              modo === m.value ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {anos.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          Selecione ao menos um ano pra ver o comparativo.
        </p>
      ) : (
        <MatrizContabil meses={resultado.meses} linhas={linhasNoModo} totalGeral={totalGeralNoModo} loading={loading} />
      )}

      <p className="mt-4 text-[11px] text-muted">
        Orçado vem de orcamentos_contabeis, com o sinal normalizado pra mesma convenção do
        realizado (receita positiva, despesa negativa — o Senior guarda o oposto). Variação % com
        orçado zero aparece como 0.
      </p>
    </div>
  );
}
