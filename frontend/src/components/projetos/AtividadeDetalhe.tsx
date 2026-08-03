import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { orcamentoDeTotais, formatHorasCompacto, descreverSaldoDistribuicao } from "../../lib/cronograma";
import { horasParaMinutos, minutosParaInputHoras } from "../../utils/horas";
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
  /** "movimentacao" ou o fato registrado (ex.: "horas_excedentes"). */
  tipo: string;
  /** Frase pronta dos eventos que não movem o card; nula nas movimentações. */
  descricao: string | null;
  colunaAnteriorNome: string | null;
  /** Nula nos eventos que não são movimentação — não há coluna de destino. */
  colunaNovaNome: string | null;
  userNome: string;
  movidoEm: string;
}

export interface SolicitacaoApontamento {
  id: number;
  atividadeId: number;
  status: "pendente" | "aprovada" | "reprovada";
  inicioSolicitado: string;
  fimSolicitado: string;
  motivo: string;
  descricao: string;
  inicioAprovado: string | null;
  fimAprovado: string | null;
  descricaoAprovada: string | null;
  observacaoDecisao: string | null;
  criadoEm: string;
  decididoEm: string | null;
  solicitanteNome: string;
  decisorNome: string | null;
  codemp: number;
  codpro: number;
  seqite: number;
  depexe: number | null;
  depexeLabel: string;
  podeDecidir: boolean;
}

export interface SolicitacaoExcedente {
  id: number;
  atividadeId: number;
  status: "pendente" | "aprovada" | "reprovada";
  horasSolicitadas: number;
  horasAprovadas: number | null;
  motivo: string;
  observacaoDecisao: string | null;
  criadoEm: string;
  decididoEm: string | null;
  solicitanteNome: string;
  decisorNome: string | null;
  codemp: number;
  codpro: number;
  seqite: number;
  depexe: number | null;
  depexeLabel: string;
  qtdhor: number | null;
  horasExcedentesAtuais: number;
  podeDecidir: boolean;
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
  // Horas da PRÓPRIA alocação (não do item): o previsto e o excedente que o gestor
  // autorizou por cima dele. Juntos formam o teto de apontamento da atividade.
  qtdhorPrevisto: number | null;
  horasExcedentes: number;
  // Só o gestor do departamento autoriza excedente — o consultor não libera as próprias
  // horas. Vem do backend junto do card (podeVerCronograma usa a mesma origem).
  podeAutorizarExcedente: boolean;
  // O usuário logado é o consultor desta atividade. Governa as duas coisas que só quem
  // executa faz: pedir horas excedentes e pedir apontamento avulso.
  souOExecutor: boolean;
  // Avisa a tela pra recarregar os cards depois de mudar o excedente, que altera o teto.
  onExcedenteAlterado?: () => void;
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
  qtdhorPrevisto,
  horasExcedentes,
  podeAutorizarExcedente,
  souOExecutor,
  onExcedenteAlterado,
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
  const [excedenteInput, setExcedenteInput] = useState(minutosParaInputHoras(horasExcedentes));
  const [salvandoExcedente, setSalvandoExcedente] = useState(false);
  const [erroExcedente, setErroExcedente] = useState<string | null>(null);

  // Solicitação de horas excedentes — o outro lado do campo acima: quem executa pede, o
  // gestor decide no painel de Horas Excedentes.
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoExcedente[]>([]);
  const [abrindoSolicitacao, setAbrindoSolicitacao] = useState(false);
  const [horasSolicitadasInput, setHorasSolicitadasInput] = useState("");
  const [motivoSolicitacao, setMotivoSolicitacao] = useState("");
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const [erroSolicitacao, setErroSolicitacao] = useState<string | null>(null);
  const pendente = solicitacoes.find((s) => s.status === "pendente") ?? null;
  const ultimaDecidida = solicitacoes.find((s) => s.status !== "pendente") ?? null;

  // Apontamento avulso — o tempo que ficou de fora por esquecer de mover o card. Diferente
  // do excedente: pode haver vários pendentes na mesma atividade, um por dia esquecido.
  const [apontamentos, setApontamentos] = useState<SolicitacaoApontamento[]>([]);
  const [abrindoApontamento, setAbrindoApontamento] = useState(false);
  // Uma data só: um apontamento começa e termina no mesmo dia. Antes eram dois
  // datetime-local, o que deixava escolher datas diferentes sem querer.
  const [dataApontamento, setDataApontamento] = useState("");
  const [horaInicioApontamento, setHoraInicioApontamento] = useState("");
  const [horaFimApontamento, setHoraFimApontamento] = useState("");
  const [motivoApontamento, setMotivoApontamento] = useState("");
  const [descricaoApontamento, setDescricaoApontamento] = useState("");
  const [enviandoApontamento, setEnviandoApontamento] = useState(false);
  const [erroApontamento, setErroApontamento] = useState<string | null>(null);

