import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";

// Vive dentro do AppShell, então acompanha o consultor em QUALQUER tela — o fim do
// expediente raramente pega a pessoa justamente no quadro de atividades.
//
// Ao bater o fim da jornada, a sessão em execução não é mais encerrada direto: o consultor
// é perguntado se ainda está trabalhando e escolhe por quanto tempo continuar. Sem resposta
// dentro da tolerância, aí sim ela é encerrada — e registrada NO FIM DO EXPEDIENTE, não no
// momento da desistência (o recorte é do servidor, ver domain/limiteSessao.ts).
//
// Só o teto de horas continua encerrando na hora, sem pergunta: ali não há o que responder,
// as horas acabaram, e liberar mais é autorização do gestor.

interface SessaoVigiada {
  atividadeId: number;
  codpro: number;
  inicio: string;
  limite: string | null;
  motivo: "teto_atingido" | "fora_do_expediente" | null;
  prazoResposta: string | null;
  prorrogavel: boolean;
  /** A sessão nasceu fora do expediente — muda o texto: nada "terminou", ela começou fora. */
  iniciouForaDoExpediente: boolean;
  opcoesProrrogacao: number[];
  /** Descrição da atividade — abre o "O que foi feito?" já preenchido. */
  descricaoPadrao: string | null;
}

const INTERVALO_CONSULTA_MS = 30_000;

// O vigia mora no AppShell e a lista de atividades mora numa rota — não há estado
// compartilhado entre eles. Sem este aviso, prorrogar atualizava só o vigia: o card
// continuava com o `sessaoLimite` antigo e o cronômetro seguia congelado no limite
// vencido, mesmo depois do consultor confirmar que ia trabalhar mais 15 minutos.
export const EVENTO_SESSAO_ALTERADA = "caxhub:sessao-alterada";

export function avisarSessaoAlterada() {
  window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_ALTERADA));
}

