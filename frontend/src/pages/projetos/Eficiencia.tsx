import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { TabDef, Tabs } from "../../components/ui/Tabs";
import { AbaAcoes, filtroAcoesValido } from "../../components/eficiencia/AbaAcoes";
import { AbaClientes } from "../../components/eficiencia/AbaClientes";
import { AbaEquipe } from "../../components/eficiencia/AbaEquipe";
import { AbaFinanceiro } from "../../components/eficiencia/AbaFinanceiro";
import { AbaPropostas, FiltroCarteira, filtroValido } from "../../components/eficiencia/AbaPropostas";
import { AbaQualidade } from "../../components/eficiencia/AbaQualidade";
import { ComoCalculamos } from "../../components/eficiencia/ComoCalculamos";
import { AlertaIgnorados } from "../../components/eficiencia/FaixaIgnoradas";
import { GavetaConsultor, GavetaProposta } from "../../components/eficiencia/Gavetas";
import { ModalAcao } from "../../components/eficiencia/ModalAcao";
import { AcoesPainel, VisaoGeral } from "../../components/eficiencia/VisaoGeral";
import { AcaoDto, FiltrosEficiencia, FiltrosOpcoes, FiltroAcoes, hh, ModoEstouro, PainelEficiencia, ResponsavelOpcao, SugestaoAcao } from "../../lib/eficiencia";

const ABAS: TabDef[] = [
  { key: "visao", label: "Visão geral" },
  { key: "propostas", label: "Propostas" },
  { key: "equipe", label: "Equipe e carga" },
  { key: "clientes", label: "Clientes" },
  { key: "financeiro", label: "Financeiro" },
  { key: "acoes", label: "Plano de ação" },
  { key: "qualidade", label: "Qualidade dos dados" },
  { key: "regras", label: "Como calculamos" },
];

type Gaveta = { tipo: "proposta"; codemp: number; codpro: number } | { tipo: "consultor"; codfor: number } | null;

// "AAAA-MM-DD" de hoje em São Paulo — o mesmo "hoje" do servidor, pra o prazo mínimo do formulário não divergir dele.
const hojeSp = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function lerIgnoradas(chave: string): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(chave) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^\d+:\d+$/.test(x)) : []);
  } catch {
    return new Set();
  }
}

// Itens ("codemp:codpro:seqite") e consultores numa proposta ("codemp:codpro:codfor") que a pessoa ignorou na gaveta da proposta.
function lerTriplas(chave: string): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(chave) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^\d+:\d+:\d+$/.test(x)) : []);
  } catch {
    return new Set();
  }
}

function lerConsultoresIgnorados(chave: string): Set<number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(chave) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x > 0) : []);
  } catch {
    return new Set();
  }
}

const CHAVE_MODO_ESTOURO = "eficiencia-modo-estouro";

// Como ler o estouro é escolha de cada pessoa (como a capacidade): fica no navegador, com o storage protegido (janela privada).
function lerModoEstouro(): ModoEstouro {
  try {
    return localStorage.getItem(CHAVE_MODO_ESTOURO) === "proposta" ? "proposta" : "item";
  } catch {
    return "item";
  }
}

const CHAVE_CAPACIDADE = "eficiencia-capacidade";
const CAPACIDADE_PADRAO = 120;

// A capacidade é conveniência de cada pessoa (não é dado compartilhado): fica no navegador. O
// storage pode estar bloqueado (janela privada), então toda leitura/escrita é protegida.
function lerCapacidade(): number {
  try {
    const n = Number(localStorage.getItem(CHAVE_CAPACIDADE));
    return Number.isFinite(n) && n >= 20 && n <= 220 ? n : CAPACIDADE_PADRAO;
  } catch {
    return CAPACIDADE_PADRAO;
  }
}

