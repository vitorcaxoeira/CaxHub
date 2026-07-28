import axios from "axios";
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatHoras } from "../../utils/horas";
import { Skeleton } from "../../components/ui/Skeleton";
import { Pagination } from "../../components/ui/Pagination";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { ModalEditarDescricao } from "../../components/projetos/ModalEditarDescricao";
import { toneBadge, type Tone } from "../../components/ui/badges";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

interface SessaoPendente {
  id: number;
  atividadeId: number;
  codpro: number;
  numprj: number | null;
  cliente: string | null;
  codcli: number | null;
  itemDescricao: string | null;
  seqite: number | null;
  colunaNome: string;
  inicio: string;
  fim: string;
  duracaoMinutos: number;
  origem: string;
  observacao: string | null;
}

interface AtividadeResumo {
  id: number;
  codpro: number;
  itemDescricao: string | null;
}

interface RatRow {
  id: number;
  numrat: number | null;
  datemi: string | null;
  codemp: number;
  codpro: number | null;
  numprj: number | null;
  cliente: string | null;
  codfor: number;
  consultorNome: string;
  sitrat: number | null;
  sitratLabel: string;
  sitratTone: Tone;
  totalItens: number;
  totalMinutos: number;
  podeAprovar: boolean;
  todosComObservacao: boolean;
}

interface RatItemRow {
  id: number;
  sessaoId: number | null;
  atividadeId: number | null;
  codser: string | null;
  itemDescricao: string | null;
  datati: string | null;
  horini: number | null;
  horfim: number | null;
  duracaoMinutos: number | null;
  desati: string | null;
  confirmadoNoSenior: boolean;
  editavel: boolean;
}

interface ConsultorFiltro {
  codfor: number;
  nome: string;
}

const dataCurtaFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const horaCurtaFormatter = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

function formatHorario(inicioIso: string, fimIso: string): string {
  return `${horaCurtaFormatter.format(new Date(inicioIso))}–${horaCurtaFormatter.format(new Date(fimIso))}`;
}

function formatMinutos(minutos: number): string {
  return formatHoras(minutos / 60);
}

