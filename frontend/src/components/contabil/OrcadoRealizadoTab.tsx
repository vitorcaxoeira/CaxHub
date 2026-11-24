import axios from "axios";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MatrizContabil, type LinhaMatriz, type SubcolunaMatriz, type ValorClicado } from "./MatrizContabil";
import { ModalDetalheLancamentos } from "./ModalDetalheLancamentos";
import { ModalDetalheOrcamento } from "./ModalDetalheOrcamento";
import { agruparPorAno, variacao, type FormatoVariacao, type Periodo } from "../../lib/orcadoRealizado";
import { ModalAnoOrcadoRealizado } from "./ModalAnoOrcadoRealizado";

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
  /** Visão das colunas: Mês, ou Ano (clicar no ano abre o modal mês a mês). Vai pra URL como `periodo=ano`. */
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  /** Estrela do padrão salvo da visão (usePadroesTela da página). */
  estrelaPeriodo?: ReactNode;
}

/** Os números de uma linha (e do total geral) que a resposta traz: orçado e realizado por mês e no período. */
export interface ValoresOrcadoRealizado {
  valoresRealizado: number[];
  valoresOrcado: number[];
  totalRealizado: number;
  totalOrcado: number;
}

export interface RespostaOrcadoRealizado {
  meses: string[];
  linhas: LinhaMatriz<ValoresOrcadoRealizado>[];
  totalGeral: ValoresOrcadoRealizado;
}

const RESULTADO_VAZIO: RespostaOrcadoRealizado = {
  meses: [],
  linhas: [],
  totalGeral: { valoresRealizado: [], valoresOrcado: [], totalRealizado: 0, totalOrcado: 0 },
};

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "mes", label: "Mês" },
  { value: "ano", label: "Ano" },
];

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
  periodo,
  onPeriodo,
  estrelaPeriodo,
}: OrcadoRealizadoTabProps) {
  const [resultado, setResultado] = useState<RespostaOrcadoRealizado>(RESULTADO_VAZIO);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Origem do valor clicado (como na Matriz): Realizado abre os lançamentos contabilizados; Orçado, as linhas do orçamento.
  const [detalhe, setDetalhe] = useState<ValorClicado | null>(null);
  // Ano aberto no modal (visão Ano). Fecha quando os filtros mudam, junto com a nova busca.
  const [anoAberto, setAnoAberto] = useState<string | null>(null);

  useEffect(() => {
    if (anos.length === 0) return;
    setLoading(true);
    setAnoAberto(null);
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

  // Visão Ano: as colunas viram os anos (soma dos meses). Os totais são os mesmos da visão Mês.
  const exibidos = useMemo(
    () => (periodo === "ano" ? agruparPorAno(resultado.meses, resultado.linhas, resultado.totalGeral) : resultado),
    [periodo, resultado]
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span>Visualização</span>
          <div className="flex gap-1 rounded-md border border-border p-1">
            {PERIODOS.map((p) => (
              <button
                key={p.value}
                onClick={() => onPeriodo(p.value)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                  periodo === p.value ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="relative inline-block h-7 w-7">{estrelaPeriodo}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted">
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
          meses={exibidos.meses}
          linhas={exibidos.linhas}
          totalGeral={exibidos.totalGeral}
          loading={loading}
          subcolunas={colunas}
          // Na visão Ano o detalhe é por mês (o backend recebe AAAA-MM): clicar no ano abre o modal, e de lá sai o detalhe.
          onClickValor={periodo === "mes" ? setDetalhe : undefined}
          onAbrirPeriodo={periodo === "ano" ? setAnoAberto : undefined}
        />
      )}

      {periodo === "mes" && detalhe?.subcoluna === "realizado" && <ModalDetalheLancamentos {...detalhe} codccu={centrosCusto} onClose={() => setDetalhe(null)} />}
      {periodo === "mes" && detalhe?.subcoluna === "orcado" && <ModalDetalheOrcamento {...detalhe} codccu={centrosCusto} onClose={() => setDetalhe(null)} />}
      {anoAberto && (
        <ModalAnoOrcadoRealizado ano={anoAberto} resultado={resultado} colunas={colunas} codccu={centrosCusto} onClose={() => setAnoAberto(null)} />
      )}

      <p className="mt-4 text-[11px] text-muted">
        Orçado vem de orcamentos_contabeis, com o sinal normalizado pra mesma convenção do
        realizado (receita positiva, despesa negativa — o Senior guarda o oposto). Variação =
        realizado − orçado; em %, sobre o orçado (sem orçado aparece "—").
      </p>
    </div>
  );
}
