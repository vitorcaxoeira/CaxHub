import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Avatar } from "../../components/ui/Avatar";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import {
  CONFIG_EVENTO_AUDITORIA,
  GrupoAuditoria,
  ToneAuditoria,
  configEvento,
  resumoGrupo,
  toneBadgeAuditoria,
  toneGrupo,
} from "../../components/auditoria/auditoriaVisual";
import { DrawerAuditoria } from "../../components/auditoria/DrawerAuditoria";

interface PropostaOpcao {
  codemp: number;
  codpro: number;
  cliente: string;
}

const ORIGENS_OPCOES: MultiSelectOption<string>[] = [
  { value: "tela", label: "Tela" },
  { value: "api", label: "API" },
  { value: "job", label: "Job automático" },
  { value: "integracao_senior", label: "Integração Senior" },
];

// Deriva os "grupos" de evento (ex.: "Kanban", "Alocação") a partir do mapa único de
// configuração visual — cada chip de filtro representa 1+ eventoTipo reais.
const GRUPOS_EVENTO: Record<string, string[]> = Object.entries(CONFIG_EVENTO_AUDITORIA).reduce(
  (acc, [eventoTipo, config]) => {
    (acc[config.rotuloGrupo] ??= []).push(eventoTipo);
    return acc;
  },
  {} as Record<string, string[]>
);
const GRUPOS_OPCOES: MultiSelectOption<string>[] = Object.keys(GRUPOS_EVENTO).map((g) => ({ value: g, label: g }));

const dayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
const hourFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

function chaveDia(iso: string): string {
  return iso.slice(0, 10); // ISO já vem em UTC; agrupamento por dia "de calendário" é suficiente pra uma trilha de auditoria
}

function seteDiasAtras(): string {
  const data = new Date();
  data.setDate(data.getDate() - 7);
  return data.toISOString();
}