const selectClass =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Eficiencia() {
  const [params, setParams] = useSearchParams();
  const { mostrar } = useToast();
  const aba = ABAS.some((a) => a.key === params.get("aba")) ? (params.get("aba") as string) : "visao";
  const mudarAba = useCallback(
    (key: string) => {
      setParams((p) => {
        const novo = new URLSearchParams(p);
        if (key === "visao") novo.delete("aba");
        else novo.set("aba", key);
        return novo;
      });
      window.scrollTo({ top: 0 });
    },
    [setParams]
  );

  const [filtros, setFiltros] = useState<FiltrosEficiencia>({ tipo: "cli", sitpro: [], modpro: [], codcli: [], codpro: [], depexe: [] });
  const [modoEstouro, setModoEstouro] = useState<ModoEstouro>(lerModoEstouro);
  const escolherModoEstouro = useCallback((modo: ModoEstouro) => {
    setModoEstouro(modo);
    try {
      localStorage.setItem(CHAVE_MODO_ESTOURO, modo);
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  }, []);
  // Propostas que a pessoa marcou pra FORA dos cálculos ("codemp:codpro"). Escolha pessoal: fica no navegador dela (por usuário), nada
  // é gravado no servidor. O storage pode estar bloqueado (janela privada): leitura e escrita protegidas.
  const { user } = useAuth();
  const chaveIgnoradas = `eficiencia-propostas-ignoradas-${user?.id ?? "anon"}`;
  const [ignoradas, setIgnoradas] = useState<Set<string>>(() => lerIgnoradas(chaveIgnoradas));
  const ignoradasParam = useMemo(() => [...ignoradas].sort().slice(0, 300).join(","), [ignoradas]);
  useEffect(() => {
    try {
      localStorage.setItem(chaveIgnoradas, JSON.stringify([...ignoradas]));
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  }, [chaveIgnoradas, ignoradas]);
  const alternarIgnorada = useCallback((codemp: number, codpro: number) => {
    setIgnoradas((atual) => {
      const novo = new Set(atual);
      const k = `${codemp}:${codpro}`;
      if (!novo.delete(k)) novo.add(k);
      return novo;
    });
  }, []);
  // Consultores marcados pra FORA dos indicadores da equipe (codfor). Mesma regra das propostas: escolha pessoal, só no navegador.
  const chaveConsultoresIgnorados = `eficiencia-consultores-ignorados-${user?.id ?? "anon"}`;
  const [consultoresIgnorados, setConsultoresIgnorados] = useState<Set<number>>(() => lerConsultoresIgnorados(chaveConsultoresIgnorados));
  const consultoresIgnoradosParam = useMemo(() => [...consultoresIgnorados].sort((a, b) => a - b).slice(0, 300).join(","), [consultoresIgnorados]);
  useEffect(() => {
    try {
      localStorage.setItem(chaveConsultoresIgnorados, JSON.stringify([...consultoresIgnorados]));
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  }, [chaveConsultoresIgnorados, consultoresIgnorados]);
  const alternarConsultorIgnorado = useCallback((codfor: number) => {
    setConsultoresIgnorados((atual) => {
      const novo = new Set(atual);
      if (!novo.delete(codfor)) novo.add(codfor);
      return novo;
    });
  }, []);
  // Dentro de uma proposta: itens e consultores que a pessoa tirou do cálculo na gaveta. Mesma regra: escolha pessoal, só no navegador.
  const chaveItensIgnorados = `eficiencia-itens-ignorados-${user?.id ?? "anon"}`;
  const chaveConsultoresNaProposta = `eficiencia-consultores-na-proposta-ignorados-${user?.id ?? "anon"}`;
  const [itensIgnorados, setItensIgnorados] = useState<Set<string>>(() => lerTriplas(chaveItensIgnorados));
  const [consultoresNaProposta, setConsultoresNaProposta] = useState<Set<string>>(() => lerTriplas(chaveConsultoresNaProposta));
  const itensIgnoradosParam = useMemo(() => [...itensIgnorados].sort().slice(0, 300).join(","), [itensIgnorados]);
  const consultoresNaPropostaParam = useMemo(() => [...consultoresNaProposta].sort().slice(0, 300).join(","), [consultoresNaProposta]);
  useEffect(() => {
    try {
      localStorage.setItem(chaveItensIgnorados, JSON.stringify([...itensIgnorados]));
      localStorage.setItem(chaveConsultoresNaProposta, JSON.stringify([...consultoresNaProposta]));
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  }, [chaveItensIgnorados, chaveConsultoresNaProposta, itensIgnorados, consultoresNaProposta]);
  const alternarTripla = useCallback((set: (f: (a: Set<string>) => Set<string>) => void, chave: string) => {
    set((atual) => {
      const novo = new Set(atual);
      if (!novo.delete(chave)) novo.add(chave);
      return novo;
    });
  }, []);
  const alternarItemIgnorado = useCallback((codemp: number, codpro: number, seqite: number) => alternarTripla(setItensIgnorados, `${codemp}:${codpro}:${seqite}`), [alternarTripla]);
  const alternarConsultorNaProposta = useCallback((codemp: number, codpro: number, codfor: number) => alternarTripla(setConsultoresNaProposta, `${codemp}:${codpro}:${codfor}`), [alternarTripla]);
  const [capacidade, setCapacidade] = useState<number>(lerCapacidade);
  const [capRascunho, setCapRascunho] = useState<string>(String(lerCapacidade()));
  const [parametrosAbertos, setParametrosAbertos] = useState(false);
  const [opcoes, setOpcoes] = useState<FiltrosOpcoes | null>(null);

  // Propostas oferecidas no filtro: só as dos clientes já escolhidos e do tipo (De clientes / Internas) já escolhido.
  const opcoesProposta = useMemo(
    () =>
      (opcoes?.propostas ?? [])
        .filter((p) => (filtros.codcli.length === 0 || filtros.codcli.includes(p.codcli)) && (filtros.tipo === "all" || (filtros.tipo === "int") === p.interna))
        .map((p) => ({ value: p.valor, label: p.rotulo })),
    [opcoes, filtros.codcli, filtros.tipo]
  );
  // Trocar cliente ou tipo pode deixar uma proposta escolhida de fora (e a lista ficaria vazia sem explicação): ela sai do filtro.
  useEffect(() => {
    if (!opcoes || filtros.codpro.length === 0) return;
    const validas = new Set(opcoesProposta.map((o) => o.value));
    const manter = filtros.codpro.filter((c) => validas.has(c));
    if (manter.length !== filtros.codpro.length) setFiltros((f) => ({ ...f, codpro: manter }));
  }, [opcoes, opcoesProposta, filtros.codpro]);

  const [painel, setPainel] = useState<PainelEficiencia | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);

  const [filtroCarteira, setFiltroCarteira] = useState<FiltroCarteira>("all");
  const [buscaPropostas, setBuscaPropostas] = useState("");
  const [gaveta, setGaveta] = useState<Gaveta>(null);
  // Plano de ação: filtro da aba (pode vir da URL, pelo sino), formulário e quem pode ser responsável.
  const [filtroAcoes, setFiltroAcoes] = useState<FiltroAcoes>(() => filtroAcoesValido(params.get("filtro")));
  const [versaoAcoes, setVersaoAcoes] = useState(0);
  const [modalAcao, setModalAcao] = useState<{ sugestao: SugestaoAcao | null; editando: AcaoDto | null } | null>(null);
  const [responsaveis, setResponsaveis] = useState<ResponsavelOpcao[]>([]);
  const [recarga, setRecarga] = useState(0);
  const parametrosRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    axios
      .get<FiltrosOpcoes>("/api/eficiencia/filtros")
      .then(({ data }) => setOpcoes(data))
      .catch((e) => axios.isAxiosError(e) && e.response?.status === 403 && setSemAcesso(true));
  }, []);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    axios
      .get<PainelEficiencia>("/api/eficiencia/painel", {
        params: {
          tipo: filtros.tipo,
          sitpro: filtros.sitpro.join(",") || undefined,
          modpro: filtros.modpro.join(",") || undefined,
          codcli: filtros.codcli.join(",") || undefined,
          codpro: filtros.codpro.join(",") || undefined,
          estouro: modoEstouro === "proposta" ? "proposta" : undefined,
          depexe: filtros.depexe.join(",") || undefined,
          cap: capacidade,
          ignorar: ignoradasParam || undefined,
          ignorarConsultor: consultoresIgnoradosParam || undefined,
          ignorarItem: itensIgnoradosParam || undefined,
          ignorarConsultorProposta: consultoresNaPropostaParam || undefined,
        },
      })
      .then(({ data }) => !cancelado && setPainel(data))
      .catch((e) => {
        if (cancelado) return;
        if (axios.isAxiosError(e) && e.response?.status === 403) setSemAcesso(true);
        else setErro(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível carregar o painel." : "Não foi possível carregar o painel.");
      })
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [filtros, modoEstouro, capacidade, ignoradasParam, consultoresIgnoradosParam, itensIgnoradosParam, consultoresNaPropostaParam, recarga]);

  useEffect(() => {
    if (!parametrosAbertos) return;
    const fora = (e: MouseEvent) => parametrosRef.current && !parametrosRef.current.contains(e.target as Node) && setParametrosAbertos(false);
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [parametrosAbertos]);

  useEffect(() => {
    if (!modalAcao || responsaveis.length > 0) return;
    axios
      .get<{ responsaveis: ResponsavelOpcao[] }>("/api/eficiencia/acoes/responsaveis")
      .then(({ data }) => setResponsaveis(data.responsaveis))
      .catch(() => mostrar("Não foi possível carregar a lista de responsáveis.", "destructive"));
  }, [modalAcao, responsaveis.length, mostrar]);

  function aplicarCapacidade() {
    const n = Math.min(220, Math.max(20, Math.round(Number(capRascunho) || CAPACIDADE_PADRAO)));
    setCapRascunho(String(n));
    setCapacidade(n);
    try {
      localStorage.setItem(CHAVE_CAPACIDADE, String(n));
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  }

  const acoes: AcoesPainel = useMemo(
    () => ({
      irPara: (destino, filtro) => {
        if (destino === "propostas") {
          setFiltroCarteira(filtroValido(filtro));
          setBuscaPropostas("");
        }
        if (destino === "acoes") setFiltroAcoes(filtroAcoesValido(filtro));
        mudarAba(destino);
      },
      abrirProposta: (codemp, codpro) => setGaveta({ tipo: "proposta", codemp, codpro }),
      abrirConsultor: (codfor) => setGaveta({ tipo: "consultor", codfor }),
      criarAcao: (sugestao) => setModalAcao({ sugestao, editando: null }),
    }),
    [mudarAba]
  );

  const fecharGaveta = useCallback(() => setGaveta(null), []);
  // Abre a gaveta da primeira proposta que tem algo ignorado ("codemp:codpro:x"), pra pessoa chegar onde desmarca.
  const abrirPrimeira = (marcados: Set<string>) => {
    const [codemp, codpro] = ([...marcados].sort()[0] ?? "").split(":").map(Number);
    if (codemp && codpro) setGaveta({ tipo: "proposta", codemp, codpro });
  };
  // Um apontamento saiu/voltou do cálculo (na gaveta ou na aba Qualidade): recarrega o painel por trás.
  const recalcular = useCallback(() => setRecarga((n) => n + 1), []);
  const restaurarApontamento = useCallback(
    async (ratItemId: number) => {
      try {
        await axios.post(`/api/eficiencia/apontamentos/${ratItemId}/restaurar`);
        mostrar("Apontamento de volta ao cálculo.", "success");
        setRecarga((n) => n + 1);
      } catch (e) {
        mostrar(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível restaurar o apontamento." : "Não foi possível restaurar o apontamento.", "destructive");
      }
    },
    [mostrar]
  );

  if (semAcesso) {
    return (
      <div>
        <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Eficiência</p>
        <p className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
          Esta área é só para quem gerencia algum departamento. Fale com um administrador se você acha que deveria ter acesso.
        </p>
      </div>
    );
  }

  // "Plano de ação (3)": quantas ações em aberto o usuário tem, sem precisar abrir a aba.
  const abas = ABAS.map((a) => (a.key === "acoes" && painel?.acoes.abertas ? { ...a, label: `Plano de ação (${painel.acoes.abertas})` } : a));
  // Departamentos escolhidos no filtro: a Equipe mostra só o time deles (e o texto da aba diz isso).
  const rotulosDosDepartamentos = filtros.depexe
    .map((id) => opcoes?.departamentos.find((d) => d.valor === id)?.rotulo)
    .filter(Boolean)
    .join(", ");
  const escopo = painel?.meta.escopo === "gestor" ? painel.meta.departamentosGerenciados?.map((d) => d.rotulo).join(", ") : null;
  const geradoEm = painel ? new Date(painel.meta.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Eficiência</p>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-foreground">Eficiência de propostas e equipe</h1>
            {painel && painel.exclusoes.total > 0 && (
              <button
                type="button"
                onClick={() => mudarAba("qualidade")}
                title={`${painel.exclusoes.total} ${painel.exclusoes.total === 1 ? "apontamento" : "apontamentos"} (${hh(painel.exclusoes.minutos)}) fora do cálculo por decisão de um gestor. Só vale neste painel: RAT, teto da Alocação e Senior seguem iguais. Clique para ver a lista.`}
                aria-label={`${painel.exclusoes.total} apontamentos fora do cálculo. Abrir a lista na aba Qualidade dos dados`}
                className="inline-flex size-6 items-center justify-center rounded-full text-warning transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="10" cy="10" r="8" />
                  <path d="M10 9v4.5M10 6.2v.1" strokeLinecap="round" />
                </svg>
              </button>
            )}
            {ignoradas.size > 0 && <AlertaIgnorados total={ignoradas.size} onVer={() => mudarAba("propostas")} onRestaurar={() => setIgnoradas(new Set())} />}
            {/* Itens e consultores ignorados DENTRO de propostas: só os que existem no recorte atual entram na conta. O botão abre a primeira proposta marcada. */}
            {painel && painel.meta.ignoradosNaProposta.itens > 0 && (
              <AlertaIgnorados
                tipo="item"
                verRotulo="Abrir a proposta"
                total={painel.meta.ignoradosNaProposta.itens}
                onVer={() => abrirPrimeira(itensIgnorados)}
                onRestaurar={() => setItensIgnorados(new Set())}
              />
            )}
            {painel && painel.meta.ignoradosNaProposta.consultores > 0 && (
              <AlertaIgnorados
                tipo="consultorProposta"
                verRotulo="Abrir a proposta"
                total={painel.meta.ignoradosNaProposta.consultores}
                onVer={() => abrirPrimeira(consultoresNaProposta)}
                onRestaurar={() => setConsultoresNaProposta(new Set())}
              />
            )}
            {/* Conta os que realmente aparecem na lista (um codfor guardado de outro recorte não conta). */}
            {painel && painel.equipe.consultores.some((c) => c.ignorado) && (
              <AlertaIgnorados
                tipo="consultor"
                total={painel.equipe.consultores.filter((c) => c.ignorado).length}
                onVer={() => mudarAba("equipe")}
                onRestaurar={() => setConsultoresIgnorados(new Set())}
              />
            )}
          </div>
          {/* Como ler o estouro: item a item (um item acima do vendido já conta) ou pelo total da proposta (o saldo de um item compensa outro). */}
          <div role="group" aria-label="Como ler o estouro" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
            Estouro
            <span className="inline-flex overflow-hidden rounded-md border border-border">
              {(
                [
                  ["item", "Por item", "Cada item acima do vendido já conta como estouro, mesmo que outro item da proposta tenha saldo"],
                  ["proposta", "Pela proposta", "Só conta o que passa do total vendido da proposta: o saldo de um item compensa o estouro de outro"],
                ] as const
              ).map(([modo, rotulo, dica]) => (
                <button
                  key={modo}
                  type="button"
                  aria-pressed={modoEstouro === modo}
                  title={dica}
                  onClick={() => escolherModoEstouro(modo)}
                  className={`px-2.5 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    modoEstouro === modo ? "bg-primary text-primary-foreground" : "bg-surface text-foreground hover:bg-surface-2"
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </span>
            {escopo && <span>Escopo: propostas de {escopo} e o seu time.</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {geradoEm && <span className="hidden text-[12px] text-muted sm:inline">Atualizado às {geradoEm}</span>}
          <Link
            to="/projetos/eficiencia/plano-evolucao"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Plano de evolução
          </Link>
          <button
            type="button"
            onClick={() => setRecarga((n) => n + 1)}
            disabled={carregando}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {carregando ? "Atualizando…" : "Atualizar"}
          </button>
          <div className="relative" ref={parametrosRef}>
            <button
              type="button"
              aria-expanded={parametrosAbertos}
              onClick={() => setParametrosAbertos((v) => !v)}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Parâmetros
            </button>
            {parametrosAbertos && (
              <div className="absolute right-0 top-full z-popover mt-2 w-72 rounded-lg border border-border bg-surface p-4 shadow-xl">
                <label htmlFor="cap-eficiencia" className="mb-1 block text-[13px] font-medium text-foreground">
                  Capacidade em projeto (h/mês por consultor)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="cap-eficiencia"
                    type="number"
                    min={20}
                    max={220}
                    step={4}
                    value={capRascunho}
                    onChange={(e) => setCapRascunho(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && aplicarCapacidade()}
                    className={`${selectClass} w-24 font-mono`}
                  />
                  <button
                    type="button"
                    onClick={aplicarCapacidade}
                    className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Aplicar
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-muted">Define os meses de carteira e os alertas de sobrecarga. Fica salvo neste navegador (padrão {CAPACIDADE_PADRAO} h).</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Propostas
          <select
            value={filtros.tipo}
            onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.target.value as FiltrosEficiencia["tipo"] }))}
            className={selectClass}
          >
            <option value="cli">De clientes</option>
            <option value="int">Internas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        {opcoes && (
          <>
            <MultiSelectDropdown
              opcoes={opcoes.situacoes.map((s) => ({ value: s.valor, label: s.rotulo }))}
              selecionados={filtros.sitpro}
              onChange={(sitpro) => setFiltros((f) => ({ ...f, sitpro }))}
              labelTodos="Todas as situações"
              labelSufixo="situações"
            />
            <MultiSelectDropdown
              opcoes={opcoes.modalidades.map((s) => ({ value: s.valor, label: s.rotulo }))}
              selecionados={filtros.modpro}
              onChange={(modpro) => setFiltros((f) => ({ ...f, modpro }))}
              labelTodos="Todas as modalidades"
              labelSufixo="modalidades"
            />
            {opcoes.clientes.length > 1 && (
              <MultiSelectDropdown
                opcoes={opcoes.clientes.map((c) => ({ value: c.valor, label: c.rotulo }))}
                selecionados={filtros.codcli}
                onChange={(codcli) => setFiltros((f) => ({ ...f, codcli }))}
                labelTodos="Todos os clientes"
                labelSufixo="clientes"
              />
            )}
            {opcoesProposta.length > 1 && (
              <MultiSelectDropdown
                opcoes={opcoesProposta}
                selecionados={filtros.codpro}
                onChange={(codpro) => setFiltros((f) => ({ ...f, codpro }))}
                labelTodos="Todas as propostas"
                labelSufixo="propostas"
              />
            )}
            {opcoes.departamentos.length > 1 && (
              <MultiSelectDropdown
                opcoes={opcoes.departamentos.map((d) => ({ value: d.valor, label: d.rotulo }))}
                selecionados={filtros.depexe}
                onChange={(depexe) => setFiltros((f) => ({ ...f, depexe }))}
                labelTodos="Todos os departamentos"
                labelSufixo="departamentos"
              />
            )}
          </>
        )}
      </div>

      <Tabs tabs={abas} activeKey={aba} onChange={mudarAba} />

      {erro && (
        <p className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
          <button type="button" onClick={() => setRecarga((n) => n + 1)} className="font-medium underline">
            Tentar de novo
          </button>
        </p>
      )}

      {!painel && carregando && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-56 w-full" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      )}

      {painel && (
        <div className={carregando ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"} aria-busy={carregando}>
          {aba === "visao" && <VisaoGeral painel={painel} acoes={acoes} />}
          {aba === "propostas" && (
            <AbaPropostas
              painel={painel}
              filtro={filtroCarteira}
              onFiltro={setFiltroCarteira}
              busca={buscaPropostas}
              onBusca={setBuscaPropostas}
              ignoradas={ignoradas}
              onAlternarIgnorada={alternarIgnorada}
              abrirProposta={acoes.abrirProposta}
            />
          )}
          {aba === "equipe" && (
            <AbaEquipe
              painel={painel}
              abrirConsultor={acoes.abrirConsultor}
              abrirProposta={acoes.abrirProposta}
              recorteDepartamentos={rotulosDosDepartamentos}
              onAlternarIgnorado={alternarConsultorIgnorado}
            />
          )}
          {aba === "clientes" && (
            <AbaClientes
              painel={painel}
              verPropostasDoCliente={(cliente) => {
                setFiltroCarteira("all");
                setBuscaPropostas(cliente);
                mudarAba("propostas");
              }}
            />
          )}
          {aba === "financeiro" && (
            <AbaFinanceiro
              painel={painel}
              abrirProposta={acoes.abrirProposta}
              filtrarCliente={(codcli) => setFiltros((f) => ({ ...f, codcli: [codcli], codpro: [] }))}
            />
          )}
          {aba === "acoes" && (
            <AbaAcoes
              filtro={filtroAcoes}
              onFiltro={setFiltroAcoes}
              versao={versaoAcoes}
              onNova={() => setModalAcao({ sugestao: { origemAlerta: "Criada no Plano de ação" }, editando: null })}
              onEditar={(acao) => setModalAcao({ sugestao: null, editando: acao })}
              onMudou={recalcular}
              abrirProposta={acoes.abrirProposta}
              abrirConsultor={acoes.abrirConsultor}
            />
          )}
          {aba === "qualidade" && <AbaQualidade painel={painel} abrirProposta={acoes.abrirProposta} abrirConsultor={acoes.abrirConsultor} restaurarApontamento={restaurarApontamento} />}
          {aba === "regras" && <ComoCalculamos limiares={painel.meta.limiares} capacidade={painel.meta.capacidadeHorasMes} />}
        </div>
      )}

      {gaveta?.tipo === "proposta" && painel && (
        <GavetaProposta
          codemp={gaveta.codemp}
          codpro={gaveta.codpro}
          limiares={painel.meta.limiares}
          motivosExclusao={painel.motivosExclusao}
          onMudouCalculo={recalcular}
          onCriarAcao={acoes.criarAcao}
          modoEstouro={modoEstouro}
          itensIgnorados={itensIgnorados}
          consultoresIgnorados={consultoresNaProposta}
          onAlternarItem={alternarItemIgnorado}
          onAlternarConsultor={alternarConsultorNaProposta}
          onFechar={fecharGaveta}
        />
      )}
      <ModalAcao
        aberto={modalAcao != null}
        sugestao={modalAcao?.sugestao ?? null}
        editando={modalAcao?.editando ?? null}
        responsaveis={responsaveis}
        hoje={hojeSp()}
        onSalvo={() => {
          setModalAcao(null);
          setVersaoAcoes((v) => v + 1);
          recalcular();
        }}
        onFechar={() => setModalAcao(null)}
      />

      {gaveta?.tipo === "consultor" && painel && (
        <GavetaConsultor
          codfor={gaveta.codfor}
          capacidadeHorasMes={painel.meta.capacidadeHorasMes}
          limiares={painel.meta.limiares}
          onAbrirProposta={acoes.abrirProposta}
          onCriarAcao={acoes.criarAcao}
          onFechar={fecharGaveta}
        />
      )}
    </div>
  );
}
