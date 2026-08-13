import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { MatrizTab } from "../../components/contabil/MatrizTab";
import { OrcadoRealizadoTab } from "../../components/contabil/OrcadoRealizadoTab";
import { DreTab } from "../../components/contabil/DreTab";
import { CentroCustoTab } from "../../components/contabil/CentroCustoTab";
import { DashContabilTab } from "../../components/contabil/DashContabilTab";

// Opções fixas do filtro de mês — não vêm do backend (o domínio é sempre 1-12).
const MESES_OPCOES: MultiSelectOption<number>[] = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];

type Visao = "matriz" | "orcado" | "dre" | "cc" | "dash";
const VISOES: { value: Visao; label: string }[] = [
  { value: "matriz", label: "Matriz" },
  { value: "orcado", label: "Orçado x Realizado" },
  { value: "dre", label: "DRE" },
  { value: "cc", label: "Centro de Custo" },
  { value: "dash", label: "Dash" },
];

interface OpcoesFiltro {
  anos: number[];
  grupos: MultiSelectOption<string>[];
  // Níveis que existem neste plano de contas (vem do dado, não é 1..6 fixo — ver
  // backend/src/domain/hierarquiaPlano.ts).
  niveis: number[];
  centrosCusto: MultiSelectOption<string>[];
}

function listaDeNumeros(valor: string | null): number[] {
  return valor
    ? valor
        .split(",")
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n))
    : [];
}

