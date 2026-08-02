import { AtividadeConsultor, AtividadeSessaoExecucao, JornadaConsultor } from "@prisma/client";
import { realizadoDaAtividade, tetoDaAtividade } from "./tetoAtividade";
import { limitePorExpediente } from "./jornadaConsultor";

// Até quando uma sessão de execução ABERTA pode contar.
//
// Fonte única de TRÊS consumidores: a varredura que fecha sessão esquecida, a listagem
// (que manda o instante pro cronômetro do card travar nele) e a rota de baixa imediata.
// Se cada um calculasse por conta própria, o cronômetro travaria numa hora e o servidor
// fecharia em outra — e o consultor veria o tempo "voltar" ao recarregar a tela.

export type MotivoLimite = "teto_atingido" | "fora_do_expediente";

export interface LimiteSessao {
  instante: Date;
  motivo: MotivoLimite;
}

// Instante em que a sessão estoura o teto de apontamento, ou null se não há teto.
// `realizado` não inclui a sessão aberta (ver realizadoDaAtividade), então o saldo é
// exatamente o que ela ainda pode consumir.
async function limitePorTeto(
  inicioSessao: Date,
  atividade: Pick<AtividadeConsultor, "id" | "seqati" | "qtdhor" | "horasExcedentes">
): Promise<Date | null> {
  const teto = tetoDaAtividade(atividade);
  // Atividade sem alocação nenhuma não tem teto pra estourar — barrar aqui pararia todo
  // card de atividade ainda não dimensionada no instante em que fosse iniciado.
  if (teto <= 0) return null;
  const saldo = teto - (await realizadoDaAtividade(atividade));
  // Saldo já zerado ou negativo antes desta sessão: o limite é o próprio início, então a
  // sessão fecha com duração zero e não vira apontamento.
  return new Date(inicioSessao.getTime() + Math.max(0, saldo) * 60_000);
}

// Tolerância entre o fim do expediente e o encerramento de fato: a janela em que o
// consultor é perguntado se ainda está trabalhando. Só vale pro expediente — teto de horas
// encerra no instante, porque ali não há o que responder, as horas acabaram.
export const TOLERANCIA_RESPOSTA_MIN = 5;

// Vale o MENOR dos dois limites — quem chegar primeiro para a sessão. Cada um pode estar
// ausente: sem alocação não há teto, sem jornada cadastrada não há expediente. `null` =
// nada limita esta sessão.
export async function limiteDaSessaoAberta(
  sessao: Pick<AtividadeSessaoExecucao, "inicio" | "expedienteProrrogadoAte">,
  atividade: Pick<AtividadeConsultor, "id" | "seqati" | "qtdhor" | "horasExcedentes">,
  jornada: JornadaConsultor | null
): Promise<LimiteSessao | null> {
  const inicioSessao = sessao.inicio;
  const porTeto = await limitePorTeto(inicioSessao, atividade);

  // Prorrogação empurra SÓ o expediente. O consultor confirma "ainda estou trabalhando" e
  // ganha o tempo que escolheu; o teto segue onde estava, porque estender aquele limite é
  // autorização do gestor, não declaração de quem executa.
  const fimDoPeriodo = limitePorExpediente(inicioSessao, jornada);
  const prorrogado = sessao.expedienteProrrogadoAte;
  const porExpediente =
    prorrogado != null && (fimDoPeriodo == null || prorrogado.getTime() > fimDoPeriodo.getTime()) ? prorrogado : fimDoPeriodo;

  if (porTeto == null && porExpediente == null) return null;
  if (porTeto == null) return { instante: porExpediente!, motivo: "fora_do_expediente" };
  if (porExpediente == null) return { instante: porTeto, motivo: "teto_atingido" };

  // Empate resolve pra teto: quando os dois caem no mesmo instante é porque o saldo já
  // estava zerado, e "acabaram as horas" é o recado acionável — o gestor pode liberar
  // excedente, mas ninguém estende o expediente pra caber uma tarefa.
  return porTeto.getTime() <= porExpediente.getTime()
    ? { instante: porTeto, motivo: "teto_atingido" }
    : { instante: porExpediente, motivo: "fora_do_expediente" };
}

// Instante a partir do qual a sessão pode ser encerrada de fato. Para o expediente é o
// limite mais a tolerância — a janela em que o alerta espera resposta; para o teto é o
// próprio limite.
export function prazoDeEncerramento(limite: LimiteSessao): Date {
  if (limite.motivo !== "fora_do_expediente") return limite.instante;
  return new Date(limite.instante.getTime() + TOLERANCIA_RESPOSTA_MIN * 60_000);
}

export const MENSAGEM_MOTIVO: Record<MotivoLimite, string> = {
  teto_atingido: "Teto de horas atingido — a execução foi encerrada automaticamente.",
  fora_do_expediente: "Fim do expediente — a execução foi encerrada automaticamente.",
};