function formatarContagem(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function VigiaFimDeJornada() {
  const [sessao, setSessao] = useState<SessaoVigiada | null>(null);
  const [minutos, setMinutos] = useState(15);
  const [enviando, setEnviando] = useState(false);
  // Passo 2 do alerta: quem clica "Encerrar agora" descreve o que fez, igual ao Parar
  // normal. O encerramento por silencio nao passa por aqui -- nao ha quem digite.
  const [descrevendo, setDescrevendo] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [agora, setAgora] = useState(() => Date.now());
  const toast = useToast();
  // Evita disparar o encerramento duas vezes pra mesma sessão enquanto a consulta seguinte
  // não volta. A chave inclui o início, pra uma sessão NOVA poder ser encerrada depois.
  const encerrando = useRef<string | null>(null);

  const consultar = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/atividades/minha-sessao-aberta");
      setSessao(data.sessao);
    } catch {
      // Silencioso de propósito: é um vigia de fundo em toda tela do sistema. Falha de
      // rede aqui não pode virar erro na cara de quem está fazendo outra coisa.
    }
  }, []);

  useEffect(() => {
    consultar();
    const intervalo = setInterval(consultar, INTERVALO_CONSULTA_MS);
    // Iniciar uma atividade fora do expediente tem de abrir o alerta NA HORA, nao no
    // proximo tique de 30s: o limite ja nasce vencido e o consultor ficaria olhando um
    // cronometro travado sem entender por que.
    window.addEventListener(EVENTO_SESSAO_ALTERADA, consultar);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener(EVENTO_SESSAO_ALTERADA, consultar);
    };
  }, [consultar]);

  // Relógio de 1s só enquanto há sessão vigiada — é o que faz a contagem regressiva andar.
  useEffect(() => {
    if (!sessao) return;
    const intervalo = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(intervalo);
  }, [sessao]);

  const limiteMs = sessao?.limite ? new Date(sessao.limite).getTime() : null;
  const prazoMs = sessao?.prazoResposta ? new Date(sessao.prazoResposta).getTime() : null;
  // O modal só existe pro limite de expediente: teto encerra sem perguntar.
  const perguntando = sessao?.prorrogavel === true && limiteMs != null && agora >= limiteMs;
  const restante = prazoMs != null ? prazoMs - agora : 0;

  const encerrar = useCallback(
    async (imediato: boolean, texto?: string) => {
      if (!sessao) return;
      const chave = `${sessao.atividadeId}-${sessao.inicio}`;
      if (encerrando.current === chave) return;
      encerrando.current = chave;
      setEnviando(true);
      try {
        const { data } = await axios.post(`/api/atividades/${sessao.atividadeId}/encerrar-automatico`, {
          imediato,
          observacao: texto,
        });
        if (data?.encerrada) toast.mostrar(`Proposta ${sessao.codpro}: ${data.mensagem}`, "warning");
        setSessao(null);
        setDescrevendo(false);
        setObservacao("");
        avisarSessaoAlterada();
      } catch {
        // O servidor recalculou e recusou — deixa o vigia tentar de novo no próximo tique.
        encerrando.current = null;
      } finally {
        setEnviando(false);
      }
    },
    [sessao, toast]
  );

  // Passou a tolerância sem resposta: encerra. A varredura do servidor faria isso de
  // qualquer forma em até 5 minutos; aqui é imediato porque a tela está aberta.
  useEffect(() => {
    if (perguntando && restante <= 0) encerrar(false);
  }, [perguntando, restante, encerrar]);

  async function prorrogar() {
    if (!sessao) return;
    setEnviando(true);
    try {
      await axios.post(`/api/atividades/${sessao.atividadeId}/prorrogar-expediente`, { minutos });
      toast.mostrar(`Execução prorrogada por ${minutos} minutos.`, "neutral");
      // Recarrega o limite: o vigia volta a perguntar quando o tempo novo vencer. O aviso
      // e o que destrava o cronometro do card, que ainda esta com o limite antigo.
      await consultar();
      avisarSessaoAlterada();
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao prorrogar a execução", "destructive");
      await consultar();
    } finally {
      setEnviando(false);
    }
  }

  if (!sessao || !perguntando) return null;

  // Passo 2 — descrever o que foi feito antes de encerrar, igual ao Parar normal.
  if (descrevendo) {
    return (
      <Modal
        open
        onClose={() => setDescrevendo(false)}
        fecharPorFora={false}
        title="O que foi feito?"
        subtitulo={`Proposta ${sessao.codpro}`}
      >
        <div className="space-y-4 p-4">
          <textarea
            autoFocus
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            placeholder="Descreva rapidamente o que foi realizado (opcional)..."
            className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setDescrevendo(false)}
              disabled={enviando}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
            >
              Voltar
            </button>
            <button
              onClick={() => encerrar(true, observacao.trim())}
              disabled={enviando}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {enviando && <Spinner className="h-3.5 w-3.5" />}
              Encerrar execução
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // "o expediente terminou" seria falso pra quem começou às 22h de um sábado — ali nada
  // terminou, a atividade é que nasceu fora do horário.
  const subtitulo = sessao.iniciouForaDoExpediente
    ? `Proposta ${sessao.codpro} — esta atividade está sendo iniciada FORA do seu expediente.`
    : `Proposta ${sessao.codpro} — o expediente terminou e a execução será encerrada.`;

  return (
    <Modal
      open
      // Sem fechar por Esc/backdrop: a pergunta tem consequência (a sessão é encerrada em
      // poucos minutos), então precisa de uma resposta explícita.
      onClose={() => {}}
      title="Você ainda está trabalhando?"
      subtitulo={subtitulo}
    >
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted">
          Sem resposta em{" "}
          <span className="font-mono font-semibold tabular-nums text-destructive">{formatarContagem(restante)}</span>, a
          execução é encerrada{sessao.iniciouForaDoExpediente ? " sem tempo registrado" : " e o tempo registrado até o fim do expediente"}.
        </p>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-muted">Continuar por mais</span>
          <select
            value={minutos}
            onChange={(e) => setMinutos(Number(e.target.value))}
            disabled={enviando}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sessao.opcoesProrrogacao.map((m) => (
              <option key={m} value={m}>
                {m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} minutos`}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => {
              // Abre já com a descrição da atividade, igual ao modal de parar no quadro.
              setObservacao(sessao.descricaoPadrao ?? "");
              setDescrevendo(true);
            }}
            disabled={enviando}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            Encerrar agora
          </button>
          <button
            onClick={prorrogar}
            disabled={enviando}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {enviando && <Spinner className="h-3.5 w-3.5" />}
            Sim, continuo trabalhando
          </button>
        </div>
      </div>
    </Modal>
  );
}
