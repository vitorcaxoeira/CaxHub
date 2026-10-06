import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { Skeleton } from "../../components/ui/Skeleton";
import { TabDef, Tabs } from "../../components/ui/Tabs";
import { AbaClientes } from "../../components/eficiencia/AbaClientes";
import { AbaEquipe } from "../../components/eficiencia/AbaEquipe";
import { AbaPropostas, FiltroCarteira, filtroValido } from "../../components/eficiencia/AbaPropostas";
import { AbaQualidade } from "../../components/eficiencia/AbaQualidade";
import { ComoCalculamos } from "../../components/eficiencia/ComoCalculamos";
import { GavetaConsultor, GavetaProposta } from "../../components/eficiencia/Gavetas";
import { AcoesPainel, VisaoGeral } from "../../components/eficiencia/VisaoGeral";
import { FiltrosEficiencia, FiltrosOpcoes, PainelEficiencia } from "../../lib/eficiencia";

const ABAS: TabDef[] = [
  { key: "visao", label: "Visão geral" },
  { key: "propostas", label: "Propostas" },
  { key: "equipe", label: "Equipe e carga" },
  { key: "clientes", label: "Clientes" },
  { key: "qualidade", label: "Qualidade dos dados" },
  { key: "regras", label: "Como calculamos" },
];

type Gaveta = { tipo: "proposta"; codemp: number; codpro: number } | { tipo: "consultor"; codfor: number } | null;

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

  const [filtros, setFiltros] = useState<FiltrosEficiencia>({ tipo: "cli", sitpro: [], modpro: [], depexe: [] });
  const [capacidade, setCapacidade] = useState<number>(lerCapacidade);
  const [capRascunho, setCapRascunho] = useState<string>(String(lerCapacidade()));
  const [parametrosAbertos, setParametrosAbertos] = useState(false);
  const [opcoes, setOpcoes] = useState<FiltrosOpcoes | null>(null);

  const [painel, setPainel] = useState<PainelEficiencia | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);

  const [filtroCarteira, setFiltroCarteira] = useState<FiltroCarteira>("all");
  const [buscaPropostas, setBuscaPropostas] = useState("");
  const [gaveta, setGaveta] = useState<Gaveta>(null);
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
          depexe: filtros.depexe.join(",") || undefined,
          cap: capacidade,
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
  }, [filtros, capacidade, recarga]);

  useEffect(() => {
    if (!parametrosAbertos) return;
    const fora = (e: MouseEvent) => parametrosRef.current && !parametrosRef.current.contains(e.target as Node) && setParametrosAbertos(false);
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [parametrosAbertos]);

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
        mudarAba(destino);
      },
      abrirProposta: (codemp, codpro) => setGaveta({ tipo: "proposta", codemp, codpro }),
      abrirConsultor: (codfor) => setGaveta({ tipo: "consultor", codfor }),
    }),
    [mudarAba]
  );

  const fecharGaveta = useCallback(() => setGaveta(null), []);

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

  const escopo = painel?.meta.escopo === "gestor" ? painel.meta.departamentosGerenciados?.map((d) => d.rotulo).join(", ") : null;
  const geradoEm = painel ? new Date(painel.meta.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Eficiência</p>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Eficiência de propostas e equipe</h1>
          <p className="mt-1 text-sm text-muted">
            Vendido x executado x alocado, por proposta, consultor e cliente.
            {escopo ? ` Escopo: propostas de ${escopo} e o seu time.` : painel ? " Escopo: todas as propostas ativas." : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {geradoEm && <span className="hidden text-[12px] text-muted sm:inline">Atualizado às {geradoEm}</span>}
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

      <Tabs tabs={ABAS} activeKey={aba} onChange={mudarAba} />

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
              abrirProposta={acoes.abrirProposta}
            />
          )}
          {aba === "equipe" && <AbaEquipe painel={painel} abrirConsultor={acoes.abrirConsultor} abrirProposta={acoes.abrirProposta} />}
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
          {aba === "qualidade" && <AbaQualidade painel={painel} abrirProposta={acoes.abrirProposta} abrirConsultor={acoes.abrirConsultor} />}
          {aba === "regras" && <ComoCalculamos limiares={painel.meta.limiares} capacidade={painel.meta.capacidadeHorasMes} />}
        </div>
      )}

      {gaveta?.tipo === "proposta" && painel && (
        <GavetaProposta codemp={gaveta.codemp} codpro={gaveta.codpro} limiares={painel.meta.limiares} onFechar={fecharGaveta} />
      )}
      {gaveta?.tipo === "consultor" && painel && (
        <GavetaConsultor
          codfor={gaveta.codfor}
          capacidadeHorasMes={painel.meta.capacidadeHorasMes}
          limiares={painel.meta.limiares}
          onAbrirProposta={acoes.abrirProposta}
          onFechar={fecharGaveta}
        />
      )}
    </div>
  );
}
