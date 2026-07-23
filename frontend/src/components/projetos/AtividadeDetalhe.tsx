import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { orcamentoDeTotais, formatHorasCompacto, descreverSaldoDistribuicao } from "../../lib/cronograma";
import { toneBadge } from "../ui/badges";
import { HistoricoContextual } from "../auditoria/HistoricoContextual";

interface Comentario {
  id: number;
  texto: string;
  autorNome: string;
  criadoEm: string;
}

interface ChecklistItem {
  id: number;
  texto: string;
  concluido: boolean;
}

interface Anexo {
  id: number;
  nomeArquivo: string;
  tamanhoBytes: number;
  autorNome: string;
  criadoEm: string;
}

interface HistoricoItem {
  id: number;
  colunaAnteriorNome: string | null;
  colunaNovaNome: string;
  userNome: string;
  movidoEm: string;
}

interface AtividadeDetalheProps {
  atividadeId: number;
  titulo: string;
  podeEditar: boolean;
  dataPrevistaInicio: string | null;
  dataPrevistaFim: string | null;
  codemp: number;
  codpro: number;
  itemDescricao: string | null;
  itemQtdhor: number | null;
  itemAlocado: number;
  itemRealizado: number;
  estruturaNome: string | null;
  estruturaPercentual: number | null;
  podeVerCronograma: boolean;
  onClose: () => void;
}

const tomTexto: Record<"success" | "muted" | "destructive", string> = {
  success: "text-success",
  muted: "text-muted",
  destructive: "text-destructive",
};

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function formatTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function paraInputDate(valor: string | null): string {
  if (!valor) return "";
  return valor.slice(0, 10);
}