function formatHoraDoDia(minutosDesdeMeiaNoite: number): string {
  const h = Math.floor(minutosDesdeMeiaNoite / 60);
  const m = minutosDesdeMeiaNoite % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const PAGE_SIZE_RATS = 30;

const selectClass =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Tela do consultor: revisa as sessões que o sistema já rastreou automaticamente (ao
// mover o card pra uma coluna "em execução", ver PATCH /atividades/:id/mover) e
// confirma — só nesse momento vira um apontamento de verdade (RatItem) e entra na fila
// pro Senior. O botão "+ Apontamento manual" cobre o caso de não ter passado pelo
// Kanban (trabalho fora do CaxHub, ou esqueceu de mover o card).
//
// Apontamentos confirmados aparecem agrupados por RAT (Rat/RatItem, ver backend/src/
// routes/rats.ts) — uma RAT por consultor+proposta, aberta enquanto "Digitada",
// recebendo apontamentos de qualquer dia até o gestor do departamento (ou admin) a
// aprovar. Consultor comum só vê as próprias RATs; gestor/admin ganham um seletor pra
// ver as de quem eles gerenciam.
export function MeusApontamentos() {
  const navigate = useNavigate();
  const [sessoes, setSessoes] = useState<SessaoPendente[]>([]);
  const [atividades, setAtividades] = useState<AtividadeResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [descricoes, setDescricoes] = useState<Record<number, string>>({});
  const [editandoDescricaoId, setEditandoDescricaoId] = useState<number | null>(null);

  const [rats, setRats] = useState<RatRow[]>([]);
  const [totalRats, setTotalRats] = useState(0);
  const [pageRats, setPageRats] = useState(1);
  const [loadingRats, setLoadingRats] = useState(true);
  const [opcoesFiltro, setOpcoesFiltro] = useState<ConsultorFiltro[]>([]);
  const [codforFiltro, setCodforFiltro] = useState("");
  const [buscaInput, setBuscaInput] = useState("");
  const buscaDebounced = useDebouncedValue(buscaInput, 350);
  const [ratsExpandidas, setRatsExpandidas] = useState<Set<number>>(new Set());
  const [itensPorRat, setItensPorRat] = useState<Record<number, RatItemRow[] | "carregando" | "erro">>({});
  const [aprovando, setAprovando] = useState<number | null>(null);
  const [sincronizando, setSincronizando] = useState<number | null>(null);

  const [modalManual, setModalManual] = useState(false);
  const [manualAtividadeId, setManualAtividadeId] = useState("");
  const [manualData, setManualData] = useState("");
  const [manualInicio, setManualInicio] = useState("");
  const [manualFim, setManualFim] = useState("");
  const [manualDescricao, setManualDescricao] = useState("");
  const [salvandoManual, setSalvandoManual] = useState(false);
  const [erroManual, setErroManual] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    Promise.all([axios.get("/api/apontamentos/sessoes-pendentes"), axios.get("/api/apontamentos/minhas-atividades")])
      .then(([sessoesRes, atividadesRes]) => {
        setSessoes(sessoesRes.data.sessoes);
        setAtividades(atividadesRes.data.atividades);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar apontamentos"))
      .finally(() => setLoading(false));
  }

  function carregarRats() {
    setLoadingRats(true);
    axios
      .get("/api/rats", {
        params: { codfor: codforFiltro || undefined, busca: buscaDebounced || undefined, page: pageRats, pageSize: PAGE_SIZE_RATS },
      })
      .then(({ data }) => {
        setRats(data.rats);
        setTotalRats(data.total);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar RATs"))
      .finally(() => setLoadingRats(false));
  }

  useEffect(() => {
    carregar();
    axios
      .get("/api/rats/opcoes-filtro")
      .then(({ data }) => setOpcoesFiltro(data.consultores))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregarRats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codforFiltro, buscaDebounced, pageRats]);

  // Digitar reseta pra página 1 (senão a busca poderia "sumir" numa página que não
  // existe mais no resultado filtrado) — só dispara depois do debounce, pra não
  // recarregar a cada tecla.
  useEffect(() => {
    setPageRats(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced]);

  function onMudarFiltroConsultor(codfor: string) {
    setCodforFiltro(codfor);
    setPageRats(1);
  }

  async function confirmar(sessaoId: number) {
    setConfirmando(sessaoId);
    // Cai pra observacao (pré-preenchida ao sair de "Em Andamento", ver Atividades.tsx)
    // quando o usuário não editou o campo — senão o texto pré-preenchido só aparecia na
    // tela e nunca era enviado de fato.
    const sessao = sessoes.find((s) => s.id === sessaoId);
    const descricao = descricoes[sessaoId] ?? sessao?.observacao ?? "";
    try {
      const { data } = await axios.post("/api/apontamentos/confirmar", { sessaoId, descricao: descricao || undefined });
      carregar();
      carregarRats();
      if (data?.ratId != null) expandirEAtualizarRat(data.ratId);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao confirmar apontamento");
    } finally {
      setConfirmando(null);
    }
  }

  function limparFormularioManual() {
    setManualAtividadeId("");
    setManualData("");
    setManualInicio("");
    setManualFim("");
    setManualDescricao("");
    setErroManual(null);
  }

  async function salvarManual() {
    if (!manualAtividadeId || !manualData || !manualInicio || !manualFim) {
      setErroManual("Preencha atividade, data e os dois horários");
      return;
    }
    setSalvandoManual(true);
    setErroManual(null);
    try {
      const { data } = await axios.post("/api/apontamentos/manual", {
        atividadeId: Number(manualAtividadeId),
        inicio: `${manualData}T${manualInicio}:00`,
        fim: `${manualData}T${manualFim}:00`,
        descricao: manualDescricao || undefined,
      });
      setModalManual(false);
      limparFormularioManual();
      carregar();
      carregarRats();
      if (data?.ratId != null) expandirEAtualizarRat(data.ratId);
    } catch (err: any) {
      setErroManual(err.response?.data?.error ?? "Falha ao lançar apontamento");
    } finally {
      setSalvandoManual(false);
    }
  }

  function toggleExpandirRat(rat: RatRow) {
    setRatsExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(rat.id)) {
        proximo.delete(rat.id);
      } else {
        proximo.add(rat.id);
        if (!itensPorRat[rat.id]) {
          setItensPorRat((i) => ({ ...i, [rat.id]: "carregando" }));
          axios
            .get(`/api/rats/${rat.id}/itens`)
            .then(({ data }) => setItensPorRat((i) => ({ ...i, [rat.id]: data.itens })))
            .catch(() => setItensPorRat((i) => ({ ...i, [rat.id]: "erro" })));
        }
      }
      return proximo;
    });
  }

  // Após confirmar um apontamento, abre a RAT que recebeu o item (se ainda não estava
  // expandida) e força a releitura dos itens — senão o item recém-inserido só aparece
  // depois de recolher/reexpandir manualmente.
  function expandirEAtualizarRat(ratId: number) {
    setRatsExpandidas((atual) => new Set(atual).add(ratId));
    setItensPorRat((i) => ({ ...i, [ratId]: "carregando" }));
    axios
      .get(`/api/rats/${ratId}/itens`)
      .then(({ data }) => setItensPorRat((i) => ({ ...i, [ratId]: data.itens })))
      .catch(() => setItensPorRat((i) => ({ ...i, [ratId]: "erro" })));
  }

  async function aprovar(rat: RatRow) {
    setAprovando(rat.id);
    try {
      await axios.patch(`/api/rats/${rat.id}/aprovar`);
      carregarRats();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao aprovar RAT");
    } finally {
      setAprovando(null);
    }
  }

  async function sincronizarErp(rat: RatRow) {
    setSincronizando(rat.id);
    try {
      await axios.post(`/api/rats/${rat.id}/sincronizar`);
      carregarRats();
      if (itensPorRat[rat.id]) {
        const { data } = await axios.get(`/api/rats/${rat.id}/itens`);
        setItensPorRat((i) => ({ ...i, [rat.id]: data.itens }));
      }
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao sincronizar com o ERP");
    } finally {
      setSincronizando(null);
    }
  }

  async function excluirApontamento(id: number, ratId: number) {
    try {
      await axios.delete(`/api/apontamentos/${id}`);
      const { data } = await axios.get(`/api/rats/${ratId}/itens`);
      setItensPorRat((i) => ({ ...i, [ratId]: data.itens }));
      carregar();
      carregarRats();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir apontamento");
    }
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Meus Apontamentos
      </p>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Meus Apontamentos</h1>
          <p className="mt-1 text-sm text-muted">
            Revise o tempo rastreado nas suas atividades e confirme pra virar apontamento oficial.
          </p>
        </div>
        <button
          onClick={() => setModalManual(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Apontamento manual
        </button>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <div className="space-y-8">
        <section>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">
            Sessões pendentes de confirmação {sessoes.length > 0 && `(${sessoes.length})`}
          </p>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      ID
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Proposta
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Id Ativ.
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                      Item
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                      Cliente
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Data
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Horário
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Duração
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                      Descrição
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loading &&
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="hidden px-2.5 py-3.5 sm:table-cell">
                          <Skeleton className="h-4 w-8" />
                        </td>
                        <td className="px-2.5 py-3.5">
                          <Skeleton className="h-4 w-16" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 sm:table-cell">
                          <Skeleton className="h-4 w-8" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 lg:table-cell">
                          <Skeleton className="h-4 w-28" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 md:table-cell">
                          <Skeleton className="h-4 w-28" />
                        </td>
                        <td className="px-2.5 py-3.5">
                          <Skeleton className="h-4 w-24" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 sm:table-cell">
                          <Skeleton className="h-4 w-24" />
                        </td>
                        <td className="px-2.5 py-3.5 text-right">
                          <Skeleton className="ml-auto h-4 w-12" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 lg:table-cell">
                          <Skeleton className="h-7 w-full" />
                        </td>
                        <td className="px-2.5 py-3.5 text-right">
                          <Skeleton className="ml-auto h-7 w-20 rounded" />
                        </td>
                      </tr>
                    ))}
                  {!loading &&
                    sessoes.map((s) => (
                      <tr key={s.id} className="border-t border-border/60">
                        <td className="hidden px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">{s.id}</td>
                        <td className="px-2.5 py-3.5 text-sm font-semibold text-foreground">{s.codpro}</td>
                        <td className="hidden px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                          {s.atividadeId}
                        </td>
                        <td
                          className="hidden max-w-[220px] truncate px-2.5 py-3.5 text-sm text-muted lg:table-cell"
                          title={s.itemDescricao ?? undefined}
                        >
                          {s.itemDescricao ?? "—"}
                          {s.seqite != null && ` (${s.seqite})`}
                        </td>
                        <td
                          className="hidden max-w-[200px] truncate px-2.5 py-3.5 text-sm text-muted md:table-cell"
                          title={s.cliente ?? undefined}
                        >
                          {s.cliente ?? "—"}
                          {s.codcli != null && ` (${s.codcli})`}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted">
                          {dataCurtaFormatter.format(new Date(s.inicio))}
                        </td>
                        <td className="hidden whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                          {formatHorario(s.inicio, s.fim)}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
                          {formatMinutos(s.duracaoMinutos)}
                        </td>
                        <td className="hidden px-2.5 py-3.5 lg:table-cell">
                          <button
                            onClick={() => setEditandoDescricaoId(s.id)}
                            className={`w-full max-w-[220px] truncate rounded-md border px-2.5 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              descricoes[s.id] ?? s.observacao
                                ? "border-border text-foreground hover:bg-surface-2"
                                : "border-dashed border-border text-muted hover:bg-surface-2"
                            }`}
                          >
                            {descricoes[s.id] ?? s.observacao ?? "+ Adicionar descrição"}
                          </button>
                        </td>
                        <td className="px-2.5 py-3.5 text-right">
                          <button
                            onClick={() => confirmar(s.id)}
                            disabled={confirmando === s.id}
                            className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-surface-2 disabled:opacity-50"
                          >
                            {confirmando === s.id ? "Confirmando..." : "Confirmar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  {!loading && sessoes.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-2.5 py-8 text-center text-sm text-muted">
                        Nenhuma sessão pendente — mova um card pra "Em Andamento" pra começar a rastrear tempo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">RATs</p>
              <input
                type="text"
                placeholder="Buscar cliente, proposta ou nº da RAT..."
                value={buscaInput}
                onChange={(e) => setBuscaInput(e.target.value)}
                className={`${selectClass} w-64`}
              />
            </div>
            <div className="flex items-center gap-3">
              {opcoesFiltro.length > 1 && (
                <select value={codforFiltro} onChange={(e) => onMudarFiltroConsultor(e.target.value)} className={selectClass}>
                  <option value="">Todos os consultores</option>
                  {opcoesFiltro.map((c) => (
                    <option key={c.codfor} value={c.codfor}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      ID
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      RAT
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Proposta
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Cliente
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Consultor
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                      Emissão
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Situação
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Itens
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Total
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loadingRats &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-2.5 py-3.5" colSpan={10}>
                          <Skeleton className="h-6 w-full" />
                        </td>
                      </tr>
                    ))}
                  {!loadingRats &&
                    rats.map((rat) => {
                      const expandida = ratsExpandidas.has(rat.id);
                      const itens = itensPorRat[rat.id];
                      return (
                        <Fragment key={rat.id}>
                          <tr
                            onClick={() => toggleExpandirRat(rat)}
                            className={`cursor-pointer transition ${
                              expandida ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                            }`}
                          >
                            <td className={`px-2.5 py-3.5 ${expandida ? "border-l border-primary" : ""}`}>
                              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <span className="text-muted">{expandida ? "▾" : "▸"}</span>
                                {rat.id}
                              </p>
                            </td>
                            <td className="whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted">{rat.numrat ?? "—"}</td>
                            <td className="px-2.5 py-3.5 text-sm text-foreground">
                              {rat.codpro != null ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/projetos/proposta/${rat.codemp}/${rat.codpro}`);
                                  }}
                                  className="text-primary hover:underline"
                                >
                                  {rat.codpro}
                                </button>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="max-w-[220px] truncate px-2.5 py-3.5 text-sm text-muted" title={rat.cliente ?? undefined}>
                              {rat.cliente ?? "—"}
                            </td>
                            <td className="px-2.5 py-3.5 text-sm text-muted">{rat.consultorNome}</td>
                            <td className="hidden whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted md:table-cell">
                              {rat.datemi ? dateFormatter.format(new Date(rat.datemi)) : "—"}
                            </td>
                            <td className="px-2.5 py-3.5">
                              <span className={`inline-block rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium ${toneBadge[rat.sitratTone]}`}>
                                {rat.sitratLabel}
                              </span>
                            </td>
                            <td className="hidden px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-muted sm:table-cell">
                              {rat.totalItens}
                            </td>
                            <td className="whitespace-nowrap px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
                              {formatMinutos(rat.totalMinutos)}
                            </td>
                            <td className={`px-2.5 py-3.5 text-right ${expandida ? "border-r border-primary" : ""}`}>
                              <DropdownMenu placement="bottom-end">
                                <DropdownMenu.Trigger>
                                  <button
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label="Ações"
                                  >
                                    ⋯
                                  </button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Content>
                                  {rat.podeAprovar && (
                                    <DropdownMenu.Item
                                      onSelect={() => aprovar(rat)}
                                      disabled={aprovando === rat.id || !rat.todosComObservacao}
                                      title={!rat.todosComObservacao ? "Todos os itens precisam de observação preenchida" : undefined}
                                    >
                                      {aprovando === rat.id ? "Aprovando..." : "Aprovar"}
                                    </DropdownMenu.Item>
                                  )}
                                  <DropdownMenu.Item
                                    onSelect={() => sincronizarErp(rat)}
                                    disabled={rat.numrat == null || sincronizando === rat.id}
                                    title={rat.numrat == null ? "Só disponível depois que a RAT tem número do ERP" : undefined}
                                  >
                                    {sincronizando === rat.id ? "Sincronizando..." : "Sinc. ERP"}
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu>
                            </td>
                          </tr>
                          {expandida && (
                            <tr className="border-t border-border/60 bg-surface-2/40">
                              <td colSpan={10} className="border-b border-l border-r border-primary px-2.5 py-3">
                                {itens === "carregando" && <p className="py-2 text-sm text-muted">Carregando itens...</p>}
                                {itens === "erro" && <p className="py-2 text-sm text-destructive">Falha ao carregar os itens desta RAT.</p>}
                                {Array.isArray(itens) && itens.length === 0 && (
                                  <p className="py-2 text-sm text-muted">Nenhum item nesta RAT.</p>
                                )}
                                {Array.isArray(itens) && itens.length > 0 && (
                                  <table className="w-full border-collapse">
                                    <thead>
                                      <tr>
                                        <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Data
                                        </th>
                                        <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Horário
                                        </th>
                                        <th className="py-1.5 pr-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Duração
                                        </th>
                                        <th className="w-2/5 py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Observação
                                        </th>
                                        <th className="py-1.5 pr-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Atividade
                                        </th>
                                        <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Serviço
                                        </th>
                                        <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Item
                                        </th>
                                        <th className="py-1.5" />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {itens.map((item) => (
                                        <tr key={item.id} className="border-t border-border/40">
                                          <td className="py-1.5 pr-3 font-mono text-[12.5px] tabular-nums text-muted">
                                            {item.datati ? dateFormatter.format(new Date(item.datati)) : "—"}
                                          </td>
                                          <td className="py-1.5 pr-3 font-mono text-[12.5px] tabular-nums text-muted">
                                            {item.horini != null && item.horfim != null
                                              ? `${formatHoraDoDia(item.horini)}–${formatHoraDoDia(item.horfim)}`
                                              : "—"}
                                          </td>
                                          <td className="py-1.5 pr-3 text-right font-mono text-[12.5px] tabular-nums text-foreground">
                                            {item.duracaoMinutos != null ? formatMinutos(item.duracaoMinutos) : "—"}
                                          </td>
                                          <td className="py-1.5 pr-3">
                                            <span className={`text-[12.5px] ${item.desati?.trim() ? "text-foreground" : "text-warning"}`}>
                                              {item.desati ?? "Sem observação"}
                                            </span>
                                          </td>
                                          <td className="py-1.5 pr-3 text-right font-mono text-[12.5px] tabular-nums text-muted">
                                            {item.atividadeId ?? "—"}
                                          </td>
                                          <td className="py-1.5 pr-3 font-mono text-[12.5px] text-muted">{item.codser ?? "—"}</td>
                                          <td
                                            className="max-w-[260px] truncate py-1.5 pr-3 text-[12.5px] text-muted"
                                            title={item.itemDescricao ?? undefined}
                                          >
                                            {item.itemDescricao ?? "—"}
                                          </td>
                                          <td className="py-1.5 text-right">
                                            {item.editavel && item.sessaoId != null && (
                                              <button
                                                onClick={() => excluirApontamento(item.sessaoId!, rat.id)}
                                                className="text-[11px] text-destructive hover:underline"
                                              >
                                                Excluir
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  {!loadingRats && rats.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-2.5 py-8 text-center text-sm text-muted">
                        Nenhuma RAT ainda — confirme uma sessão pendente pra começar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pageRats}
              pageSize={PAGE_SIZE_RATS}
              total={totalRats}
              loading={loadingRats}
              onPageChange={setPageRats}
              label="RATs"
            />
          </div>
        </section>
      </div>

      {editandoDescricaoId != null &&
        (() => {
          const sessao = sessoes.find((s) => s.id === editandoDescricaoId);
          if (!sessao) return null;
          return (
            <ModalEditarDescricao
              titulo={`Proposta ${sessao.codpro}`}
              valorInicial={descricoes[sessao.id] ?? sessao.observacao ?? ""}
              onSalvar={(texto) => {
                setDescricoes((atual) => ({ ...atual, [sessao.id]: texto }));
                setEditandoDescricaoId(null);
              }}
              onFechar={() => setEditandoDescricaoId(null)}
            />
          );
        })()}

      {modalManual && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-foreground">Apontamento manual</h2>
              <button
                onClick={() => {
                  setModalManual(false);
                  limparFormularioManual();
                }}
                className="text-sm text-muted hover:text-foreground"
              >
                Fechar
              </button>
            </div>
            {erroManual && (
              <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erroManual}
              </p>
            )}
            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Atividade</span>
                <select value={manualAtividadeId} onChange={(e) => setManualAtividadeId(e.target.value)} className={selectClass}>
                  <option value="">Selecione...</option>
                  {atividades.map((a) => (
                    <option key={a.id} value={a.id}>
                      Proposta {a.codpro}
                      {a.itemDescricao ? ` · ${a.itemDescricao}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Data</span>
                <input type="date" value={manualData} onChange={(e) => setManualData(e.target.value)} className={selectClass} />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] text-muted">Início</span>
                  <input type="time" value={manualInicio} onChange={(e) => setManualInicio(e.target.value)} className={selectClass} />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] text-muted">Fim</span>
                  <input type="time" value={manualFim} onChange={(e) => setManualFim(e.target.value)} className={selectClass} />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Descrição</span>
                <textarea
                  value={manualDescricao}
                  onChange={(e) => setManualDescricao(e.target.value)}
                  rows={2}
                  className={`${selectClass} resize-none`}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setModalManual(false);
                  limparFormularioManual();
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                onClick={salvarManual}
                disabled={salvandoManual}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {salvandoManual ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
