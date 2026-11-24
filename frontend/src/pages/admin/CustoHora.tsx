import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { OrigemCustoHora, type OrigemResposta } from "../../components/custoHora/OrigemCustoHora";
import { SeletorContas } from "../../components/rentabilidade/SeletorContas";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { Skeleton } from "../../components/ui/Skeleton";
import { cn } from "../../lib/cn";
import { descreverDetalhe, mesAnterior, resumirResultado, ROTULO_ORIGEM, rotuloCompetencia } from "../../lib/custoHora";
import { alternarRegra, chaveDaConta, type ContaDoPlano, type RegraConta } from "../../lib/rentabilidade";
import { formatarReais } from "../../lib/vinculoConsultores";

interface Config {
  parametros: Record<string, string>;
  definicoesParametros: Record<string, string>;
  contasFolha: { codemp: number; ctared: number; acao: string }[];
  contabilizacaoFolha: { linhas: number; ate: string | null };
  ultimaExecucao: { status: string; message: string | null; runAt: string } | null;
}

interface LinhaResultado {
  codemp: number;
  codusu: number;
  nome: string;
  ativo: boolean;
  origem: string | null;
  custoHora: number | null;
  detalhe: unknown;
}

interface ResumoRecalculo {
  competencias: string[];
  gravados: number;
  porOrigem: { clt_folha: number; pj_contrato: number; manual: number };
  semCusto: number;
  avisos: string[];
}

type Aba = "resultado" | "contas" | "parametros";

const BOTAO = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition hover:border-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const BOTAO_PRIMARIO = "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const CAMPO = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const POR_PAGINA = { inicial: 25 };

const mensagemDe = (err: unknown, padrao: string): string => (axios.isAxiosError(err) ? (err.response?.data?.error ?? padrao) : padrao);

export function CustoHora() {
  const [aba, setAba] = useState<Aba>("resultado");
  const [config, setConfig] = useState<Config | null>(null);
  // Só mensagens do que foi feito (ou do que falhou), em aviso passageiro: a tela não carrega texto explicativo. `toastRef` mantém os callbacks
  // estáveis (o contexto do Toast troca de objeto a cada aviso, e as abas recarregam dados quando `setErro` muda).
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const setErro = useCallback((m: string | null): void => {
    if (m) toastRef.current.mostrar(m, "destructive");
  }, []);
  const setAviso = useCallback((m: string | null): void => {
    if (m) toastRef.current.mostrar(m, "success");
  }, []);
  const importarRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState<{ texto: string; substituir: boolean } | null>(null);

  const carregarConfig = useCallback(() => {
    return axios
      .get<Config>("/api/custo-hora/config")
      .then(({ data }) => setConfig(data))
      .catch((err) => setErro(mensagemDe(err, "Falha ao carregar a configuração")));
  }, [setErro]);

  useEffect(() => {
    void carregarConfig();
  }, [carregarConfig]);

  async function exportar() {
    try {
      const { data } = await axios.get("/api/custo-hora/exportar");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "custo-hora-config.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao exportar"));
    }
  }

  async function importar() {
    if (!importando) return;
    try {
      const corpo = JSON.parse(importando.texto) as Record<string, unknown>;
      const { data } = await axios.post<{ parametros: number; contasFolha: number }>("/api/custo-hora/importar", { ...corpo, substituir: importando.substituir });
      setAviso(`Importado: ${data.parametros} parâmetro(s) e ${data.contasFolha} regra(s) de conta da folha.`);
      setImportando(null);
      await carregarConfig();
    } catch (err) {
      setErro(err instanceof SyntaxError ? "O arquivo não é um JSON válido." : mensagemDe(err, "Falha ao importar"));
    }
  }

  const ABAS: { id: Aba; rotulo: string }[] = [
    { id: "resultado", rotulo: "Resultado por mês" },
    { id: "contas", rotulo: "Contas da folha" },
    { id: "parametros", rotulo: "Parâmetros" },
  ];

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Administração · Custo-hora real</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-foreground">Custo-hora real</h1>
        <div className="flex gap-2">
          <button type="button" className={BOTAO} onClick={() => importarRef.current?.click()}>
            Importar JSON
          </button>
          <button type="button" className={BOTAO} onClick={() => void exportar()}>
            Exportar JSON
          </button>
          <input
            ref={importarRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              e.target.value = "";
              if (arquivo) void arquivo.text().then((texto) => setImportando({ texto, substituir: false }));
            }}
          />
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-border" role="tablist">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm transition", aba === a.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted hover:text-foreground")}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {!config ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {aba === "resultado" && <AbaResultado aoRecalcular={carregarConfig} />}
          {aba === "contas" && <AbaContas config={config} recarregar={carregarConfig} setErro={setErro} setAviso={setAviso} />}
          {aba === "parametros" && <AbaParametros config={config} recarregar={carregarConfig} setErro={setErro} setAviso={setAviso} />}
        </>
      )}

      <Modal open={importando !== null} onClose={() => setImportando(null)} title="Importar configuração" subtitulo="Parâmetros e contas da folha">
        <div className="space-y-4 text-sm">
          <label className="flex items-center gap-2 text-foreground">
            <input type="checkbox" checked={importando?.substituir ?? false} onChange={(e) => setImportando((i) => (i ? { ...i, substituir: e.target.checked } : i))} />
            Substituir: apagar as contas da folha atuais antes de importar
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={BOTAO} onClick={() => setImportando(null)}>
              Cancelar
            </button>
            <button type="button" className={BOTAO_PRIMARIO} onClick={() => void importar()}>
              Importar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Resultado por mês ----------

