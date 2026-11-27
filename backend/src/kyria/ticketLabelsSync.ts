import cron from "node-cron";
import { prisma } from "../db/prisma";
import { jobAtivo } from "./jobAtivo";
import { listAllTicketLabels, type KyriaTicketLabel } from "./client";
import { comLeitura } from "./registroLeitura";
import { mesesDoFiltro } from "./customerHoursSync";

export const JOB_NAME = "kyria-ticket-labels-sync";
// Depois do feed de apontamentos (6:15): é ele que diz quais chamados reler.
export const CRON_EXPR = "30 6 * * *";

// Etiquetas de CADA chamado (GET /tickets/{ticketId}/labels: uma chamada por chamado). É de onde sai a "área do chamado" (grupo de etiqueta
// de chave `area`). Aplicar uma etiqueta NÃO muda o updatedAt do chamado (conferido em 27/11/2026), então não há como pedir só o que mudou:
// o job relê os chamados que tiveram apontamento na janela. O período do "Sinc. Filtros" serve para a carga inicial e recargas.
const JANELA_DIAS = 35;
// A API aceita 60 requisições por minuto por chave: uma a cada 1,1 s deixa folga e evita viver no 429.
const INTERVALO_MS = 1100;
// Falha de um chamado (apagado no Kyria, instabilidade pontual) não derruba a carga; muitas seguidas = API fora, aí para.
const MAX_FALHAS_SEGUIDAS = 10;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Filtros = { from?: string; to?: string };

/** Chamados com apontamento iniciado no período (dias de Brasília) ou, sem filtro, nos últimos 35 dias. Mais recentes primeiro. */
export async function chamadosParaReler(filtros?: Filtros): Promise<string[]> {
  let linhas: { ticket_id: string }[];
  if (filtros?.from || filtros?.to) {
    const meses = mesesDoFiltro(filtros);
    const de = meses[0].from;
    const ate = meses[meses.length - 1].to;
    linhas = await prisma.$queryRaw`
      SELECT ticket_id FROM kyria_time_entries
      WHERE (started_at AT TIME ZONE 'America/Sao_Paulo') >= ${de}::date AND (started_at AT TIME ZONE 'America/Sao_Paulo') < ${ate}::date + 1
      GROUP BY ticket_id ORDER BY max(started_at) DESC`;
  } else {
    linhas = await prisma.$queryRaw`
      SELECT ticket_id FROM kyria_time_entries
      WHERE started_at >= now() - make_interval(days => ${JANELA_DIAS}::int)
      GROUP BY ticket_id ORDER BY max(started_at) DESC`;
  }
  return linhas.map((l) => l.ticket_id);
}

/** Troca as etiquetas do chamado pelas atuais (etiqueta retirada no Kyria sai daqui também). */
export async function gravarEtiquetasDoChamado(ticketId: string, etiquetas: KyriaTicketLabel[]): Promise<void> {
  await prisma.$transaction([
    prisma.kyriaTicketLabel.deleteMany({ where: { ticketId } }),
    prisma.kyriaTicketLabel.createMany({
      data: etiquetas.map((e) => ({ ticketId, labelId: e.labelId, groupId: e.groupId, appliedAt: e.appliedAt ? new Date(e.appliedAt) : null })),
      skipDuplicates: true,
    }),
  ]);
}

export async function runKyriaTicketLabelsSync(filtros?: Filtros): Promise<void> {
  if (!(await jobAtivo(JOB_NAME))) return;
  const inicio = new Date();
  const periodo = filtros?.from || filtros?.to ? `apontamentos de ${filtros.from} a ${filtros.to}` : `apontamentos dos últimos ${JANELA_DIAS} dias`;
  const query = `GET /tickets/{ticketId}/labels (${periodo})`;
  try {
    const ids = await chamadosParaReler(filtros);
    let lidos = 0;
    let etiquetas = 0;
    let falhas = 0;
    let ultimaFalha = "";
    await comLeitura({ jobName: JOB_NAME, recurso: "/tickets/{ticketId}/labels", paginado: false }, async (leitura) => {
      let seguidas = 0;
      for (const ticketId of ids) {
        const t0 = Date.now();
        try {
          const atuais = await listAllTicketLabels(ticketId, { leitura });
          await gravarEtiquetasDoChamado(ticketId, atuais);
          lidos++;
          etiquetas += atuais.length;
          seguidas = 0;
        } catch (erro) {
          falhas++;
          seguidas++;
          ultimaFalha = erro instanceof Error ? erro.message : String(erro);
          if (seguidas >= MAX_FALHAS_SEGUIDAS) throw new Error(`${seguidas} chamados seguidos falharam, leitura interrompida (${lidos} de ${ids.length} lidos). Última falha: ${ultimaFalha}`);
        }
        await esperar(Math.max(0, INTERVALO_MS - (Date.now() - t0)));
      }
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        // Nada lido com falha = erro; falha pontual aparece na mensagem.
        status: falhas > 0 && lidos === 0 ? "error" : "success",
        message:
          `${lidos} de ${ids.length} chamados, ${etiquetas} etiquetas em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s` +
          (falhas > 0 ? ` — ${falhas} chamado(s) com falha (última: ${ultimaFalha})` : ""),
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleKyriaTicketLabelsSync(): void {
  cron.schedule(CRON_EXPR, () => void runKyriaTicketLabelsSync());
}