  async function enviarApontamento() {
    if (!dataApontamento || !horaInicioApontamento || !horaFimApontamento) {
      setErroApontamento("Informe a data, a hora inicial e a hora final.");
      return;
    }
    if (horaFimApontamento <= horaInicioApontamento) {
      setErroApontamento("A hora final precisa ser depois da inicial.");
      return;
    }
    if (motivoApontamento.trim() === "") {
      setErroApontamento("Informe o motivo — é por que este tempo não foi registrado no quadro.");
      return;
    }
    if (descricaoApontamento.trim() === "") {
      setErroApontamento("Descreva o trabalho realizado.");
      return;
    }
    setEnviandoApontamento(true);
    setErroApontamento(null);
    try {
      await axios.post("/api/solicitacoes-apontamento", {
        atividadeId,
        // "AAAA-MM-DDTHH:MM" sem fuso é lido como hora LOCAL pelo navegador, que é o que a
        // pessoa digitou; o toISOString devolve o instante certo pro servidor. As duas
        // horas usam a MESMA data — o fim assume o dia do início.
        inicio: new Date(`${dataApontamento}T${horaInicioApontamento}`).toISOString(),
        fim: new Date(`${dataApontamento}T${horaFimApontamento}`).toISOString(),
        motivo: motivoApontamento.trim(),
        descricao: descricaoApontamento.trim(),
      });
      setAbrindoApontamento(false);
      setDataApontamento("");
      setHoraInicioApontamento("");
      setHoraFimApontamento("");
      setMotivoApontamento("");
      setDescricaoApontamento("");
      carregar();
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setErroApontamento(axiosErr.response?.data?.error ?? "Falha ao enviar a solicitação");
    } finally {
      setEnviandoApontamento(false);
    }
  }

  async function enviarSolicitacao() {
    const minutos = horasParaMinutos(horasSolicitadasInput);
    if (minutos == null) {
      setErroSolicitacao("Informe as horas no formato H:MM (ex.: 4:00).");
      return;
    }
    if (motivoSolicitacao.trim() === "") {
      setErroSolicitacao("Descreva o motivo — é o que o gestor lê pra decidir.");
      return;
    }
    setEnviandoSolicitacao(true);
    setErroSolicitacao(null);
    try {
      await axios.post("/api/solicitacoes-excedente", {
        atividadeId,
        horasSolicitadas: minutos,
        motivo: motivoSolicitacao.trim(),
      });
      setAbrindoSolicitacao(false);
      setHorasSolicitadasInput("");
      setMotivoSolicitacao("");
      carregar();
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setErroSolicitacao(axiosErr.response?.data?.error ?? "Falha ao enviar a solicitação");
    } finally {
      setEnviandoSolicitacao(false);
    }
  }

  async function salvarExcedente() {
    const minutos = horasParaMinutos(excedenteInput);
    if (minutos == null || minutos < 0) {
      setErroExcedente("Informe as horas no formato H:MM (ou 0 para remover).");
      return;
    }
    setSalvandoExcedente(true);
    setErroExcedente(null);
    try {
      await axios.patch(`/api/atividades/${atividadeId}/horas-excedentes`, { horasExcedentes: minutos });
      onExcedenteAlterado?.();
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setErroExcedente(axiosErr.response?.data?.error ?? "Falha ao salvar as horas excedentes");
    } finally {
      setSalvandoExcedente(false);
    }
  }
  const [planejamentoSalvo, setPlanejamentoSalvo] = useState(false);