const COLUNAS_RESULTADO_LOCAIS: ColunaLocal[] = [
  { nome: "nome", tipo: "texto", obrigatoria: true },
  { nome: "ativo", tipo: "booleano", obrigatoria: true },
  { nome: "origem", tipo: "texto" },
  { nome: "custoHora", tipo: "decimal" },
];

const lerResultado = (l: LinhaResultado, coluna: string): unknown => (coluna === "origem" ? (l.origem ? (ROTULO_ORIGEM as Record<string, string>)[l.origem] : "Sem custo") : (l as unknown as Record<string, unknown>)[coluna]);

/** Liga o valor do custo-hora ao detalhe de origem (modal). */
interface AcoesResultado {
  abrirOrigem: (l: LinhaResultado) => void;
}

const COLUNAS_RESULTADO: DefColuna<LinhaResultado, AcoesResultado>[] = [
  { nome: "nome", titulo: "Consultor", fixa: true, largura: 240, classe: "text-sm font-semibold text-foreground", render: (l) => l.nome },
  { nome: "ativo", titulo: "Ativo", largura: 90, formatarValor: (v) => (v === true || v === "true" ? "Sim" : "Não"), classe: "text-sm text-muted", render: (l) => (l.ativo ? "Sim" : "Não") },
  {
    nome: "origem",
    titulo: "Origem",
    largura: 150,
    render: (l) =>
      l.origem ? (
        <span className="rounded bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">{(ROTULO_ORIGEM as Record<string, string>)[l.origem] ?? l.origem}</span>
      ) : (
        <span className="rounded bg-warning/15 px-2 py-0.5 text-[11.5px] font-medium text-warning">Sem custo</span>
      ),
  },
  {
    nome: "custoHora",
    titulo: "Custo-hora",
    direita: true,
    largura: 130,
    classe: "font-mono text-sm tabular-nums text-foreground",
    render: (l, a) =>
      l.custoHora != null ? (
        <button type="button" className="text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Ver de onde veio este valor" onClick={() => a.abrirOrigem(l)}>
          {formatarReais(l.custoHora)}
        </button>
      ) : (
        formatarReais(l.custoHora)
      ),
  },
  { nome: "detalhe", titulo: "Como chegou", largura: 320, classe: "text-[12.5px] text-muted", render: (l) => descreverDetalhe(l.origem, l.detalhe) },
];

