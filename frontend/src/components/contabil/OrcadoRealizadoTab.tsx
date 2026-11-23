import axios from "axios";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MatrizContabil, type LinhaMatriz, type SubcolunaMatriz, type ValorClicado } from "./MatrizContabil";
import { ModalDetalheLancamentos } from "./ModalDetalheLancamentos";
import { ModalDetalheOrcamento } from "./ModalDetalheOrcamento";
import { variacao, type FormatoVariacao } from "../../lib/orcadoRealizado";

interface OrcadoRealizadoTabProps {
  anos: number[];
  meses: number[];
  niveis: number[];
  grupos: string[];
  centrosCusto: string[];
  incluirSemGrupo: boolean;
  ordenarPor: "clacta" | "ctared";
  /** Variação em R$ ou em % — fica na URL junto dos outros filtros (ResultadoAnalitico). */
  formatoVariacao: FormatoVariacao;
  onFormatoVariacao: (f: FormatoVariacao) => void;
  /** Estrela do padrão salvo (usePadroesTela da página). */
  estrelaVariacao?: ReactNode;
}

/** Os números de uma linha (e do total geral) que a resposta traz: orçado e realizado por mês e no período. */
interface ValoresOrcadoRealizado {
  valoresRealizado: number[];
  valoresOrcado: number[];
  totalRealizado: number;
  totalOrcado: number;
}

interface RespostaOrcadoRealizado {
  meses: string[];
  linhas: LinhaMatriz<ValoresOrcadoRealizado>[];
  totalGeral: ValoresOrcadoRealizado;
}

const RESULTADO_VAZIO: RespostaOrcadoRealizado = {
  meses: [],
  linhas: [],
  totalGeral: { valoresRealizado: [], valoresOrcado: [], totalRealizado: 0, totalOrcado: 0 },
};

const FORMATOS: { value: FormatoVariacao; label: string }[] = [
  { value: "valor", label: "R$" },
  { value: "pct", label: "%" },
];

/** Uma visão só (23/11/2026): em cada mês e no total, Orçado | Realizado | Variação (R$ ou %). */
function subcolunas(formato: FormatoVariacao): SubcolunaMatriz<ValoresOrcadoRealizado>[] {
  return [
    { chave: "orcado", titulo: "Orçado", detalhavel: true, mes: (v, i) => v.valoresOrcado[i] ?? 0, total: (v) => v.totalOrcado },
    { chave: "realizado", titulo: "Realizado", detalhavel: true, mes: (v, i) => v.valoresRealizado[i] ?? 0, total: (v) => v.totalRealizado },
    {
      chave: "variacao",
      titulo: formato === "pct" ? "Variação %" : "Variação R$",
      formato: formato === "pct" ? "percentual" : "numero",
      mes: (v, i) => variacao(v.valoresRealizado[i] ?? 0, v.valoresOrcado[i] ?? 0, formato),
      total: (v) => variacao(v.totalRealizado, v.totalOrcado, formato),
    },
  ];
}

export function OrcadoRealizadoTab({
  anos,
  meses,
  niveis,
  grupos,
  centrosCusto,
  incluirSemGrupo,
  ordenarPor,
  formatoVariacao,
  onFormatoVariacao,
  estrelaVariacao,
}: OrcadoRealizadoTabProps) {
  const [resultado, setResultado] = useState<RespostaOrcadoRealizado>(RESULTADO_VAZIO);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Origem do valor clicado (como na Matriz): Realizado abre os lançamentos contabilizados; Orçado, as linhas do orçamento.
  const [detalhe, setDetalhe] = useState<ValorClicado | null>(null);

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

  const colunas = useMemo(() => subcolunas(formatoVariacao), [formatoVariacao]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <span>Variação</span>
        <div className="flex gap-1 rounded-md border border-border p-1">
          {FORMATOS.map((f) => (
            <button
              key={f.value}
              onClick={() => onFormatoVariacao(f.value)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                formatoVariacao === f.value ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="relative inline-block h-7 w-7">{estrelaVariacao}</span>
        </div>
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
        <MatrizContabil<ValoresOrcadoRealizado>
          meses={resultado.meses}
          linhas={resultado.linhas}
          totalGeral={resultado.totalGeral}
          loading={loading}
          subcolunas={colunas}
          onClickValor={setDetalhe}
        />
      )}

      {detalhe?.subcoluna === "realizado" && <ModalDetalheLancamentos {...detalhe} codccu={centrosCusto} onClose={() => setDetalhe(null)} />}
      {detalhe?.subcoluna === "orcado" && <ModalDetalheOrcamento {...detalhe} codccu={centrosCusto} onClose={() => setDetalhe(null)} />}

      <p className="mt-4 text-[11px] text-muted">
        Orçado vem de orcamentos_contabeis, com o sinal normalizado pra mesma convenção do
        realizado (receita positiva, despesa negativa — o Senior guarda o oposto). Variação =
        realizado − orçado; em %, sobre o orçado (sem orçado aparece "—").
      </p>
    </div>
  );
}
