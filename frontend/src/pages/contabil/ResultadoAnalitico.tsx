import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { SincronizacaoStatus } from "../../components/financeiro/SincronizacaoStatus";
import { MESES_OPCOES } from "../../lib/periodos";
import { MatrizTab } from "../../components/contabil/MatrizTab";
import { OrcadoRealizadoTab } from "../../components/contabil/OrcadoRealizadoTab";
import { DreTab } from "../../components/contabil/DreTab";
import { CentroCustoTab } from "../../components/contabil/CentroCustoTab";
import { DashContabilTab } from "../../components/contabil/DashContabilTab";

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
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  // 403 = autenticado mas não gerencia nenhum departamento com grupo contábil configurado (a
  // tela deixou de ser admin-only em 25/08/2026 — ver domain/contabilDominio.ts).
  const [semAcesso, setSemAcesso] = useState(false);
  // Bump depois de "Atualizar" (SincronizacaoStatus) — vira `key` da aba ativa pra forçar
  // remount e cada aba refazer sua própria busca, sem precisar tocar no código interno delas.
  const [refreshKey, setRefreshKey] = useState(0);
  function handleSincronizado() {
    setRefreshKey((k) => k + 1);
  }

  // Centro de Custo continua admin-only (não tem dimensão de despar/departamento hoje — ver
  // plano) — some da lista de abas pra quem não é admin, inclusive blindando `?visao=cc`
  // digitado manualmente na URL.
  const visoesVisiveis = user?.role === "admin" ? VISOES : VISOES.filter((v) => v.value !== "cc");
  const visaoDaUrl = searchParams.get("visao");
  const visaoInicial = visoesVisiveis.some((v) => v.value === visaoDaUrl) ? (visaoDaUrl as Visao) : "matriz";
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
  // Níveis do plano visíveis na hierarquia da coluna Conta. Recorte só visual: omitir um nível
  // não muda valor nenhum, os descendentes sobem pro ancestral visível mais próximo. Estado
  // INICIAL (tela recém-aberta, sem nada na URL) cai em [1, 5, 6] — nível 1 (o total de
  // Receitas/Despesas, real desde que o bucket sintético saiu em 26/08/2026) + níveis 5-6 (onde a
  // categoria de gasto/receita se diferencia), pulando os agregadores intermediários 2-4. Mesmo
  // idioma de "default esperto, não vazio genérico" já usado em anos/meses acima.
  const [niveis, setNiveis] = useState<number[]>(() => {
    const daUrl = listaDeNumeros(searchParams.get("niveis"));
    return daUrl.length > 0 ? daUrl : [1, 5, 6];
  });
  const [grupos, setGrupos] = useState<string[]>(() => searchParams.get("grupo")?.split(",").filter(Boolean) ?? []);
  const [centrosCusto, setCentrosCusto] = useState<string[]>(() => searchParams.get("codccu")?.split(",").filter(Boolean) ?? []);
  const [incluirSemGrupo, setIncluirSemGrupo] = useState(searchParams.get("incluirSemGrupo") === "true");
  // "clacta" (default) = Classificação da Conta oficial do Senior, mesma que já define a
  // hierarquia pai/filho — fiel ao plano de contas de origem. "ctared" = código reduzido/técnico
  // mostrado no rótulo da linha, mais fácil de conferir a olho mas não é a classificação oficial
  // (seletor pedido pelo Vitor em 26/08/2026, depois de comparar as duas ordens contra dado real).
  const [ordenarPor, setOrdenarPor] = useState<"clacta" | "ctared">(() =>
    searchParams.get("ordenarPor") === "ctared" ? "ctared" : "clacta"
  );

  useEffect(() => {
    axios
      .get("/api/contabil/resultado/opcoes-filtro")
      .then(({ data }) => {
        setOpcoes(data);
        setSemAcesso(false);
      })
      .catch((err) => {
        if (err.response?.status === 403) setSemAcesso(true);
      });
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
    if (ordenarPor !== "clacta") params.ordenarPor = ordenarPor;
    setSearchParams(params, { replace: true });
  }, [visao, anos, meses, niveis, grupos, centrosCusto, incluirSemGrupo, ordenarPor, setSearchParams]);

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
  // Pra não-admin, `grupos` nunca chega como null no backend (ver gruposPermitidos em
  // routes/contabil.ts) — o checkbox nunca muda nada nesse caso, então some da tela.
  const mostrarIncluirSemGrupo = (visao === "matriz" || visao === "orcado") && user?.role === "admin";
  const mostrarOrdenarPor = visao === "matriz" || visao === "orcado";

  if (semAcesso) {
    return (
      <div>
        <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
          Contábil · Resultado Analítico
        </p>
        <p className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
          Esta área é só para quem gerencia algum departamento com grupo contábil configurado. Fale com um
          administrador se você acha que deveria ter acesso.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Contábil · Resultado Analítico</p>
        <SincronizacaoStatus onAtualizado={handleSincronizado} apiBase="/api/contabil/sincronizacao" formato="completo" />
      </div>

      <div className="mb-6 flex flex-wrap gap-1 rounded-md border border-border p-1" style={{ width: "fit-content" }}>
        {visoesVisiveis.map((v) => (
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

        {mostrarOrdenarPor && (
          <div className="flex items-center gap-1 rounded-md border border-border p-1">
            {(
              [
                { value: "clacta", label: "Classificação" },
                { value: "ctared", label: "Nro. Conta" },
              ] as const
            ).map((opcao) => (
              <button
                key={opcao.value}
                onClick={() => setOrdenarPor(opcao.value)}
                className={`rounded px-2.5 py-1 text-[12px] font-medium transition ${
                  ordenarPor === opcao.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {opcao.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {visao === "matriz" && (
        <MatrizTab
          key={refreshKey}
          anos={anos}
          meses={meses}
          niveis={niveis}
          grupos={grupos}
          centrosCusto={centrosCusto}
          incluirSemGrupo={incluirSemGrupo}
          ordenarPor={ordenarPor}
        />
      )}
      {visao === "orcado" && (
        <OrcadoRealizadoTab
          key={refreshKey}
          anos={anos}
          meses={meses}
          niveis={niveis}
          grupos={grupos}
          centrosCusto={centrosCusto}
          incluirSemGrupo={incluirSemGrupo}
          ordenarPor={ordenarPor}
        />
      )}
      {visao === "dre" && <DreTab key={refreshKey} anos={anos} meses={meses} grupos={grupos} centrosCusto={centrosCusto} />}
      {visao === "cc" && <CentroCustoTab key={refreshKey} anos={anos} meses={meses} centrosCusto={centrosCusto} />}
      {visao === "dash" && <DashContabilTab key={refreshKey} ano={anos[0] ?? new Date().getFullYear()} grupos={grupos} />}
    </div>
  );
}
