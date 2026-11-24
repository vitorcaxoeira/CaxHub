import cron from "node-cron";
import { prisma } from "../db/prisma";
import { hojeIso } from "../domain/eficienciaAcoes";
import { criarNotificacao, notificarConsultorPorCodfor } from "../domain/notificacoes";

// Avisa, pelo sino, a ação do Plano de ação (Painel de Eficiência) que passou do prazo sem ser concluída: ao responsável e a
// quem criou. Cada ação é avisada UMA vez (`avisoVencidaEm`); mudar o prazo ou o responsável zera isso (ver a rota de edição).
//
// Roda de hora em hora, em dias úteis, e não uma vez só: se o servidor estiver fora do ar às 07:30 (deploy, reinício), a
// próxima tentativa pega. É barato (uma consulta indexada) e o `avisoVencidaEm` impede repetição.
const CRON_EXPR = "30 7-18 * * 1-5";

export interface ResultadoAvisoVencidas {
  analisadas: number;
  avisadas: number;
}

export async function avisarAcoesVencidas(agora: Date = new Date()): Promise<ResultadoAvisoVencidas> {
  const hoje = hojeIso(agora);
  const vencidas = await prisma.acaoEficiencia.findMany({
    where: { status: { not: "concluida" }, avisoVencidaEm: null, prazo: { lt: new Date(`${hoje}T00:00:00.000Z`) } },
  });

  let avisadas = 0;
  for (const acao of vencidas) {
    // Reserva a ação ANTES de avisar: duas execuções ao mesmo tempo (ou um reinício no meio) não avisam duas vezes.
    // Se o aviso falhar depois, perde-se um aviso (registrado no log) em vez de repetir indefinidamente.
    const reserva = await prisma.acaoEficiencia.updateMany({ where: { id: acao.id, avisoVencidaEm: null }, data: { avisoVencidaEm: agora } });
    if (reserva.count === 0) continue;
    avisadas++;
    try {
      const prazo = acao.prazo.toISOString().slice(0, 10).split("-").reverse().join("/");
      const titulo = acao.titulo.length > 120 ? `${acao.titulo.slice(0, 117)}...` : acao.titulo;
      const userResponsavel = await notificarConsultorPorCodfor(
        acao.responsavelCodfor,
        "acao_eficiencia_vencida",
        `A ação “${titulo}” venceu em ${prazo}. Atualize o status ou fale com o seu gestor.`
      );
      // O gestor que criou a ação também é avisado, a menos que seja a própria pessoa responsável (já avisada acima).
      if (acao.criadoPor !== userResponsavel) {
        await criarNotificacao(acao.criadoPor, "acao_eficiencia_vencida_gestor", `A ação “${titulo}” venceu em ${prazo} e ainda não foi concluída.`);
      }
    } catch (error) {
      console.error(`[acoes-eficiencia-vencidas] falha ao avisar a ação ${acao.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return { analisadas: vencidas.length, avisadas };
}

export function agendarAcoesVencidas() {
  // Fuso explícito: o container pode estar em UTC e "07:30" tem que ser a manhã de São Paulo.
  cron.schedule(
    CRON_EXPR,
    () => {
      avisarAcoesVencidas().catch((error) => {
        console.error("[acoes-eficiencia-vencidas] erro na varredura:", error instanceof Error ? error.message : error);
      });
    },
    { timezone: "America/Sao_Paulo" }
  );
}
