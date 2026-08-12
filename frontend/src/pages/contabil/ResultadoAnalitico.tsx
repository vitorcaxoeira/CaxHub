import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { MatrizContabil, LinhaMatrizContabil } from "../../components/contabil/MatrizContabil";

const API_BASE = "/api/contabil/resultado";

interface OpcoesFiltro {
  anos: number[];
  grupos: MultiSelectOption<string>[];
  centrosCusto: MultiSelectOption<string>[];
}

interface RespostaResultado {
  meses: string[];
  linhas: LinhaMatrizContabil[];
  totalGeral: { valores: number[]; total: number };
}

const RESULTADO_VAZIO: RespostaResultado = { meses: [], linhas: [], totalGeral: { valores: [], total: 0 } };

export function ResultadoAnalitico() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [ano, setAno] = useState(() => Number(searchParams.get("ano")) || new Date().getFullYear());
  const [grupos, setGrupos] = useState<string[]>(() => searchParams.get("grupo")?.split(",").filter(Boolean) ?? []);
  const [centrosCusto, setCentrosCusto] = useState<string[]>(() => searchParams.get("codccu")?.split(",").filter(Boolean) ?? []);
  const [incluirSemGrupo, setIncluirSemGrupo] = useState(searchParams.get("incluirSemGrupo") === "true");

  const [resultado, setResultado] = useState<RespostaResultado>(RESULTADO_VAZIO);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get(`${API_BASE}/opcoes-filtro`)
      .then(({ data }) => setOpcoes(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar as opções de filtro"));
  }, []);

  useEffect(() => {
    const params: Record<string, string> = { ano: String(ano) };
    if (grupos.length > 0) params.grupo = grupos.join(",");
    if (centrosCusto.length > 0) params.codccu = centrosCusto.join(",");
    if (incluirSemGrupo) params.incluirSemGrupo = "true";
    setSearchParams(params, { replace: true });
  }, [ano, grupos, centrosCusto, incluirSemGrupo, setSearchParams]);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = { ano: String(ano) };
    if (grupos.length > 0) params.grupo = grupos.join(",");
    if (centrosCusto.length > 0) params.codccu = centrosCusto.join(",");
    if (incluirSemGrupo) params.incluirSemGrupo = "true";
    axios
      .get(API_BASE, { params })
      .then(({ data }) => {
        setResultado(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar o resultado analítico"))
      .finally(() => setLoading(false));
  }, [ano, grupos, centrosCusto, incluirSemGrupo]);

  const anosDisponiveis = useMemo(() => {
    if (!opcoes) return [ano];
    return opcoes.anos.includes(ano) ? opcoes.anos : [ano, ...opcoes.anos].sort((a, b) => b - a);
  }, [opcoes, ano]);

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Contábil · Resultado Analítico
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={ano}
          onChange={(e) => setAno(Number(e.target.value))}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {anosDisponiveis.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <MultiSelectDropdown
          opcoes={opcoes?.grupos ?? []}
          selecionados={grupos}
          onChange={setGrupos}
          labelTodos="Todos os grupos"
          labelSufixo="grupos"
        />

        <MultiSelectDropdown
          opcoes={opcoes?.centrosCusto ?? []}
          selecionados={centrosCusto}
          onChange={setCentrosCusto}
          labelTodos="Todos os centros de custo"
          labelSufixo="centros de custo"
        />

        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={incluirSemGrupo}
            onChange={(e) => setIncluirSemGrupo(e.target.checked)}
            className="accent-primary"
          />
          Incluir contas sem grupo
        </label>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <MatrizContabil meses={resultado.meses} linhas={resultado.linhas} totalGeral={resultado.totalGeral} loading={loading} />

      <p className="mt-4 text-[11px] text-muted">
        Realizado = rateios contabilizados (situação "Contabilizado" no lançamento), crédito soma e débito subtrai.
        Por padrão só entram contas com grupo gerencial (Conta Paralela) definido.
      </p>
    </div>
  );
}
