import axios from "axios";
import { useEffect, useState } from "react";
import { usePorPagina } from "../../components/ui/padroesFiltros/usePorPagina";
import { Link } from "react-router-dom";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { Modal } from "../../components/ui/Modal";
import { MultiSelectDropdown, type MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { Pagination } from "../../components/ui/Pagination";
import { Skeleton } from "../../components/ui/Skeleton";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { copiarParaAreaDeTransferencia } from "../../utils/clipboard";

// Aba "Situação de proposta" de Exportados para o Senior (10/11/2026): a fila de saída das mudanças de situação pedidas na tela Gestão Propostas
// (Finalizar / Em Execução), enviadas ao Senior pela operação `ManterSituacaoProposta`. Espelho das abas Atividades e Despesas de viagem, lendo
// SincronizacaoPendenteProposta (GET /api/sincronizacao/propostas-situacao*). A situação da proposta no CaxHub só muda depois que o Senior confirma.

interface ItemSituacao {
  id: number;
  codemp: number;
  codpro: number;
  despro: string | null;
  cliente: string | null;
  sitproAtual: number | null;
  sitproAtualLabel: string;
  sitproDeLabel: string;
  sitproParaLabel: string;
  tipo: string;
  payload: Record<string, unknown>;
  status: string;
  tentativas: number;
  ultimoErro: string | null;
  /** pendente sem falha real: só espera o envio poder sair (porta desligada neste ambiente). */
  aguardando: boolean;
  usuario: string | null;
  criadoEm: string;
  processadoEm: string | null;
}

interface Indicadores {
  pendente: number;
  enviando: number;
  enviado: number;
  bloqueado: number;
  envioLigado: boolean;
  somenteLeitura: boolean;
}

interface PreviewEnvio {
  payload: Record<string, unknown>;
  envelopeXml: string;
}

const PAGE_SIZE = 30;
const OPCOES_POR_PAGINA = [10, 25, 30, 50, 100]; // a API aceita até 100 por página

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const statusTone: Record<string, string> = {
  pendente: "bg-warning/15 text-warning",
  enviando: "bg-warning/15 text-warning",
  enviado: "bg-success/15 text-success",
  bloqueado: "bg-destructive/15 text-destructive",
};

// Classes completas (o Tailwind só gera o que aparece escrito por inteiro no código).
const KPI_COR = {
  warning: { ativo: "border-warning ring-2 ring-warning/40", texto: "text-warning" },
  destructive: { ativo: "border-destructive ring-2 ring-destructive/40", texto: "text-destructive" },
  success: { ativo: "border-success ring-2 ring-success/40", texto: "text-success" },
} as const;

const TIPO_LABEL: Record<string, string> = {
  finalizar_proposta: "Finalizar",
  reabrir_execucao_proposta: "Em Execução",
};

const TIPO_OPCOES: MultiSelectOption<string>[] = Object.entries(TIPO_LABEL).map(([value, label]) => ({ value, label }));

const TH = "whitespace-nowrap bg-surface-2 px-3 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted";
const INPUT =
  "rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PainelSituacaoProposta() {
  const [itens, setItens] = useState<ItemSituacao[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // "Por página" com a estrela de padrão (12/11/2026): a 1ª consulta espera o padrão salvo.
  const pp = usePorPagina({ tela: "admin.sincronizacao.situacao-proposta", inicial: PAGE_SIZE, opcoes: OPCOES_POR_PAGINA });
  const pageSize = pp.porPagina;
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [reprocessando, setReprocessando] = useState<number | null>(null);
  const [itemDoPayload, setItemDoPayload] = useState<ItemSituacao | null>(null);
  const [preview, setPreview] = useState<PreviewEnvio | null>(null);
  const [previewCarregando, setPreviewCarregando] = useState(false);
  const [previewErro, setPreviewErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [copiadoPreview, setCopiadoPreview] = useState(false);
  const [itemDoErro, setItemDoErro] = useState<ItemSituacao | null>(null);
  const [copiadoErro, setCopiadoErro] = useState(false);

  const [statusFiltro, setStatusFiltro] = useState<string | null>(null);
  const [tipoFiltro, setTipoFiltro] = useState<string[]>([]);
  const [codproInput, setCodproInput] = useState("");
  const codproDebounced = useDebouncedValue(codproInput, 350);

  const [indicadores, setIndicadores] = useState<Indicadores | null>(null);

  function carregar() {
    setLoading(true);
    axios
      .get("/api/sincronizacao/propostas-situacao", {
        params: {
          page,
          pageSize,
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
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a fila de situação de proposta"))
      .finally(() => setLoading(false));
  }

  function carregarIndicadores() {
    axios
      .get<Indicadores>("/api/sincronizacao/propostas-situacao/indicadores")
      .then(({ data }) => setIndicadores(data))
      .catch(() => undefined);
  }

  useEffect(() => {
    carregarIndicadores();
  }, []);

  useEffect(() => {
    if (!pp.pronto) return;
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, pp.pronto, statusFiltro, tipoFiltro, codproDebounced]);

  useEffect(() => {
    setPage(1);
  }, [statusFiltro, tipoFiltro, codproDebounced]);

  function alternarStatusFiltro(status: string) {
    setStatusFiltro((atual) => (atual === status ? null : status));
  }

  function abrirPayload(item: ItemSituacao) {
    setItemDoPayload(item);
    setPreview(null);
    setPreviewErro(null);
    setPreviewCarregando(true);
    axios
      .get(`/api/sincronizacao/propostas-situacao/${item.id}/preview`)
      .then(({ data }) => setPreview(data))
      .catch((err) => setPreviewErro(err.response?.data?.error ?? "Falha ao reconstruir o envio"))
      .finally(() => setPreviewCarregando(false));
  }

  async function reprocessar(id: number) {
    setReprocessando(id);
    try {
      await axios.post(`/api/sincronizacao/propostas-situacao/${id}/reprocessar`);
      carregar();
      carregarIndicadores();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao reprocessar a pendência");
    } finally {
      setReprocessando(null);
    }
  }

  const kpi = (status: "pendente" | "bloqueado" | "enviado", rotulo: string, cor: "warning" | "destructive" | "success") => (
    <button
      onClick={() => alternarStatusFiltro(status)}
      className={`rounded-lg border p-5 text-left transition ${
        statusFiltro === status ? KPI_COR[cor].ativo : "border-border hover:bg-surface-2"
      } ${statusFiltro && statusFiltro !== status ? "opacity-40" : ""}`}
    >
      <p className="mb-2 text-[11.5px] text-muted">{rotulo}</p>
      <span className={`block font-mono text-2xl font-semibold tabular-nums ${KPI_COR[cor].texto}`}>{indicadores ? indicadores[status] : "…"}</span>
    </button>
  );

  return (
    <>
      {indicadores && !indicadores.envioLigado && (
        <p className="mb-4 mt-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <strong>O servidor está em somente leitura</strong> (<code>SENIOR_SOMENTE_LEITURA</code>): nada é gravado no Senior, então as pendências ficam em
          "pendente" sem gastar tentativa e a situação das propostas não muda. Ao desligar essa trava, a fila envia sozinha (a cada 15 minutos) ou pelo
          "Enviar para o Senior" de cada linha.
        </p>
      )}

      <div className="mb-6 mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpi("pendente", "Pendentes", "warning")}
        {kpi("bloqueado", "Bloqueados", "destructive")}
        {kpi("enviado", "Enviados", "success")}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={codproInput}
          onChange={(e) => setCodproInput(e.target.value)}
          placeholder="Nº da proposta... (separe por vírgula)"
          className={`${INPUT} w-64`}
        />
        <MultiSelectDropdown opcoes={TIPO_OPCOES} selecionados={tipoFiltro} onChange={setTipoFiltro} labelTodos="Todas as ações" labelSufixo="ações" />
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
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>ID</th>
                <th className={TH}>Proposta</th>
                <th className={TH}>Ação</th>
                <th className={TH}>Situação pedida</th>
                <th className={`${TH} text-right`}>Tentativas</th>
                <th className={TH}>Observação / último erro</th>
                <th className={TH}>Pedido por</th>
                <th className={TH}>Criado em</th>
                <th className={`${TH} text-right`}>Status</th>
                <th className="bg-surface-2 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td colSpan={10} className="px-3 py-3.5">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {!loading &&
                itens.map((item) => (
                  <tr key={item.id} className="border-t border-border/60 transition hover:bg-surface-2">
                    <td className="whitespace-nowrap px-3 py-3.5 font-mono text-sm tabular-nums text-muted">{item.id}</td>
                    <td className="max-w-[260px] px-3 py-3.5 text-[12.5px]">
                      {/* Abre a Gestão Propostas já filtrada nesta proposta (sem recorte de situação nem de tipo). */}
                      <Link
                        to={`/projetos/gestao-propostas?tipo=all&situacao=&busca=${item.codpro}`}
                        className="font-semibold text-primary hover:underline"
                        title="Abrir na Gestão Propostas"
                      >
                        {item.codpro}
                      </Link>
                      <p className="truncate text-muted" title={[item.cliente, item.despro].filter(Boolean).join(" · ")}>
                        {[item.cliente, item.despro].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-muted">{TIPO_LABEL[item.tipo] ?? item.tipo}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-[12.5px] text-foreground">
                      {item.sitproDeLabel} <span aria-hidden>→</span> <strong>{item.sitproParaLabel}</strong>
                      <p className="text-muted">Agora: {item.sitproAtualLabel}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono text-sm tabular-nums text-muted">{item.tentativas}</td>
                    <td className="max-w-[300px] px-3 py-3.5 text-[12px]">
                      {item.ultimoErro ? (
                        item.aguardando ? (
                          <span className="block truncate text-muted" title={item.ultimoErro}>
                            {item.ultimoErro}
                          </span>
                        ) : (
                          <button
                            onClick={() => setItemDoErro(item)}
                            className="block max-w-full truncate text-left text-destructive hover:underline"
                            title={item.ultimoErro}
                          >
                            {item.ultimoErro}
                          </button>
                        )
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-[12.5px] text-muted">{item.usuario ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-[12px] text-muted">{dateTimeFormatter.format(new Date(item.criadoEm))}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right">
                      <span
                        className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                          statusTone[item.status] ?? statusTone.pendente
                        }`}
                        title={item.aguardando ? "Aguardando o envio ao Senior ser ligado" : undefined}
                      >
                        {item.aguardando ? "aguardando" : item.status}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <DropdownMenu placement="bottom-end">
                        <DropdownMenu.Trigger>
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Ações da pendência"
                          >
                            ⋯
                          </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content>
                          <DropdownMenu.Item onSelect={() => abrirPayload(item)}>Ver payload</DropdownMenu.Item>
                          {(item.status === "bloqueado" || item.status === "pendente") && (
                            <DropdownMenu.Item onSelect={() => reprocessar(item.id)} disabled={reprocessando === item.id}>
                              {reprocessando === item.id ? "Enviando..." : "Enviar para o Senior"}
                            </DropdownMenu.Item>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              {!loading && itens.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-muted">
                    Nenhum pedido de mudança de situação com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          loading={loading}
          onPageChange={setPage}
          label="pendências"
          opcoesPorPagina={pp.opcoes}
          onPageSizeChange={(n) => {
            pp.mudar(n);
            setPage(1);
          }}
          acessorioPorPagina={pp.estrela}
        />
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
        title={`Payload — ${itemDoPayload ? TIPO_LABEL[itemDoPayload.tipo] ?? itemDoPayload.tipo : ""}`}
        subtitulo={itemDoPayload ? `Proposta ${itemDoPayload.codpro} · pendência #${itemDoPayload.id}` : undefined}
      >
        {itemDoPayload && (
          <>
            <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-muted">O que seria enviado ao Senior agora</p>
            <p className="mb-2 text-[12px] text-muted">Reconstruído a partir do dado vivo (nunca do retrato abaixo) — é este XML que a operação real manda.</p>
            {previewCarregando ? (
              <Skeleton className="h-24 w-full" />
            ) : previewErro ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{previewErro}</p>
            ) : preview ? (
              <>
                <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-[12px] text-foreground">{preview.envelopeXml}</pre>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={async () => setCopiadoPreview(await copiarParaAreaDeTransferencia(preview.envelopeXml))}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
                  >
                    {copiadoPreview ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              </>
            ) : null}

            <p className="mb-1.5 mt-5 text-[11.5px] font-medium uppercase tracking-wide text-muted">Payload salvo nesta pendência</p>
            <p className="mb-2 text-[12px] text-muted">Retrato interno tirado quando a pendência foi criada, só para auditoria — não é o contrato do Senior.</p>
            <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-[12px] text-foreground">{JSON.stringify(itemDoPayload.payload, null, 2)}</pre>
            <div className="mt-3 flex justify-end">
              <button
                onClick={async () => setCopiado(await copiarParaAreaDeTransferencia(JSON.stringify(itemDoPayload.payload, null, 2)))}
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
        title={`Erro — ${itemDoErro ? TIPO_LABEL[itemDoErro.tipo] ?? itemDoErro.tipo : ""}`}
        subtitulo={itemDoErro ? `Proposta ${itemDoErro.codpro} · pendência #${itemDoErro.id}` : undefined}
      >
        {itemDoErro && (
          <>
            <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-[12.5px] text-foreground">{itemDoErro.ultimoErro}</p>
            <div className="mt-3 flex justify-end">
              <button
                onClick={async () => setCopiadoErro(await copiarParaAreaDeTransferencia(itemDoErro.ultimoErro ?? ""))}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
              >
                {copiadoErro ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