function AbaResultado({ aoRecalcular }: { aoRecalcular: () => Promise<void> }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const setErro = useCallback((m: string | null): void => {
    if (m) toastRef.current.mostrar(m, "destructive");
  }, []);
  const [competencia, setCompetencia] = useState(mesAnterior());
  const [linhas, setLinhas] = useState<LinhaResultado[]>([]);
  const [loading, setLoading] = useState(true);
  const [de, setDe] = useState(mesAnterior());
  const [ate, setAte] = useState(mesAnterior());
  const [calculando, setCalculando] = useState(false);
  const [origemDe, setOrigemDe] = useState<LinhaResultado | null>(null);
  const [origem, setOrigem] = useState<OrigemResposta | null>(null);

  const carregar = useCallback(() => {
    setLoading(true);
    return axios
      .get<{ linhas: LinhaResultado[] }>("/api/custo-hora/resultado", { params: { competencia } })
      .then(({ data }) => {
        setLinhas(data.linhas);
      })
      .catch((err) => setErro(mensagemDe(err, "Falha ao carregar o resultado")))
      .finally(() => setLoading(false));
  }, [competencia, setErro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function recalcular() {
    setCalculando(true);
    try {
      const { data } = await axios.post<ResumoRecalculo>("/api/custo-hora/recalcular", { de, ate });
      toastRef.current.mostrar(`Recálculo concluído: ${data.gravados} custo(s)-hora gravado(s) (${data.porOrigem.clt_folha} CLT, ${data.porOrigem.pj_contrato} PJ, ${data.porOrigem.manual} manual) em ${data.competencias.length} mês(es).`, "success");
      for (const a of data.avisos) toastRef.current.mostrar(a, "warning");
      await Promise.all([carregar(), aoRecalcular()]);
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao recalcular"));
    } finally {
      setCalculando(false);
    }
  }

  const totais = useMemo(() => resumirResultado(linhas), [linhas]);

  // Abre o detalhe de origem do valor: busca o que o cálculo considerou (lançamentos da folha, contrato ou valor manual) para a competência da tabela.
  const abrirOrigem = useCallback(
    (l: LinhaResultado) => {
      setOrigemDe(l);
      setOrigem(null);
      axios
        .get<OrigemResposta>(`/api/custo-hora/origem/${l.codemp}/${l.codusu}`, { params: { competencia } })
        .then(({ data }) => setOrigem(data))
        .catch((err) => {
          setErro(mensagemDe(err, "Falha ao carregar a origem do custo-hora"));
          setOrigemDe(null);
        });
    },
    [competencia, setErro],
  );
  const acoesResultado = useMemo<AcoesResultado>(() => ({ abrirOrigem }), [abrirOrigem]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3">
        <label className="text-sm text-muted">
          Competência
          <input type="month" className={cn(CAMPO, "ml-2")} value={competencia} onChange={(e) => e.target.value && setCompetencia(e.target.value)} />
        </label>
        <span className="text-sm text-muted">Recalcular de</span>
        <input type="month" className={CAMPO} value={de} onChange={(e) => e.target.value && setDe(e.target.value)} aria-label="Recalcular a partir de" />
        <span className="text-sm text-muted">até</span>
        <input type="month" className={CAMPO} value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} aria-label="Recalcular até" />
        <button type="button" className={BOTAO_PRIMARIO} disabled={calculando} onClick={() => void recalcular()}>
          {calculando ? "Calculando..." : "Recalcular período"}
        </button>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <span>
          Resultado de <b className="text-foreground">{rotuloCompetencia(`${competencia}-01`)}</b>:
        </span>
        <span>
          <b className="text-foreground">{totais.clt_folha}</b> CLT
        </span>
        <span>
          <b className="text-foreground">{totais.pj_contrato}</b> PJ
        </span>
        <span>
          <b className="text-foreground">{totais.manual}</b> manual
        </span>
        <span className={totais.semCusto > 0 ? "text-warning" : undefined}>
          <b>{totais.semCusto}</b> ativo(s) sem custo
        </span>
      </div>

      <TabelaLocal<LinhaResultado, AcoesResultado>
        chave="admin.custo-hora.resultado"
        defs={COLUNAS_RESULTADO}
        ctx={acoesResultado}
        colunas={COLUNAS_RESULTADO_LOCAIS}
        linhas={linhas}
        ler={lerResultado}
        chaveLinha={(l) => `${l.codemp}-${l.codusu}`}
        loading={loading}
        vazio="Nenhum resultado para esta competência."
        paginacao={{ ...POR_PAGINA, rotulo: "consultores" }}
      />

      <Modal
        open={origemDe !== null}
        onClose={() => {
          setOrigemDe(null);
          setOrigem(null);
        }}
        title={origemDe ? `Origem do custo-hora — ${origemDe.nome}` : "Origem do custo-hora"}
        subtitulo={rotuloCompetencia(`${competencia}-01`)}
        className="max-w-5xl"
      >
        {origem ? <OrigemCustoHora dados={origem} /> : <Skeleton className="h-40 w-full" />}
      </Modal>
    </div>
  );
}

// ---------- Contas da folha (R048CTB) ----------

interface MovimentoConta {
  codemp: number;
  ctared: number;
  clacta: string | null;
  descta: string | null;
  debito: number;
  credito: number;
  colaboradores: number;
  selecionada: boolean;
}

interface Movimento {
  competencia: string | null;
  contas: MovimentoConta[];
  totais: { debito: number; credito: number; debitoSelecionado: number };
}

const COLUNAS_MOVIMENTO_LOCAIS: ColunaLocal[] = [
  { nome: "conta", tipo: "texto", obrigatoria: true },
  { nome: "debito", tipo: "decimal", obrigatoria: true },
  { nome: "credito", tipo: "decimal", obrigatoria: true },
  { nome: "colaboradores", tipo: "inteiro", obrigatoria: true },
  { nome: "selecionada", tipo: "booleano", obrigatoria: true },
];

const lerMovimento = (c: MovimentoConta, coluna: string): unknown => (coluna === "conta" ? `${c.clacta ?? ""} ${c.descta ?? "(fora do plano)"} ${c.ctared}` : (c as unknown as Record<string, unknown>)[coluna]);

/** Liga a coluna "Ação" do movimento às regras ainda não salvas da aba (as mesmas do seletor de contas acima). */
interface AcoesMovimento {
  /** Regra DIRETA de cada conta (ctared → ação), como está agora na lista de regras. */
  regraDe: Map<number, "incluir" | "excluir">;
  alternar: (c: MovimentoConta, acao: "incluir" | "excluir") => void;
}

const COLUNAS_MOVIMENTO: DefColuna<MovimentoConta, AcoesMovimento>[] = [
  {
    nome: "conta",
    titulo: "Conta contabilizada pela folha",
    fixa: true,
    largura: 380,
    render: (c) => (
      <span className="text-sm text-foreground" title={`${c.clacta ?? ""} · ${c.descta ?? ""}`}>
        <span className="font-mono text-xs text-muted">{c.clacta ?? "—"}</span> {c.descta ?? "(fora do plano)"} <span className="text-xs text-muted">({c.ctared})</span>
      </span>
    ),
  },
  { nome: "debito", titulo: "Débito", direita: true, largura: 130, classe: "font-mono text-sm tabular-nums text-muted", render: (c) => formatarReais(c.debito) },
  { nome: "credito", titulo: "Crédito", direita: true, largura: 130, classe: "font-mono text-sm tabular-nums text-muted", render: (c) => formatarReais(c.credito) },
  { nome: "colaboradores", titulo: "Colaboradores", direita: true, largura: 120, classe: "font-mono text-sm tabular-nums text-muted", render: (c) => c.colaboradores.toLocaleString("pt-BR") },
  {
    nome: "selecionada",
    titulo: "Entra no custo",
    largura: 120,
    formatarValor: (v) => (v === true || v === "true" ? "Sim" : "Não"),
    render: (c) =>
      c.selecionada ? <span className="rounded bg-success/15 px-2 py-0.5 text-[11.5px] font-medium text-success">Sim</span> : <span className="rounded bg-muted/15 px-2 py-0.5 text-[11.5px] font-medium text-muted">Não</span>,
  },
  {
    nome: "acao",
    titulo: "Ação",
    semOrdenar: true,
    largura: 230,
    dica: "Adiciona a conta à lista de regras (acima) como \"entra no custo\". Vale depois de Salvar regras.",
    render: (c, a) => {
      const regra = a.regraDe.get(c.ctared);
      if (regra) {
        return (
          <span className="flex items-center gap-2">
            <span className={cn("rounded px-2 py-0.5 text-[11.5px] font-medium", regra === "incluir" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>{regra === "incluir" ? "Na lista" : "Excluída"}</span>
            <button type="button" className="text-[12px] text-destructive underline-offset-2 hover:underline" onClick={() => a.alternar(c, regra)}>
              Remover
            </button>
          </span>
        );
      }
      if (c.selecionada) return <span className="text-[12px] text-muted" title="Alguma regra de uma conta sintética acima já inclui esta conta.">Já entra (conta acima)</span>;
      if (!c.descta) return <span className="text-[12px] text-muted" title="A conta não existe no plano contábil do ERP.">Fora do plano</span>;
      return (
        <button type="button" className="rounded border border-border bg-surface-2/60 px-2 py-0.5 text-[12px] text-foreground transition hover:border-primary hover:text-primary" onClick={() => a.alternar(c, "incluir")}>
          + Entra no custo
        </button>
      );
    },
  },
];

function AbaContas({ config, recarregar, setErro, setAviso }: { config: Config; recarregar: () => Promise<void>; setErro: (e: string | null) => void; setAviso: (a: string | null) => void }) {
  const [plano, setPlano] = useState<ContaDoPlano[] | null>(null);
  const [usadas, setUsadas] = useState<ReadonlySet<string>>(new Set());
  const salvas = useMemo<RegraConta[]>(() => config.contasFolha.map((c) => ({ codemp: c.codemp, ctared: c.ctared, acao: c.acao as "incluir" | "excluir" })), [config.contasFolha]);
  const [regras, setRegras] = useState<RegraConta[]>(salvas);
  const [competencia, setCompetencia] = useState(mesAnterior());
  const [movimento, setMovimento] = useState<Movimento | null>(null);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => setRegras(salvas), [salvas]);

  useEffect(() => {
    axios
      .get<{ contas: ContaDoPlano[] }>("/api/rentabilidade/plano")
      .then(({ data }) => setPlano(data.contas))
      .catch((err) => setErro(mensagemDe(err, "Falha ao carregar o plano de contas")));
    axios
      .get<{ contas: { codemp: number; ctared: number }[] }>("/api/custo-hora/contas-folha/usadas")
      .then(({ data }) => setUsadas(new Set(data.contas.map(chaveDaConta))))
      .catch((err) => setErro(mensagemDe(err, "Falha ao carregar as contas usadas na folha")));
  }, [setErro]);
  const recorte = useMemo(() => ({ rotulo: "Só contas usadas na folha", contas: usadas }), [usadas]);

  const carregarMovimento = useCallback(() => {
    setLoading(true);
    return axios
      .get<Movimento>("/api/custo-hora/contas-folha/movimento", { params: { competencia } })
      .then(({ data }) => setMovimento(data))
      .catch((err) => setErro(mensagemDe(err, "Falha ao carregar o movimento da folha")))
      .finally(() => setLoading(false));
  }, [competencia, setErro]);

  useEffect(() => {
    void carregarMovimento();
  }, [carregarMovimento, config.contasFolha]);

  const mudou = JSON.stringify([...regras].sort((a, b) => a.ctared - b.ctared)) !== JSON.stringify([...salvas].sort((a, b) => a.ctared - b.ctared));

  async function salvar() {
    setSalvando(true);
    try {
      await axios.put("/api/custo-hora/contas-folha", { regras });
      setAviso(`${regras.length} regra(s) de conta salva(s).`);
      await recarregar();
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao salvar as contas"));
    } finally {
      setSalvando(false);
    }
  }

  const linhas = movimento?.contas ?? [];
  const acoesMovimento: AcoesMovimento = {
    regraDe: new Map(regras.map((r) => [r.ctared, r.acao])),
    alternar: (c, acao) => setRegras((atual) => alternarRegra(atual, { codemp: c.codemp, ctared: c.ctared }, acao)),
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-surface p-4">
        <SeletorContas plano={plano} regras={regras} onChange={setRegras} rotuloBusca="Contas do plano (qualquer nível)" semAjuda recorte={recorte} />
        <div className="mt-3 flex items-center justify-end gap-3">
          {mudou && <span className="text-[12px] text-warning">Regras alteradas e ainda não salvas.</span>}
          <button type="button" className={BOTAO} disabled={!mudou || salvando} onClick={() => setRegras(salvas)}>
            Desfazer
          </button>
          <button type="button" className={BOTAO_PRIMARIO} disabled={!mudou || salvando} onClick={() => void salvar()}>
            {salvando ? "Salvando..." : "Salvar regras"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
        <label>
          Movimento de
          <input type="month" className={cn(CAMPO, "ml-2")} value={competencia} onChange={(e) => e.target.value && setCompetencia(e.target.value)} />
        </label>
        {movimento && movimento.competencia && (
          <>
            <span>
              Débito contabilizado: <b className="text-foreground">{formatarReais(movimento.totais.debito)}</b>
            </span>
            <span>
              Débito nas contas que entram no custo: <b className="text-foreground">{formatarReais(movimento.totais.debitoSelecionado)}</b>
            </span>
          </>
        )}
      </div>

      <TabelaLocal<MovimentoConta, AcoesMovimento>
        chave="admin.custo-hora.contas-folha"
        defs={COLUNAS_MOVIMENTO}
        ctx={acoesMovimento}
        colunas={COLUNAS_MOVIMENTO_LOCAIS}
        linhas={linhas}
        ler={lerMovimento}
        chaveLinha={(c) => `${c.codemp}-${c.ctared}`}
        loading={loading}
        vazio="A folha não contabilizou nada neste mês."
        paginacao={{ ...POR_PAGINA, rotulo: "contas" }}
      />
    </div>
  );
}

// ---------- Parâmetros ----------

function AbaParametros({ config, recarregar, setErro, setAviso }: { config: Config; recarregar: () => Promise<void>; setErro: (e: string | null) => void; setAviso: (a: string | null) => void }) {
  const [valores, setValores] = useState<Record<string, string>>(config.parametros);
  useEffect(() => setValores(config.parametros), [config.parametros]);

  async function salvar(chave: string) {
    const texto = (valores[chave] ?? "").trim();
    try {
      await axios.put(`/api/custo-hora/parametros/${chave}`, { valor: texto === "" ? null : texto });
      setAviso(texto === "" ? "Parâmetro removido." : "Parâmetro salvo.");
      await recarregar();
    } catch (err) {
      setErro(mensagemDe(err, "Falha ao salvar o parâmetro"));
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      {Object.entries(config.definicoesParametros).map(([chave, descricao]) => (
        <div key={chave} className="rounded-lg border border-border bg-surface p-4">
          <label className="block text-sm font-medium text-foreground" htmlFor={`param-${chave}`}>
            {descricao}
          </label>
          <div className="flex gap-2">
            <input id={`param-${chave}`} className={cn(CAMPO, "w-48 font-mono")} value={valores[chave] ?? ""} onChange={(e) => setValores({ ...valores, [chave]: e.target.value })} />
            <button type="button" className={BOTAO} onClick={() => void salvar(chave)}>
              Salvar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
