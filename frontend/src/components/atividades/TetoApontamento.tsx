import axios from "axios";
import { useEffect, useState } from "react";
import { formatHorasCompacto } from "../../lib/cronograma";
import { horasParaMinutos, minutosParaInputHoras } from "../../utils/horas";

// Mesmo shape de SolicitacaoExcedente em AtividadeDetalhe.tsx — só os campos que este
// card usa (pendente/última decisão), sem os de contexto de proposta/departamento que só
// fazem sentido na listagem de Aprovações.
interface SolicitacaoExcedenteResumo {
  id: number;
  status: "pendente" | "aprovada" | "reprovada";
  horasSolicitadas: number;
  horasAprovadas: number | null;
  observacaoDecisao: string | null;
  criadoEm: string;
  decisorNome: string | null;
}

interface TetoApontamentoProps {
  // Id da AtividadeConsultor (a alocação em si) — mesma chave que
  // PATCH /atividades/:id/horas-excedentes e /api/solicitacoes-excedente esperam.
  atividadeConsultorId: number;
  // Horas alocadas (planejado) desta alocação — junto com o excedente, forma o teto.
  qtdhorPrevisto: number | null;
  horasExcedentesAtuais: number;
  // Só o gestor do departamento autoriza excedente direto; quem executa só solicita.
  podeAutorizarExcedente: boolean;
  souOExecutor: boolean;
  // Avisa o pai pra recarregar (o teto/o realizado mudaram) — no Cronograma, dispara
  // recarregar() do useCronograma pra atualizar o badge de excedente na árvore.
  onAlterado?: () => void;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Teto de apontamento de UMA alocação (AtividadeConsultor) — extraído do mesmo bloco já
// usado em AtividadeDetalhe.tsx (Kanban/Lista/Calendário/Timeline/MeusApontamentos) pra
// também aparecer na edição de estrutura/atividade do Cronograma (DrawerAtividade), sem
// duplicar a lógica de autorizar/solicitar excedente. Gestor autoriza direto
// (PATCH /atividades/:id/horas-excedentes); quem executa solicita e o gestor decide depois
// em /projetos/aprovacoes (POST /solicitacoes-excedente).
export function TetoApontamento({
  atividadeConsultorId,
  qtdhorPrevisto,
  horasExcedentesAtuais,
  podeAutorizarExcedente,
  souOExecutor,
  onAlterado,
}: TetoApontamentoProps) {
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoExcedenteResumo[]>([]);
  const [excedenteInput, setExcedenteInput] = useState(minutosParaInputHoras(horasExcedentesAtuais));
  const [salvandoExcedente, setSalvandoExcedente] = useState(false);
  const [erroExcedente, setErroExcedente] = useState<string | null>(null);

  const [abrindoSolicitacao, setAbrindoSolicitacao] = useState(false);
  const [horasSolicitadasInput, setHorasSolicitadasInput] = useState("");
  const [motivoSolicitacao, setMotivoSolicitacao] = useState("");
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const [erroSolicitacao, setErroSolicitacao] = useState<string | null>(null);

  const pendente = solicitacoes.find((s) => s.status === "pendente") ?? null;
  const ultimaDecidida = solicitacoes.find((s) => s.status !== "pendente") ?? null;

  function carregarSolicitacoes() {
    // Quem não é nem executor nem gestor da atividade leva 403 aqui — fica vazio, sem
    // travar o resto do card (mesmo tratamento de AtividadeDetalhe.tsx).
    axios
      .get(`/api/solicitacoes-excedente/atividade/${atividadeConsultorId}`)
      .then(({ data }) => setSolicitacoes(data.solicitacoes))
      .catch(() => setSolicitacoes([]));
  }

  useEffect(() => {
    setExcedenteInput(minutosParaInputHoras(horasExcedentesAtuais));
    setErroExcedente(null);
    setAbrindoSolicitacao(false);
    setErroSolicitacao(null);
    carregarSolicitacoes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atividadeConsultorId]);

  async function salvarExcedente() {
    const minutos = horasParaMinutos(excedenteInput);
    if (minutos == null || minutos < 0) {
      setErroExcedente("Informe as horas no formato H:MM (ou 0 para remover).");
      return;
    }
    setSalvandoExcedente(true);
    setErroExcedente(null);
    try {
      await axios.patch(`/api/atividades/${atividadeConsultorId}/horas-excedentes`, { horasExcedentes: minutos });
      onAlterado?.();
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setErroExcedente(axiosErr.response?.data?.error ?? "Falha ao salvar as horas excedentes");
    } finally {
      setSalvandoExcedente(false);
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
        atividadeId: atividadeConsultorId,
        horasSolicitadas: minutos,
        motivo: motivoSolicitacao.trim(),
      });
      setAbrindoSolicitacao(false);
      setHorasSolicitadasInput("");
      setMotivoSolicitacao("");
      carregarSolicitacoes();
      onAlterado?.();
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setErroSolicitacao(axiosErr.response?.data?.error ?? "Falha ao enviar a solicitação");
    } finally {
      setEnviandoSolicitacao(false);
    }
  }

  return (
    <section>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Teto de apontamento</p>
      <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2.5">
        <p className="font-mono text-[11.5px] text-muted">
          Alocado {formatHorasCompacto(qtdhorPrevisto ?? 0, 2)}
          {horasExcedentesAtuais > 0 && (
            <>
              {" + excedente "}
              <span className="text-warning">{formatHorasCompacto(horasExcedentesAtuais, 2)}</span>
            </>
          )}
          {" = teto "}
          <span className="text-foreground">{formatHorasCompacto((qtdhorPrevisto ?? 0) + horasExcedentesAtuais, 2)}</span>
        </p>

        {podeAutorizarExcedente ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor={`excedente-${atividadeConsultorId}`} className="text-[12px] text-muted">
              Horas excedentes
            </label>
            <input
              id={`excedente-${atividadeConsultorId}`}
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
                  <label htmlFor={`horas-solicitadas-${atividadeConsultorId}`} className="text-[12px] text-muted">
                    Horas necessárias
                  </label>
                  <input
                    id={`horas-solicitadas-${atividadeConsultorId}`}
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

            {/* A última decisão fica à vista mesmo depois de aprovada: é onde a pessoa
                confere quanto saiu, que pode ser menos do que pediu. */}
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
          horasExcedentesAtuais === 0 && (
            <p className="mt-1 text-[11.5px] text-muted">Precisa de mais horas? Peça ao gestor do departamento pra autorizar excedentes.</p>
          )
        )}
      </div>
    </section>
  );
}