export function AtividadeDetalhe({
  atividadeId,
  titulo,
  podeEditar,
  dataPrevistaInicio,
  dataPrevistaFim,
  codemp,
  codpro,
  itemDescricao,
  itemQtdhor,
  itemAlocado,
  itemRealizado,
  estruturaNome,
  estruturaPercentual,
  podeVerCronograma,
  onClose,
}: AtividadeDetalheProps) {
  const navigate = useNavigate();
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [novoComentario, setNovoComentario] = useState("");
  const [novoItemChecklist, setNovoItemChecklist] = useState("");
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [inicioPlanejado, setInicioPlanejado] = useState(paraInputDate(dataPrevistaInicio));
  const [fimPlanejado, setFimPlanejado] = useState(paraInputDate(dataPrevistaFim));
  const [salvandoPlanejamento, setSalvandoPlanejamento] = useState(false);
  const [planejamentoSalvo, setPlanejamentoSalvo] = useState(false);

  function carregar() {
    setLoading(true);
    Promise.all([
      axios.get(`/api/atividades/${atividadeId}/comentarios`),
      axios.get(`/api/atividades/${atividadeId}/checklist`),
      axios.get(`/api/atividades/${atividadeId}/anexos`),
      axios.get(`/api/atividades/${atividadeId}/historico`),
    ])
      .then(([c, ch, a, h]) => {
        setComentarios(c.data.comentarios);
        setChecklist(ch.data.itens);
        setAnexos(a.data.anexos);
        setHistorico(h.data.historico);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atividadeId]);

  async function enviarComentario() {
    if (!novoComentario.trim()) return;
    try {
      await axios.post(`/api/atividades/${atividadeId}/comentarios`, { texto: novoComentario });
      setNovoComentario("");
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao comentar");
    }
  }

  async function adicionarChecklistItem() {
    if (!novoItemChecklist.trim()) return;
    try {
      await axios.post(`/api/atividades/${atividadeId}/checklist`, { texto: novoItemChecklist });
      setNovoItemChecklist("");
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao adicionar item");
    }
  }

  async function alternarChecklistItem(item: ChecklistItem) {
    try {
      await axios.patch(`/api/atividades/${atividadeId}/checklist/${item.id}`, { concluido: !item.concluido });
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao atualizar item");
    }
  }

  async function excluirChecklistItem(itemId: number) {
    try {
      await axios.delete(`/api/atividades/${atividadeId}/checklist/${itemId}`);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir item");
    }
  }

  async function enviarAnexo(file: File) {
    setEnviandoAnexo(true);
    const formData = new FormData();
    formData.append("arquivo", file);
    try {
      await axios.post(`/api/atividades/${atividadeId}/anexos`, formData);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao enviar anexo");
    } finally {
      setEnviandoAnexo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function excluirAnexo(anexoId: number) {
    try {
      await axios.delete(`/api/atividades/${atividadeId}/anexos/${anexoId}`);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir anexo");
    }
  }

  async function baixarAnexo(anexo: Anexo) {
    const { data } = await axios.get(`/api/atividades/${atividadeId}/anexos/${anexo.id}/download`, {
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = anexo.nomeArquivo;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  async function salvarPlanejamento() {
    setSalvandoPlanejamento(true);
    setPlanejamentoSalvo(false);
    try {
      await axios.patch(`/api/atividades/${atividadeId}/planejamento`, {
        dataPrevistaInicio: inicioPlanejado || null,
        dataPrevistaFim: fimPlanejado || null,
      });
      setErro(null);
      setPlanejamentoSalvo(true);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao salvar planejamento");
    } finally {
      setSalvandoPlanejamento(false);
    }
  }

  const checklistConcluidos = checklist.filter((i) => i.concluido).length;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-display text-lg font-bold text-foreground">{titulo}</h2>
          <button onClick={onClose} className="text-sm text-muted hover:text-foreground">
            Fechar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {erro && (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {erro}
            </p>
          )}

          {loading ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : (
            <div className="space-y-6">
              <section>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Contexto do item</p>
                <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2.5">
                  {itemDescricao && <p className="mb-2 text-sm text-foreground">{itemDescricao}</p>}
                  {estruturaNome && (
                    <p className="mb-2 flex items-center gap-1.5 text-[12px] text-muted">
                      <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10.5px] ${toneBadge.neutral}`}>
                        {estruturaNome}
                      </span>
                      {estruturaPercentual != null && `${estruturaPercentual}% concluído`}
                    </p>
                  )}
                  {(() => {
                    const orcamento = orcamentoDeTotais(itemQtdhor ?? 0, itemAlocado, itemRealizado);
                    const largura = 2;
                    const saldo = descreverSaldoDistribuicao(orcamento, largura);
                    return (
                      <p className="font-mono text-[11.5px] text-muted">
                        Contratado {formatHorasCompacto(orcamento.horasContratadas, largura)} · Distribuído{" "}
                        {formatHorasCompacto(orcamento.horasDistribuidas, largura)} · Realizado{" "}
                        {formatHorasCompacto(orcamento.horasRealizadas, largura)} ·{" "}
                        <span className={tomTexto[saldo.tom]}>{saldo.texto}</span>
                      </p>
                    );
                  })()}
                  <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
                    <button onClick={() => navigate(`/projetos/proposta/${codemp}/${codpro}`)} className="text-primary hover:underline">
                      Ver proposta →
                    </button>
                    {estruturaNome && podeVerCronograma && (
                      <button
                        onClick={() => navigate(`/projetos/alocacao/${codemp}/${codpro}/cronograma`)}
                        className="text-primary hover:underline"
                      >
                        Cronograma →
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Planejamento (Timeline)</p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted">Início previsto</span>
                    <input
                      type="date"
                      value={inicioPlanejado}
                      disabled={!podeEditar}
                      onChange={(e) => {
                        setInicioPlanejado(e.target.value);
                        setPlanejamentoSalvo(false);
                      }}
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted">Fim previsto</span>
                    <input
                      type="date"
                      value={fimPlanejado}
                      disabled={!podeEditar}
                      onChange={(e) => {
                        setFimPlanejado(e.target.value);
                        setPlanejamentoSalvo(false);
                      }}
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    />
                  </label>
                  {podeEditar && (
                    <button
                      onClick={salvarPlanejamento}
                      disabled={salvandoPlanejamento}
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                    >
                      {salvandoPlanejamento ? "Salvando..." : "Salvar"}
                    </button>
                  )}
                  {planejamentoSalvo && <span className="text-[11.5px] text-success">Salvo.</span>}
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
                    Checklist {checklist.length > 0 && `(${checklistConcluidos}/${checklist.length})`}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {checklist.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={item.concluido}
                        disabled={!podeEditar}
                        onChange={() => alternarChecklistItem(item)}
                      />
                      <span className={`flex-1 text-sm ${item.concluido ? "text-muted line-through" : "text-foreground"}`}>
                        {item.texto}
                      </span>
                      {podeEditar && (
                        <button
                          onClick={() => excluirChecklistItem(item.id)}
                          className="text-[11px] text-destructive hover:underline"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  ))}
                  {checklist.length === 0 && <p className="text-[12.5px] text-muted">Sem itens de checklist.</p>}
                </div>
                {podeEditar && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      placeholder="Novo item..."
                      value={novoItemChecklist}
                      onChange={(e) => setNovoItemChecklist(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && adicionarChecklistItem()}
                      className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <button
                      onClick={adicionarChecklistItem}
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
                    >
                      Adicionar
                    </button>
                  </div>
                )}
              </section>

              <section>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Anexos</p>
                <div className="space-y-1.5">
                  {anexos.map((anexo) => (
                    <div key={anexo.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                      <button onClick={() => baixarAnexo(anexo)} className="truncate text-sm text-primary hover:underline">
                        {anexo.nomeArquivo}
                      </button>
                      <div className="flex flex-none items-center gap-3">
                        <span className="text-[11px] text-muted">{formatTamanho(anexo.tamanhoBytes)}</span>
                        {podeEditar && (
                          <button onClick={() => excluirAnexo(anexo.id)} className="text-[11px] text-destructive hover:underline">
                            Excluir
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {anexos.length === 0 && <p className="text-[12.5px] text-muted">Sem anexos.</p>}
                </div>
                {podeEditar && (
                  <div className="mt-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      disabled={enviandoAnexo}
                      onChange={(e) => e.target.files?.[0] && enviarAnexo(e.target.files[0])}
                      className="text-[12.5px] text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground"
                    />
                  </div>
                )}
              </section>

              <section>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Comentários</p>
                <div className="space-y-2.5">
                  {comentarios.map((c) => (
                    <div key={c.id} className="rounded-md bg-surface-2 px-3 py-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-foreground">{c.autorNome}</span>
                        <span className="text-[10.5px] text-muted">{dateTimeFormatter.format(new Date(c.criadoEm))}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-foreground">{c.texto}</p>
                    </div>
                  ))}
                  {comentarios.length === 0 && <p className="text-[12.5px] text-muted">Sem comentários ainda.</p>}
                </div>
                {podeEditar && (
                  <div className="mt-2 flex gap-2">
                    <textarea
                      placeholder="Escrever um comentário..."
                      value={novoComentario}
                      onChange={(e) => setNovoComentario(e.target.value)}
                      rows={2}
                      className="flex-1 resize-none rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <button
                      onClick={enviarComentario}
                      className="self-end rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
                    >
                      Enviar
                    </button>
                  </div>
                )}
              </section>

              <section>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Histórico</p>
                <div className="space-y-1.5">
                  {historico.map((h) => (
                    <p key={h.id} className="text-[12px] text-muted">
                      <span className="font-medium text-foreground">{h.userNome}</span>{" "}
                      {h.colunaAnteriorNome ? `moveu de "${h.colunaAnteriorNome}" para` : "definiu como"} "{h.colunaNovaNome}"
                      {" · "}
                      {dateTimeFormatter.format(new Date(h.movidoEm))}
                    </p>
                  ))}
                  {historico.length === 0 && <p className="text-[12.5px] text-muted">Sem movimentações registradas.</p>}
                </div>
              </section>

              <section>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Auditoria</p>
                <HistoricoContextual entidadeTipo="atividade" entidadeId={atividadeId} />
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