export function ResultadoAnalitico() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);

  const visaoInicial = VISOES.some((v) => v.value === searchParams.get("visao")) ? (searchParams.get("visao") as Visao) : "matriz";
  const [visao, setVisao] = useState<Visao>(visaoInicial);

  // Ano e mês são multi-seleção — dá pra comparar vários anos lado a lado (cada
  // combinação ano×mês vira uma coluna na matriz) e/ou recortar só alguns meses. Sem
  // seleção de ano, cai no ano atual (a tela não faz sentido sem nenhum ano escolhido);
  // Sem seleção de mês (ex.: depois de "Limpar seleção"), o backend já assume os 12 —
  // mesmo idioma "vazio = todos" dos outros filtros desta tela. Só o estado INICIAL (tela
  // recém-aberta, sem nada na URL) é diferente: cai no ano atual e só até o mês atual —
  // meses futuros do ano corrente não têm lançamento ainda, mostrar coluna vazia pra eles
  // de cara só confundiria.
  const [anos, setAnos] = useState<number[]>(() => {
    const daUrl = listaDeNumeros(searchParams.get("anos"));
    return daUrl.length > 0 ? daUrl : [new Date().getFullYear()];
  });
  const [meses, setMeses] = useState<number[]>(() => {
    const daUrl = listaDeNumeros(searchParams.get("meses"));
    if (daUrl.length > 0) return daUrl;
    const mesAtual = new Date().getMonth() + 1;
    return Array.from({ length: mesAtual }, (_, i) => i + 1);
  });
  // Níveis do plano visíveis na hierarquia da coluna Conta. Vazio = todos. Recorte só visual:
  // omitir um nível não muda valor nenhum, os descendentes sobem pro ancestral visível.
  const [niveis, setNiveis] = useState<number[]>(() => listaDeNumeros(searchParams.get("niveis")));
  const [grupos, setGrupos] = useState<string[]>(() => searchParams.get("grupo")?.split(",").filter(Boolean) ?? []);
  const [centrosCusto, setCentrosCusto] = useState<string[]>(() => searchParams.get("codccu")?.split(",").filter(Boolean) ?? []);
  const [incluirSemGrupo, setIncluirSemGrupo] = useState(searchParams.get("incluirSemGrupo") === "true");

  useEffect(() => {
    axios
      .get("/api/contabil/resultado/opcoes-filtro")
      .then(({ data }) => setOpcoes(data))
      .catch(() => {});
  }, []);

  // Todo filtro + a aba ativa ficam na URL — reabrir o link (ou dar F5) volta exatamente
  // onde a pessoa estava.
  useEffect(() => {
    const params: Record<string, string> = { visao, anos: anos.join(",") };
    if (meses.length > 0) params.meses = meses.join(",");
    if (niveis.length > 0) params.niveis = niveis.join(",");
    if (grupos.length > 0) params.grupo = grupos.join(",");
    if (centrosCusto.length > 0) params.codccu = centrosCusto.join(",");
    if (incluirSemGrupo) params.incluirSemGrupo = "true";
    setSearchParams(params, { replace: true });
  }, [visao, anos, meses, niveis, grupos, centrosCusto, incluirSemGrupo, setSearchParams]);

  const opcoesAnos = useMemo(() => {
    const todos = new Set([...(opcoes?.anos ?? []), ...anos]);
    return [...todos].sort((a, b) => b - a).map((a) => ({ value: a, label: String(a) }));
  }, [opcoes, anos]);

  const opcoesNiveis = useMemo(() => (opcoes?.niveis ?? []).map((n) => ({ value: n, label: `Nível ${n}` })), [opcoes]);

  // Cada aba usa um subconjunto dos filtros (ver plano): Centro de Custo não tem dimensão de
  // conta (nem grupo, nem nível, nem "sem grupo"); Dash é sempre ano completo (sem filtro de
  // mês) e só um ano por vez (o eixo dele já é a comparação de 2 anos).
  const mostrarNiveis = visao === "matriz" || visao === "orcado";
  const mostrarGrupo = visao !== "cc";
  const mostrarMeses = visao !== "dash";
  const mostrarCentroCusto = visao !== "dash";
  const mostrarIncluirSemGrupo = visao === "matriz" || visao === "orcado";

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Contábil · Resultado Analítico</p>

      <div className="mb-6 flex flex-wrap gap-1 rounded-md border border-border p-1" style={{ width: "fit-content" }}>
        {VISOES.map((v) => (
          <button
            key={v.value}
            onClick={() => setVisao(v.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              visao === v.value ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <MultiSelectDropdown
          opcoes={opcoesAnos}
          selecionados={anos}
          onChange={setAnos}
          labelTodos="Nenhum ano"
          labelSufixo="anos"
        />

        {mostrarMeses && (
          <MultiSelectDropdown opcoes={MESES_OPCOES} selecionados={meses} onChange={setMeses} labelTodos="Todos os meses" labelSufixo="meses" />
        )}

        {mostrarNiveis && (
          <MultiSelectDropdown
            opcoes={opcoesNiveis}
            selecionados={niveis}
            onChange={setNiveis}
            labelTodos="Todos os níveis"
            labelSufixo="níveis"
          />
        )}

        {mostrarGrupo && (
          <MultiSelectDropdown
            opcoes={opcoes?.grupos ?? []}
            selecionados={grupos}
            onChange={setGrupos}
            labelTodos="Todos os grupos"
            labelSufixo="grupos"
          />
        )}

        {mostrarCentroCusto && (
          <MultiSelectDropdown
            opcoes={opcoes?.centrosCusto ?? []}
            selecionados={centrosCusto}
            onChange={setCentrosCusto}
            labelTodos="Todos os centros de custo"
            labelSufixo="centros de custo"
          />
        )}

        {mostrarIncluirSemGrupo && (
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <input
              type="checkbox"
              checked={incluirSemGrupo}
              onChange={(e) => setIncluirSemGrupo(e.target.checked)}
              className="accent-primary"
            />
            Incluir contas sem grupo
          </label>
        )}
      </div>

      {visao === "matriz" && (
        <MatrizTab anos={anos} meses={meses} niveis={niveis} grupos={grupos} centrosCusto={centrosCusto} incluirSemGrupo={incluirSemGrupo} />
      )}
      {visao === "orcado" && (
        <OrcadoRealizadoTab
          anos={anos}
          meses={meses}
          niveis={niveis}
          grupos={grupos}
          centrosCusto={centrosCusto}
          incluirSemGrupo={incluirSemGrupo}
        />
      )}
      {visao === "dre" && <DreTab anos={anos} meses={meses} grupos={grupos} centrosCusto={centrosCusto} />}
      {visao === "cc" && <CentroCustoTab anos={anos} meses={meses} centrosCusto={centrosCusto} />}
      {visao === "dash" && <DashContabilTab ano={anos[0] ?? new Date().getFullYear()} grupos={grupos} />}
    </div>
  );
}
