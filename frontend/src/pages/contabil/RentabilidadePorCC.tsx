import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MultiSelectDropdown, type MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { ModalOrigemRentabilidade, type OrigemAberta } from "../../components/rentabilidade/ModalOrigemRentabilidade";
import { Seta, TabelaPorGrupo, type AcoesTabela, type GrupoTela, type LinhaTela } from "../../components/rentabilidade/TabelaPorGrupo";
import { CONTROLE } from "../../components/ui/estilos";
import { cn } from "../../lib/cn";
import { formatarValor, mesAnterior, type FormatoIndicador } from "../../lib/rentabilidade";

interface Coluna {
  codigo: string;
  rotulo: string;
  formato: FormatoIndicador;
  /** O valor desta coluna abre a origem (lançamentos que o formam). */
  origem?: boolean;
}
interface Linha {
  codccu: string;
  desccu: string;
  valores: Record<string, number | null>;
}
interface Resultado {
  colunas: Coluna[];
  linhas: Linha[];
  total: Record<string, number | null>;
  avisos: string[];
}
interface ResultadoPorGrupo {
  colunas: Coluna[];
  grupos: GrupoTela[];
  total: Record<string, number | null>;
  avisos: string[];
}
interface Opcoes {
  setores: string[];
  centros: { codccu: string; desccu: string }[];
}

type Aba = "grupo" | "cc";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "grupo", rotulo: "Por Grupo" },
  { id: "cc", rotulo: "Por Centro de Custo" },
];