export function Auditoria() {
  const [searchParams, setSearchParams] = useSearchParams();

  const codempParam = searchParams.get("codemp");
  const codproParam = searchParams.get("codpro");
  const [propostaSelecionada, setPropostaSelecionada] = useState<PropostaOpcao | null>(
    codempParam && codproParam ? { codemp: Number(codempParam), codpro: Number(codproParam), cliente: "" } : null
  );
  const [de, setDe] = useState(searchParams.get("de") ?? "");
  const [ate, setAte] = useState(searchParams.get("ate") ?? "");
  const [grupos, setGrupos] = useState<string[]>(searchParams.get("grupos")?.split(",").filter(Boolean) ?? []);
  const [origens, setOrigens] = useState<string[]>(searchParams.get("origens")?.split(",").filter(Boolean) ?? []);

  // Sem proposta selecionada e sem período explícito na URL, restringe aos últimos 7
  // dias por padrão — evita puxar a trilha inteira do sistema de uma vez.
  const usandoPeriodoPadrao = !propostaSelecionada && !searchParams.get("de");
  const deEfetivo = usandoPeriodoPadrao ? seteDiasAtras() : de || null;
  const ateEfetivo = usandoPeriodoPadrao ? null : ate || null;

  const [buscaProposta, setBuscaProposta] = useState("");
  const [sugestoes, setSugestoes] = useState<PropostaOpcao[]>([]);
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);

  const [grupoAcoes, setGrupoAcoes] = useState<GrupoAuditoria[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMais, setLoadingMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [drawerGrupo, setDrawerGrupo] = useState<GrupoAuditoria | null>(null);

  function persistirFiltrosNaUrl() {
    const params = new URLSearchParams();
    if (propostaSelecionada) {
      params.set("codemp", String(propostaSelecionada.codemp));
      params.set("codpro", String(propostaSelecionada.codpro));
    }
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    if (grupos.length > 0) params.set("grupos", grupos.join(","));
    if (origens.length > 0) params.set("origens", origens.join(","));
    setSearchParams(params, { replace: true });
  }

  function eventoTipoParaFiltro(): string[] | undefined {
    if (grupos.length === 0) return undefined;
    return grupos.flatMap((g) => GRUPOS_EVENTO[g] ?? []);
  }

  // Filtros compartilhados entre a listagem (agrupada, paginada) e a exportação CSV
  // (plana, até o limite do backend) — mesma "visão" dos dados nos dois casos.
  function filtrosBase(): Record<string, string | number | boolean | undefined> {
    return {
      codemp: propostaSelecionada?.codemp,
      codpro: propostaSelecionada?.codpro,
      de: deEfetivo ?? undefined,
      ate: ateEfetivo ?? undefined,
      eventoTipo: eventoTipoParaFiltro()?.join(",") || undefined,
      origem: origens.length > 0 ? origens.join(",") : undefined,
    };
  }

  function carregar(cursor: string | null) {
    const params = { ...filtrosBase(), agrupar: true, limit: 30, cursor: cursor ?? undefined };

    if (cursor) setLoadingMais(true);
    else setLoading(true);

    axios
      .get("/api/auditoria", { params })
      .then(({ data }) => {
        setGrupoAcoes((atual) => (cursor ? [...atual, ...data.rows] : data.rows));
        setNextCursor(data.nextCursor);
        setErro(null);
        setSemAcesso(false);
      })
      .catch((err) => {
        if (err.response?.status === 403) setSemAcesso(true);
        else setErro(err.response?.data?.error ?? "Falha ao carregar a auditoria");
      })
      .finally(() => {
        setLoading(false);
        setLoadingMais(false);
      });
  }

  const [exportando, setExportando] = useState(false);
  function exportarCsv() {
    setExportando(true);
    axios
      .get("/api/auditoria/export", { params: filtrosBase(), responseType: "blob" })
      .then(({ data }) => {
        const url = window.URL.createObjectURL(data);
        const link = document.createElement("a");
        link.href = url;
        link.download = `auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao exportar CSV"))
      .finally(() => setExportando(false));
  }

  useEffect(() => {
    persistirFiltrosNaUrl();
    carregar(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propostaSelecionada, de, ate, grupos, origens]);

  // Busca de proposta (typeahead) — reaproveita GET /api/alocacao/propostas (mesmo
  // recorte de RBAC de admin/gestor da própria tela de Auditoria).
  useEffect(() => {
    if (buscaProposta.trim().length < 2) {
      setSugestoes([]);
      return;
    }
    const timeout = setTimeout(() => {
      axios
        .get("/api/alocacao/propostas", { params: { busca: buscaProposta, page: 1, pageSize: 8 } })
        .then(({ data }) => setSugestoes(data.rows.map((r: any) => ({ codemp: r.codemp, codpro: r.codpro, cliente: r.cliente }))))
        .catch(() => setSugestoes([]));
    }, 300);
    return () => clearTimeout(timeout);
  }, [buscaProposta]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const alvo = sentinelRef.current;
    if (!alvo) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMais && !loading) {
          carregar(nextCursor);
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(alvo);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, loadingMais, loading]);

  // Agrupa a lista plana (já ordenada desc por ocorridoEm) em blocos por dia, inserindo
  // um "cabeçalho" a cada troca de dia — feito em memo pra não recalcular a cada render.
  const blocosPorDia = useMemo(() => {
    const blocos: { dia: string; grupos: GrupoAuditoria[] }[] = [];
    for (const grupo of grupoAcoes) {
      const dia = chaveDia(grupo.ocorridoEm);
      const ultimo = blocos[blocos.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.grupos.push(grupo);
      else blocos.push({ dia, grupos: [grupo] });
    }
    return blocos;
  }, [grupoAcoes]);

  const selectClass =
    "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (semAcesso) {
    return (
      <div>
        <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Auditoria</p>
        <p className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
          Esta área é só para quem gerencia algum departamento. Fale com um administrador se você acha que deveria ter acesso.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Auditoria</p>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Auditoria</h1>
        <p className="mt-1 text-sm text-muted">Histórico de tudo que aconteceu com propostas, itens, alocações e atividades.</p>
      </div>

      {/* Filtro de proposta em destaque */}
      <div className="mb-4 rounded-lg border border-border bg-surface p-4">
        <label className="mb-1.5 block text-[12.5px] font-medium text-muted">Proposta</label>
        {propostaSelecionada ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary">
              Proposta {propostaSelecionada.codpro} {propostaSelecionada.cliente && `— ${propostaSelecionada.cliente}`}
            </span>
            <button
              onClick={() => setPropostaSelecionada(null)}
              className="text-sm text-muted hover:text-foreground"
              aria-label="Remover filtro de proposta"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="relative max-w-sm">
            <input
              type="text"
              placeholder="Buscar proposta por código ou cliente..."
              value={buscaProposta}
              onChange={(e) => {
                setBuscaProposta(e.target.value);
                setSugestoesAbertas(true);
              }}
              onFocus={() => setSugestoesAbertas(true)}
              onBlur={() => setTimeout(() => setSugestoesAbertas(false), 150)}
              className={`${selectClass} w-full`}
            />
            {sugestoesAbertas && sugestoes.length > 0 && (
              <div className="absolute left-0 top-full z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
                {sugestoes.map((s) => (
                  <button
                    key={`${s.codemp}-${s.codpro}`}
                    onClick={() => {
                      setPropostaSelecionada(s);
                      setBuscaProposta("");
                      setSugestoes([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-2"
                  >
                    Proposta {s.codpro} — {s.cliente}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted">
              {usandoPeriodoPadrao ? "Sem proposta selecionada, mostrando só os últimos 7 dias." : ""}
            </p>
          </div>
        )}
      </div>

      {/* Demais filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={de ? de.slice(0, 10) : ""}
          onChange={(e) => setDe(e.target.value ? new Date(e.target.value).toISOString() : "")}
          className={selectClass}
          aria-label="Data inicial"
        />
        <input
          type="date"
          value={ate ? ate.slice(0, 10) : ""}
          onChange={(e) => setAte(e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : "")}
          className={selectClass}
          aria-label="Data final"
        />
        <MultiSelectDropdown opcoes={GRUPOS_OPCOES} selecionados={grupos} onChange={setGrupos} labelTodos="Todos os grupos" labelSufixo="grupos" />
        <MultiSelectDropdown opcoes={ORIGENS_OPCOES} selecionados={origens} onChange={setOrigens} labelTodos="Todas as origens" labelSufixo="origens" />
        <button
          onClick={exportarCsv}
          disabled={exportando}
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm text-muted transition hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
        >
          {exportando ? "Exportando..." : "Exportar CSV"}
        </button>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>
      )}

      <div className="rounded-lg border border-border bg-surface">
        {loading && grupoAcoes.length === 0 && <p className="p-8 text-center text-sm text-muted">Carregando...</p>}

        {!loading && grupoAcoes.length === 0 && !erro && (
          <p className="p-8 text-center text-sm text-muted">Nenhum evento de auditoria encontrado com os filtros atuais.</p>
        )}

        <div className="divide-y divide-border">
          {blocosPorDia.map((bloco) => (
            <div key={bloco.dia} className="p-5">
              <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-wide text-muted">
                {dayFormatter.format(new Date(`${bloco.dia}T12:00:00`))}
              </p>
              <ol className="space-y-3 border-l border-border pl-4">
                {bloco.grupos.map((grupo) => {
                  const primeiro = grupo.eventos[0];
                  const tone: ToneAuditoria = toneGrupo(grupo);
                  return (
                    <li key={grupo.correlationId} className="relative">
                      <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${toneBadgeAuditoria[tone].split(" ")[0]}`} />
                      <button
                        onClick={() => setDrawerGrupo(grupo)}
                        className="flex w-full items-start gap-3 rounded-md p-2 text-left transition hover:bg-surface-2"
                      >
                        <Avatar nome={primeiro?.usuarioNome ?? "Sistema"} fotoUrl={primeiro?.usuarioFotoUrl} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground">{resumoGrupo(grupo)}</p>
                          <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
                            {hourFormatter.format(new Date(grupo.ocorridoEm))}
                            <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadgeAuditoria[tone]}`}>
                              {configEvento(primeiro?.eventoTipo ?? "").rotuloGrupo}
                            </span>
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>

        <div ref={sentinelRef} className="h-4" />
        {loadingMais && <p className="pb-4 text-center text-[11.5px] text-muted">Carregando mais...</p>}
        {!nextCursor && grupoAcoes.length > 0 && (
          <p className="pb-4 text-center text-[11.5px] text-muted">Fim do histórico com os filtros atuais.</p>
        )}
      </div>

      {drawerGrupo && <DrawerAuditoria grupo={drawerGrupo} onFechar={() => setDrawerGrupo(null)} />}
    </div>
  );
}
