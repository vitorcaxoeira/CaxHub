import axios from "axios";
import { useEffect, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { Pagination } from "../../components/ui/Pagination";
import { Skeleton } from "../../components/ui/Skeleton";
import { copiarParaAreaDeTransferencia } from "../../utils/clipboard";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

interface ItemSincronizacao {
  id: number;
  atividadeId: number;
  codpro: number;
  tipo: string;
  payload: Record<string, unknown>;
  status: string;
  tentativas: number;
  ultimoErro: string | null;
  criadoEm: string;
  processadoEm: string | null;
}

// Prévia do que seria de fato enviado ao Senior agora — GET /sincronizacao/:id/preview,
// reconstruída no backend a partir do dado vivo (nunca do `payload` salvo na pendência, que é
// só um retrato interno tirado na criação, sem relação com o formato do XSD do Senior).
interface PreviewEnvio {
  payload: Record<string, unknown>;
  envelopeXml: string;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const statusTone: Record<string, string> = {
  pendente: "bg-warning/15 text-warning",
  enviado: "bg-success/15 text-success",
  bloqueado: "bg-destructive/15 text-destructive",
};

// As 5 constantes reais usadas em enfileirar(...) pelo backend (routes/alocacao.ts,
// apontamentos.ts, atividades.ts, rats.ts, solicitacoesExcedente.ts) — não existe um catálogo
// central deles, então mantém aqui igual à lista usada no filtro de Tipo.
const TIPO_LABEL: Record<string, string> = {
  criar_apontamento: "Criar apontamento",
  criar_atividade: "Criar alocação",
  editar_atividade: "Editar alocação",
  remover_atividade: "Remover alocação",
  aprovar_rat: "Aprovar RAT",
};

const TIPO_OPCOES: MultiSelectOption<string>[] = Object.entries(TIPO_LABEL).map(([value, label]) => ({ value, label }));

const PAGE_SIZE = 30;

export function SincronizacaoSenior() {
  const [itens, setItens] = useState<ItemSincronizacao[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [reprocessando, setReprocessando] = useState<number | null>(null);
  const [itemDoPayload, setItemDoPayload] = useState<ItemSincronizacao | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [preview, setPreview] = useState<PreviewEnvio | null>(null);
  const [previewCarregando, setPreviewCarregando] = useState(false);
  const [previewErro, setPreviewErro] = useState<string | null>(null);
  const [copiadoPreview, setCopiadoPreview] = useState(false);
  const [itemDoErro, setItemDoErro] = useState<ItemSincronizacao | null>(null);
  const [copiadoErro, setCopiadoErro] = useState(false);

  // Situação vem de um clique num KPI (só um valor por vez, ver handleKpiClick); Tipo é
  // multi-select; Proposta é texto livre (aceita vários números separados por vírgula, mesmo
  // padrão de "Nro. da proposta" em ListarPedidos).
  const [statusFiltro, setStatusFiltro] = useState<string | null>(null);
  const [tipoFiltro, setTipoFiltro] = useState<string[]>([]);
  const [codproInput, setCodproInput] = useState("");
  const codproDebounced = useDebouncedValue(codproInput, 350);

  // Totais por situação da fila INTEIRA (não reagem a statusFiltro/tipoFiltro/codproDebounced)
  // — mesma regra de GET /pedidos/indicadores: o KPI mostra sempre o todo, só a lista abaixo
  // reage aos filtros.
  const [indicadores, setIndicadores] = useState({ pendente: 0, enviando: 0, enviado: 0, bloqueado: 0 });
  const [loadingIndicadores, setLoadingIndicadores] = useState(true);

  function carregar() {
    setLoading(true);
    axios
      .get("/api/sincronizacao", {
        params: {
          page,
          pageSize: PAGE_SIZE,
          status: statusFiltro || undefined,
          tipo: tipoFiltro.length > 0 ? tipoFiltro.join(",") : undefined,
          codpro: codproDebounced || undefined,
        },
      })
      .then(({ data }) => {
        setItens(data.itens);
        setTotal(data.total);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar fila de sincronização"))
      .finally(() => setLoading(false));
  }

  function carregarIndicadores() {
    setLoadingIndicadores(true);
    axios
      .get("/api/sincronizacao/indicadores")
      .then(({ data }) => setIndicadores(data))
      .catch(() => {})
      .finally(() => setLoadingIndicadores(false));
  }

  // Indicadores carregam só uma vez ao montar — não dependem dos filtros da tela.
  useEffect(() => {
    carregarIndicadores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFiltro, tipoFiltro, codproDebounced]);

  // Trocar qualquer filtro volta pra página 1 — senão a busca pode "sumir" numa página que
  // não existe mais no recorte novo (mesmo padrão de ListarPedidos.tsx).
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFiltro, tipoFiltro, codproDebounced]);

  function alternarStatusFiltro(status: string) {
    setStatusFiltro((atual) => (atual === status ? null : status));
  }

  function abrirPayload(item: ItemSincronizacao) {
    setItemDoPayload(item);
    setPreview(null);
    setPreviewErro(null);
    setPreviewCarregando(true);
    axios
      .get(`/api/sincronizacao/${item.id}/preview`)
      .then(({ data }) => setPreview(data))
      .catch((err) => setPreviewErro(err.response?.data?.error ?? "Falha ao reconstruir o envio"))
      .finally(() => setPreviewCarregando(false));
  }

  async function reprocessar(id: number) {
    setReprocessando(id);
    try {
      await axios.post(`/api/sincronizacao/${id}/reprocessar`);
      carregar();
      // O item que acabou de ser reprocessado mudou de situação — sem isso o KPI ficaria
      // visivelmente errado logo depois da própria ação que esta tela oferece.
      carregarIndicadores();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao reprocessar item");
    } finally {
      setReprocessando(null);
    }
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Exportados para o Senior
      </p>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Exportados para o Senior</h1>
        <p className="mt-1 text-sm text-muted">
          Fila (outbox) de mudanças feitas no CaxHub que precisam ser propagadas de volta pro ERP Senior. Apontamento
          (<code>registrarAtividades</code>) e alocação (<code>alocarAtividades</code>) já têm canal publicado; um
          item só fica represado sem consumir tentativa quando o tipo ainda não tem operação do lado do Senior.
        </p>
      </div>

      {loadingIndicadores ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-20" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Clicáveis: filtram a lista abaixo por situação (mesmo espírito do bucket
              clicável de AgingDashboard/ContasReceber) — o total de cada cartão nunca muda
              com o clique, só o da fila inteira, igual a /pedidos/indicadores. */}
          <button
            onClick={() => alternarStatusFiltro("pendente")}
            className={`rounded-lg border p-5 text-left transition ${
              statusFiltro === "pendente" ? "border-warning ring-2 ring-warning/40" : "border-border hover:bg-surface-2"
            } ${statusFiltro && statusFiltro !== "pendente" ? "opacity-40" : ""}`}
          >
            <p className="mb-2 text-[11.5px] text-muted">Pendentes</p>
            <span className="block font-mono text-2xl font-semibold tabular-nums text-warning">{indicadores.pendente}</span>
          </button>
          <button
            onClick={() => alternarStatusFiltro("bloqueado")}
            className={`rounded-lg border p-5 text-left transition ${
              statusFiltro === "bloqueado" ? "border-destructive ring-2 ring-destructive/40" : "border-border hover:bg-surface-2"
            } ${statusFiltro && statusFiltro !== "bloqueado" ? "opacity-40" : ""}`}
          >
            <p className="mb-2 text-[11.5px] text-muted">Bloqueados</p>
            <span className="block font-mono text-2xl font-semibold tabular-nums text-destructive">{indicadores.bloqueado}</span>
          </button>
          <button
            onClick={() => alternarStatusFiltro("enviado")}
            className={`rounded-lg border p-5 text-left transition ${
              statusFiltro === "enviado" ? "border-success ring-2 ring-success/40" : "border-border hover:bg-surface-2"
            } ${statusFiltro && statusFiltro !== "enviado" ? "opacity-40" : ""}`}
          >
            <p className="mb-2 text-[11.5px] text-muted">Enviados</p>
            <span className="block font-mono text-2xl font-semibold tabular-nums text-success">{indicadores.enviado}</span>
          </button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={codproInput}
          onChange={(e) => setCodproInput(e.target.value)}
          placeholder="Nro. da proposta... (separe por vírgula)"
          className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <MultiSelectDropdown
          opcoes={TIPO_OPCOES}
          selecionados={tipoFiltro}
          onChange={setTipoFiltro}
          labelTodos="Todos os tipos"
          labelSufixo="tipos"
        />
        {statusFiltro && (
          <button
            onClick={() => setStatusFiltro(null)}
            className="font-mono text-[10.5px] uppercase tracking-wide text-muted underline hover:text-foreground"
          >
            limpar filtro de situação
          </button>
        )}
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  ID
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Proposta
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Tipo
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Tentativas
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Último erro
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Criado em
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="bg-surface-2 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-10" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-8" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-40" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-5 w-16 rounded" />
                    </td>
                    <td className="px-5 py-3.5" />
                  </tr>
                ))}
              {!loading &&
                itens.map((item) => (
                <tr key={item.id} className="border-t border-border/60 transition hover:bg-surface-2">
                  <td className="px-5 py-3.5 font-mono text-sm tabular-nums text-muted">{item.id}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground">{item.codpro}</td>
                  <td className="px-5 py-3.5 text-sm text-muted">{TIPO_LABEL[item.tipo] ?? item.tipo}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">{item.tentativas}</td>
                  <td className="max-w-[280px] px-5 py-3.5 text-[12px]">
                    {item.ultimoErro ? (
                      <button
                        onClick={() => setItemDoErro(item)}
                        className="block max-w-full truncate text-left text-destructive hover:underline"
                        title={item.ultimoErro}
                      >
                        {item.ultimoErro}
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-[12px] text-muted">{dateTimeFormatter.format(new Date(item.criadoEm))}</td>
                  <td className="px-5 py-3.5 text-right">
                    <span
                      className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                        statusTone[item.status] ?? statusTone.pendente
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => abrirPayload(item)} className="text-sm text-primary hover:underline">
                        Ver payload
                      </button>
                      {(item.status === "bloqueado" || item.status === "pendente") && (
                        <button
                          onClick={() => reprocessar(item.id)}
                          disabled={reprocessando === item.id}
                          className="text-sm text-primary hover:underline disabled:opacity-50"
                        >
                          {reprocessando === item.id ? "Enviando..." : "Enviar para o Senior"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && itens.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted">
                    Nenhum item encontrado com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} label="pendências" />
      </div>

      <Modal
        open={itemDoPayload != null}
        onClose={() => {
          setItemDoPayload(null);
          setCopiado(false);
          setPreview(null);
          setPreviewErro(null);
          setCopiadoPreview(false);
        }}
        title={`Payload — ${itemDoPayload?.tipo ?? ""}`}
        subtitulo={itemDoPayload ? `Proposta ${itemDoPayload.codpro} · pendência #${itemDoPayload.id}` : undefined}
      >
        {itemDoPayload && (
          <>
            <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-muted">
              O que seria enviado ao Senior agora
            </p>
            <p className="mb-2 text-[12px] text-muted">
              Reconstruído a partir do dado vivo (nunca do retrato abaixo) — é este XML que a operação real manda.
            </p>
            {previewCarregando ? (
              <Skeleton className="h-24 w-full" />
            ) : previewErro ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
                {previewErro}
              </p>
            ) : preview ? (
              <>
                <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-[12px] text-foreground">
                  {preview.envelopeXml}
                </pre>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={async () => {
                      const ok = await copiarParaAreaDeTransferencia(preview.envelopeXml);
                      setCopiadoPreview(ok);
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
                  >
                    {copiadoPreview ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              </>
            ) : null}

            <p className="mb-1.5 mt-5 text-[11.5px] font-medium uppercase tracking-wide text-muted">
              Payload salvo nesta pendência
            </p>
            <p className="mb-2 text-[12px] text-muted">
              Retrato interno tirado quando a pendência foi criada, só pra auditoria — não representa o contrato do
              Senior, os nomes de campo são outros.
            </p>
            <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-[12px] text-foreground">
              {JSON.stringify(itemDoPayload.payload, null, 2)}
            </pre>
            <div className="mt-3 flex justify-end">
              <button
                onClick={async () => {
                  const ok = await copiarParaAreaDeTransferencia(JSON.stringify(itemDoPayload.payload, null, 2));
                  setCopiado(ok);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
              >
                {copiado ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={itemDoErro != null}
        onClose={() => {
          setItemDoErro(null);
          setCopiadoErro(false);
        }}
        title={`Erro — ${itemDoErro?.tipo ?? ""}`}
        subtitulo={itemDoErro ? `Proposta ${itemDoErro.codpro} · pendência #${itemDoErro.id}` : undefined}
      >
        {itemDoErro && (
          <>
            <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-[12.5px] text-foreground">
              {itemDoErro.ultimoErro}
            </p>
            <div className="mt-3 flex justify-end">
              <button
                onClick={async () => {
                  const ok = await copiarParaAreaDeTransferencia(itemDoErro.ultimoErro ?? "");
                  setCopiadoErro(ok);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
              >
                {copiadoErro ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