// Rentabilidade (17/11/2026, abas em 24/11/2026): a aba "Por Grupo" agrupa pela Conta Paralela, como a Matriz; a "Por Centro de Custo" tem uma linha por CC.
// QUAIS indicadores existem e como cada um é calculado vem da configuração (Administração › Indicadores de Rentabilidade). Só admin.
export function RentabilidadePorCC() {
  const [params, setParams] = useSearchParams();
  const aba: Aba = params.get("aba") === "cc" ? "cc" : "grupo";
  const trocarAba = (a: Aba) =>
    setParams(
      (p) => {
        p.set("aba", a);
        return p;
      },
      { replace: true }
    );

  const [inicio, setInicio] = useState(mesAnterior());
  const [fim, setFim] = useState(mesAnterior());
  const [setor, setSetor] = useState("");
  const [ccs, setCcs] = useState<string[]>([]);
  const [restringirModelo, setRestringirModelo] = useState(true);
  const [opcoes, setOpcoes] = useState<Opcoes>({ setores: [], centros: [] });
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [porGrupo, setPorGrupo] = useState<ResultadoPorGrupo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [origem, setOrigem] = useState<OrigemAberta | null>(null);

  useEffect(() => {
    axios
      .get<Opcoes>("/api/rentabilidade/opcoes")
      .then(({ data }) => setOpcoes(data))
      .catch(() => undefined);
  }, []);

  // Só a aba aberta é calculada (cada uma tem o seu cálculo no servidor).
  useEffect(() => {
    if (!inicio || !fim) return;
    let cancelado = false;
    setCarregando(true);
    const parametros = { inicio, fim, setor: setor || undefined, cc: ccs.length ? ccs.join(",") : undefined, restringirModelo: restringirModelo ? "1" : "0" };
    const falha = (e: { response?: { data?: { error?: string } } }) => {
      if (cancelado) return;
      setErro(e.response?.data?.error ?? "Falha ao calcular a rentabilidade");
    };
    if (aba === "grupo") {
      axios
        .get<ResultadoPorGrupo>("/api/rentabilidade/calcular-por-grupo", { params: parametros })
        .then(({ data }) => {
          if (cancelado) return;
          setPorGrupo(data);
          setErro(null);
        })
        .catch((e) => {
          falha(e);
          setPorGrupo(null);
        })
        .finally(() => !cancelado && setCarregando(false));
    } else {
      axios
        .get<Resultado>("/api/rentabilidade/calcular", { params: parametros })
        .then(({ data }) => {
          if (cancelado) return;
          setResultado(data);
          setErro(null);
        })
        .catch((e) => {
          falha(e);
          setResultado(null);
        })
        .finally(() => !cancelado && setCarregando(false));
    }
    return () => {
      cancelado = true;
    };
  }, [inicio, fim, setor, ccs, restringirModelo, aba]);

  const opcoesCc: MultiSelectOption<string>[] = useMemo(() => opcoes.centros.map((c) => ({ value: c.codccu, label: `${c.codccu} · ${c.desccu}` })), [opcoes.centros]);

  // As duas abas usam as mesmas colunas (indicadores configurados), então as mesmas definições e a mesma chave do kit de colunas.
  const colunas = useMemo<Coluna[]>(() => (aba === "grupo" ? porGrupo?.colunas : resultado?.colunas) ?? [], [aba, porGrupo, resultado]);
  const avisos = (aba === "grupo" ? porGrupo?.avisos : resultado?.avisos) ?? [];
  const semIndicadores = !carregando && colunas.length === 0 && !!(aba === "grupo" ? porGrupo : resultado);

  // Ordem, visibilidade, largura, título, filtro, ordem e resumo (Σ) por coluna são do kit de colunas do CaxHub (por usuário, chave `contabil.rentabilidade-cc`).
  // O total do recorte é o do servidor (razões e percentuais não se somam).
  const defs = useMemo<DefColuna<LinhaTela, AcoesTabela>[]>(
    () => [
      {
        nome: "centroDeCusto",
        titulo: "Centro de custo",
        fixa: true,
        congelada: true,
        largura: 280,
        texto: (l) => (l.total ? "Total do recorte" : l.grupo ? l.codccu : `${l.codccu} ${l.desccu}`),
        classe: "text-foreground",
        render: (l, a) => {
          if (l.total) return "Total do recorte";
          if (l.grupo) {
            const g = l.grupoCodigo ?? "";
            return (
              <button
                type="button"
                onClick={() => a.alternar(g)}
                aria-expanded={a.expandido(g)}
                className="flex items-center gap-2 font-semibold text-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Seta aberta={a.expandido(g)} />
                {l.codccu}
              </button>
            );
          }
          return (
            <span className={cn("flex items-center gap-1.5", l.cc && "pl-6")}>
              <span className="font-mono text-xs text-muted">{l.codccu}</span> {l.desccu}
            </span>
          );
        },
      },
      ...colunas.map<DefColuna<LinhaTela, AcoesTabela>>((c) => ({
        nome: c.codigo,
        titulo: c.rotulo,
        direita: true,
        largura: 130,
        formatarValor: (v) => formatarValor(typeof v === "number" ? v : null, c.formato),
        formatarResumo: (v) => formatarValor(v, c.formato),
        // Percentual não se soma.
        ...(c.formato === "percentual" ? { resumos: ["media", "minimo", "maximo", "mediana"] as const } : {}),
        classe: (l) => cn("whitespace-nowrap tabular-nums", (l.valores[c.codigo] ?? 0) < 0 && c.formato !== "percentual" && "text-destructive"),
        // Valor diferente de zero numa coluna com origem vira link para os lançamentos que o formam (a linha de total abre o recorte inteiro).
        render: (l, a) => {
          const v = l.valores[c.codigo];
          const texto = formatarValor(v, c.formato);
          if (!c.origem || v === null || v === undefined || Math.abs(v) < 0.005) return texto;
          return (
            <button
              type="button"
              onClick={() => a.abrir(c, l)}
              className="-mx-1 rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Ver os lançamentos que formam este valor"
            >
              {texto}
            </button>
          );
        },
      })),
    ],
    [colunas]
  );
  const colunasLocais = useMemo<ColunaLocal[]>(
    () => [{ nome: "centroDeCusto", tipo: "texto", obrigatoria: true }, ...colunas.map((c): ColunaLocal => ({ nome: c.codigo, tipo: "decimal" }))],
    [colunas]
  );
  const lerCelula = useMemo(() => (l: LinhaTela, coluna: string): unknown => (coluna === "centroDeCusto" ? `${l.codccu} ${l.desccu}` : l.valores[coluna]), []);
  const linhaDeTotal = useMemo<LinhaTela | undefined>(() => (resultado ? { codccu: "", desccu: "Total do recorte", valores: resultado.total, total: true } : undefined), [resultado]);
  const linhas = useMemo<LinhaTela[]>(() => resultado?.linhas ?? [], [resultado]);

  // O que o clique no valor abre: o total do recorte (linha de total), o grupo (linha de grupo) ou o CC (na aba por CC, ou o CC dentro do grupo).
  const acoes = useMemo<AcoesTabela>(
    () => ({
      abrir: (c, l) =>
        setOrigem({
          codigo: c.codigo,
          rotulo: c.rotulo,
          formato: c.formato,
          grupo: l.total ? undefined : l.grupoCodigo,
          centroCusto: l.total || l.grupo ? null : { codccu: l.codccu, desccu: l.desccu },
        }),
      alternar: () => undefined,
      expandido: () => false,
    }),
    []
  );

  const periodoInvalido = !!inicio && !!fim && inicio > fim;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Contábil · Rentabilidade</p>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-foreground">Rentabilidade por CC</h1>
        <Link to="/admin/indicadores-rentabilidade" className="text-sm text-primary underline-offset-2 hover:underline">
          Configurar indicadores
        </Link>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        Cada coluna é um indicador configurado (soma de contas, fórmula ou campo do sistema). O total é calculado sobre o recorte inteiro, não somando as razões das linhas.
      </p>

      <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => trocarAba(a.id)}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm transition", aba === a.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted hover:text-foreground")}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          De
          <input type="month" id="rent-inicio" value={inicio} onChange={(e) => setInicio(e.target.value)} className={cn(CONTROLE, "w-40")} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Até
          <input type="month" id="rent-fim" value={fim} onChange={(e) => setFim(e.target.value)} className={cn(CONTROLE, "w-40")} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Setor
          <select id="rent-setor" value={setor} onChange={(e) => setSetor(e.target.value)} className={cn(CONTROLE, "w-40")}>
            <option value="">Todos</option>
            {opcoes.setores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted">
          Centro de custo
          <MultiSelectDropdown opcoes={opcoesCc} selecionados={ccs} onChange={setCcs} labelTodos="Todos" labelSufixo="centros de custo" />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm text-foreground" title="Como o BI: conta ou CC fora do modelo de plano da empresa (E043PCM) não entra">
          <input type="checkbox" id="rent-modelo" checked={restringirModelo} onChange={(e) => setRestringirModelo(e.target.checked)} />
          Só contas e CCs do modelo do Senior
        </label>
      </div>

      {periodoInvalido && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">O mês inicial é depois do final.</p>}
      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}
      {avisos.map((a) => (
        <p key={a} className="mb-3 rounded-md border border-border bg-surface-2 px-4 py-2.5 text-sm text-muted">
          {a}
        </p>
      ))}

      {semIndicadores ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          Nenhum indicador configurado.{" "}
          <Link to="/admin/indicadores-rentabilidade" className="text-primary underline-offset-2 hover:underline">
            Cadastre ou importe a configuração
          </Link>
          .
        </p>
      ) : aba === "grupo" ? (
        <TabelaPorGrupo
          chave="contabil.rentabilidade-cc"
          defs={defs}
          grupos={porGrupo?.grupos ?? []}
          total={porGrupo?.total ?? {}}
          abrir={acoes.abrir}
          loading={carregando}
          vazio="Nenhum grupo com movimento neste recorte."
        />
      ) : (
        <TabelaLocal<LinhaTela, AcoesTabela>
          chave="contabil.rentabilidade-cc"
          defs={defs}
          colunas={colunasLocais}
          linhas={linhas}
          ler={lerCelula}
          chaveLinha={(l) => l.codccu}
          loading={carregando}
          vazio="Nenhum centro de custo com movimento neste recorte."
          alturaMax="max-h-[70vh]"
          linhaDeTotal={linhaDeTotal}
          ctx={acoes}
        />
      )}
      {origem && <ModalOrigemRentabilidade origem={origem} recorte={{ inicio, fim, setor, ccs, restringirModelo }} onClose={() => setOrigem(null)} />}
    </div>
  );
}