  function carregar() {
    setLoading(true);
    Promise.all([
      axios.get(`/api/atividades/${atividadeId}/comentarios`),
      axios.get(`/api/atividades/${atividadeId}/checklist`),
      axios.get(`/api/atividades/${atividadeId}/anexos`),
      axios.get(`/api/atividades/${atividadeId}/historico`),
      // Quem não é nem executor nem gestor da atividade leva 403 aqui — a lista fica
      // vazia e o resto do drawer segue carregando normalmente.
      axios.get(`/api/solicitacoes-excedente/atividade/${atividadeId}`).catch(() => ({ data: { solicitacoes: [] } })),
      axios.get(`/api/solicitacoes-apontamento/atividade/${atividadeId}`).catch(() => ({ data: { solicitacoes: [] } })),
    ])
      .then(([c, ch, a, h, s, ap]) => {
        setComentarios(c.data.comentarios);
        setChecklist(ch.data.itens);
        setAnexos(a.data.anexos);
        setHistorico(h.data.historico);
        setSolicitacoes(s.data.solicitacoes);
        setApontamentos(ap.data.solicitacoes);
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
              {/* Teto de apontamento DESTA alocação — separado do "Contexto do item"
                  abaixo, que fala do item da proposta inteiro. É aqui que o gestor libera
                  horas excedentes quando o planejado não bastou, sem falsear o planejado. */}
              <section>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Teto de apontamento</p>
                <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2.5">
                  <p className="font-mono text-[11.5px] text-muted">
                    Alocado {formatHorasCompacto(qtdhorPrevisto ?? 0, 2)}
                    {horasExcedentes > 0 && (
                      <>
                        {" + excedente "}
                        <span className="text-warning">{formatHorasCompacto(horasExcedentes, 2)}</span>
                      </>
                    )}
                    {" = teto "}
                    <span className="text-foreground">{formatHorasCompacto((qtdhorPrevisto ?? 0) + horasExcedentes, 2)}</span>
                  </p>

                  {podeAutorizarExcedente ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label htmlFor="excedente" className="text-[12px] text-muted">
                        Horas excedentes
                      </label>
                      <input
                        id="excedente"
                        value={excedenteInput}
                        onChange={(e) => setExcedenteInput(e.target.value)}
                        placeholder="0:00"
                        className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <button
                        onClick={salvarExcedente}
                        disabled={salvandoExcedente}
                        className="rounded-md bg-primary px-3 py-1 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {salvandoExcedente ? "Salvando..." : "Salvar"}
                      </button>
                      {erroExcedente && <span className="text-[12px] text-destructive">{erroExcedente}</span>}
                    </div>
                  ) : souOExecutor ? (
                    <div className="mt-2">
                      {pendente ? (
                        <p className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[12px] text-warning">
                          Solicitação de {formatHorasCompacto(pendente.horasSolicitadas, 2)} aguardando o gestor desde{" "}
                          {dateTimeFormatter.format(new Date(pendente.criadoEm))}.
                        </p>
                      ) : abrindoSolicitacao ? (
                        <div className="space-y-2 rounded-md border border-border bg-surface px-2.5 py-2">
                          <div className="flex items-center gap-2">
                            <label htmlFor="horas-solicitadas" className="text-[12px] text-muted">
                              Horas necessárias
                            </label>
                            <input
                              id="horas-solicitadas"
                              autoFocus
                              value={horasSolicitadasInput}
                              onChange={(e) => setHorasSolicitadasInput(e.target.value)}
                              placeholder="4:00"
                              className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          </div>
                          <textarea
                            value={motivoSolicitacao}
                            onChange={(e) => setMotivoSolicitacao(e.target.value)}
                            rows={3}
                            placeholder="Por que estas horas são necessárias?"
                            className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          {erroSolicitacao && <p className="text-[12px] text-destructive">{erroSolicitacao}</p>}
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setAbrindoSolicitacao(false)}
                              disabled={enviandoSolicitacao}
                              className="rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={enviarSolicitacao}
                              disabled={enviandoSolicitacao}
                              className="rounded-md bg-primary px-3 py-1 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                            >
                              {enviandoSolicitacao ? "Enviando..." : "Enviar solicitação"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAbrindoSolicitacao(true)}
                          className="rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground"
                        >
                          Solicitar horas excedentes
                        </button>
                      )}

                      {/* A última decisão fica à vista mesmo depois de aprovada: é onde a
                          pessoa confere quanto saiu, que pode ser menos do que pediu. */}
                      {!pendente && ultimaDecidida && (
                        <p className="mt-1.5 text-[11.5px] text-muted">
                          {ultimaDecidida.decisorNome}{" "}
                          {ultimaDecidida.status === "aprovada"
                            ? `aprovou ${formatHorasCompacto(ultimaDecidida.horasAprovadas ?? 0, 2)} das ${formatHorasCompacto(ultimaDecidida.horasSolicitadas, 2)} solicitadas`
                            : `reprovou o pedido de ${formatHorasCompacto(ultimaDecidida.horasSolicitadas, 2)}`}
                          {ultimaDecidida.observacaoDecisao && ` — "${ultimaDecidida.observacaoDecisao}"`}
                        </p>
                      )}
                    </div>
                  ) : (
                    horasExcedentes === 0 && (
                      <p className="mt-1 text-[11.5px] text-muted">
                        Precisa de mais horas? Peça ao gestor do departamento pra autorizar excedentes.
                      </p>
                    )
                  )}
                </div>
              </section>

              {/* Recuperar tempo trabalhado sem mover o card. Só aparece pra quem executa a
                  atividade — o gestor tem o apontamento manual, que grava direto. */}
              {souOExecutor && (
                <section>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">
                    Apontar horas não registradas
                  </p>
                  <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2.5">
                    {abrindoApontamento ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor="apont-data" className="text-[12px] text-muted">
                            Data
                          </label>
                          <input
                            id="apont-data"
                            type="date"
                            value={dataApontamento}
                            onChange={(e) => setDataApontamento(e.target.value)}
                            className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          <label htmlFor="apont-hora-inicio" className="text-[12px] text-muted">
                            das
                          </label>
                          <input
                            id="apont-hora-inicio"
                            type="time"
                            value={horaInicioApontamento}
                            onChange={(e) => setHoraInicioApontamento(e.target.value)}
                            className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          <label htmlFor="apont-hora-fim" className="text-[12px] text-muted">
                            às
                          </label>
                          <input
                            id="apont-hora-fim"
                            type="time"
                            value={horaFimApontamento}
                            onChange={(e) => setHoraFimApontamento(e.target.value)}
                            className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </div>
                        <input
                          value={motivoApontamento}
                          onChange={(e) => setMotivoApontamento(e.target.value)}
                          placeholder="Motivo — por que não foi registrado no quadro"
                          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <textarea
                          value={descricaoApontamento}
                          onChange={(e) => setDescricaoApontamento(e.target.value)}
                          rows={3}
                          placeholder="O que foi realizado neste período"
                          className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        {erroApontamento && <p className="text-[12px] text-destructive">{erroApontamento}</p>}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setAbrindoApontamento(false)}
                            disabled={enviandoApontamento}
                            className="rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={enviarApontamento}
                            disabled={enviandoApontamento}
                            className="rounded-md bg-primary px-3 py-1 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            {enviandoApontamento ? "Enviando..." : "Enviar para aprovação"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="mb-2 text-[11.5px] text-muted">
                          Trabalhou e esqueceu de mover o card? Peça o apontamento aqui. Depois que o gestor aprovar, ele
                          aparece em Meus Apontamentos pra você confirmar.
                        </p>
                        <button
                          onClick={() => setAbrindoApontamento(true)}
                          className="rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground"
                        >
                          Solicitar apontamento
                        </button>
                      </>
                    )}

                    {apontamentos.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {apontamentos.map((a) => (
                          <li key={a.id} className="text-[11.5px] text-muted">
                            <span
                              className={
                                a.status === "aprovada"
                                  ? "text-success"
                                  : a.status === "reprovada"
                                    ? "text-destructive"
                                    : "text-warning"
                              }
                            >
                              {a.status}
                            </span>{" "}
                            · {dateTimeFormatter.format(new Date(a.inicioAprovado ?? a.inicioSolicitado))} –{" "}
                            {dateTimeFormatter.format(new Date(a.fimAprovado ?? a.fimSolicitado))}
                            {a.decisorNome && ` · ${a.decisorNome}`}
                            {a.observacaoDecisao && ` — "${a.observacaoDecisao}"`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              )}

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
                      {/* Evento sem coluna de destino (ex.: liberação de horas excedentes) já
                          vem com a frase pronta do servidor. */}
                      {h.colunaNovaNome == null
                        ? h.descricao
                        : `${h.colunaAnteriorNome ? `moveu de "${h.colunaAnteriorNome}" para` : "definiu como"} "${h.colunaNovaNome}"`}
                      {" · "}
                      {dateTimeFormatter.format(new Date(h.movidoEm))}
                    </p>
                  ))}
                  {historico.length === 0 && <p className="text-[12.5px] text-muted">Sem registros no histórico.</p>}
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
