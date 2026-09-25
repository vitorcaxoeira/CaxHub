import cron from "node-cron";
import { prisma } from "../db/prisma";
import { getHoursReport } from "./client";
import { intervaloDaCompetencia } from "./competencia";
import { jobAtivo } from "./jobAtivo";

export const JOB_NAME = "kyria-customer-hours-sync";
// Depois de clientes (5:00) — a FK de KyriaCustomerHours.customerId exige o cliente local.
export const CRON_EXPR = "0 6 * * *";

export interface FiltrosCustomerHours {
  /** YYYY-MM-DD — precisa ser o dia 01 de um mês. */
  from?: string;
  /** YYYY-MM-DD — precisa ser o último dia de um mês. */
  to?: string;
}

interface Competencia {
  from: string;
  to: string;
}

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function partesDaData(valor: string, rotulo: string): { ano: number; mes: number; dia: number } {
  const m = DATA_ISO.exec(valor);
  if (!m) throw new Error(`"${rotulo}" inválido: use o formato AAAA-MM-DD`);
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

/**
 * Regra de negócio (24/09/2026): from/to sempre cobrem MESES COMPLETOS — `from` é o dia 01 e
 * `to` o último dia do mês. Um intervalo de vários meses vira uma consulta por mês, porque cada
 * mês é uma competência (parte da chave). Lança se o filtro violar a regra.
 */
export function mesesDoFiltro(filtros: FiltrosCustomerHours): Competencia[] {
  if (!filtros.from || !filtros.to) throw new Error("Informe from e to");
  const de = partesDaData(filtros.from, "from");
  const ate = partesDaData(filtros.to, "to");

  if (de.dia !== 1) throw new Error("from precisa ser o dia 01 do mês (competência é sempre o mês completo)");
  const fimEsperado = intervaloDaCompetencia(ate.ano, ate.mes).to;
  if (filtros.to !== fimEsperado) throw new Error(`to precisa ser o último dia do mês (${fimEsperado})`);
  if (de.ano * 12 + de.mes > ate.ano * 12 + ate.mes) throw new Error("from não pode ser depois de to");

  const meses: Competencia[] = [];
  for (let indice = de.ano * 12 + de.mes - 1; indice <= ate.ano * 12 + ate.mes - 1; indice++) {
    meses.push(intervaloDaCompetencia(Math.floor(indice / 12), (indice % 12) + 1));
  }
  return meses;
}

/**
 * Filtro do job automático: parte do mês da ÚLTIMA sincronização bem-sucedida e vai até o mês
 * corrente (cada um completo). Assim o mês vira fechado com o dado final ao virar o mês, e o
 * mês novo já começa a ser acumulado. Sem sync anterior, só o mês corrente.
 */
async function filtroAutomatico(): Promise<Competencia[]> {
  const ultimo = await prisma.syncLog.findFirst({
    where: { jobName: JOB_NAME, status: "success" },
    orderBy: { runAt: "desc" },
    select: { runAt: true },
  });
  const agora = new Date();
  const base = ultimo?.runAt ?? agora;
  const from = intervaloDaCompetencia(base.getFullYear(), base.getMonth() + 1).from;
  const to = intervaloDaCompetencia(agora.getFullYear(), agora.getMonth() + 1).to;
  return mesesDoFiltro({ from, to });
}

export async function runKyriaCustomerHoursSync(filtros?: FiltrosCustomerHours): Promise<void> {
  if (!(await jobAtivo(JOB_NAME))) return;
  const inicio = new Date();
  let query = "GET /reports/hours?groupBy=customer";
  try {
    const meses = filtros?.from || filtros?.to ? mesesDoFiltro(filtros) : await filtroAutomatico();
    query = `GET /reports/hours?groupBy=customer&from=${meses[0].from}&to=${meses[meses.length - 1].to}`;

    let total = 0;
    let puladas = 0;
    let semClienteLinhas = 0;
    let semClienteMinutos = 0;
    for (const mes of meses) {
      const relatorio = await getHoursReport({ from: mes.from, to: mes.to, groupBy: "customer" });
      const linhas = relatorio.data.rows;

      // FK real pra kyria_customers: cliente ainda não sincronizado localmente é pulado (e
      // contado no log) em vez de derrubar a transação inteira por causa de 1 linha.
      // Achado ao vivo (24/09/2026): o relatório traz uma linha com `group.id` NULL — horas de
      // tickets sem cliente. Não tem como virar PK/FK, então não é gravada; os minutos entram no
      // log (`semCliente`) pra não sumirem sem rastro.
      const comCliente = linhas.filter((l): l is typeof l & { group: { id: string } } => l.group.id !== null);
      semClienteLinhas += linhas.length - comCliente.length;
      semClienteMinutos += linhas.filter((l) => l.group.id === null).reduce((soma, l) => soma + l.minutes, 0);

      const ids = [...new Set(comCliente.map((l) => l.group.id))];
      const existentes = ids.length
        ? new Set((await prisma.kyriaCustomer.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((c) => c.id))
        : new Set<string>();
      const validas = comCliente.filter((l) => existentes.has(l.group.id));
      puladas += comCliente.length - validas.length;

      const competencia = new Date(`${mes.from}T00:00:00Z`);
      await prisma.$transaction([
        // Total do mês SUBSTITUI o anterior: cliente que deixou de ter horas no mês (apontamento
        // apagado/movido no Kyria) sai daqui também.
        prisma.kyriaCustomerHours.deleteMany({ where: { competencia, customerId: { notIn: validas.map((l) => l.group.id) } } }),
        ...validas.map((linha) =>
          prisma.kyriaCustomerHours.upsert({
            where: { competencia_customerId: { competencia, customerId: linha.group.id } },
            create: { competencia, customerId: linha.group.id, groupType: linha.group.type, groupName: linha.group.name, minutes: linha.minutes },
            update: { groupType: linha.group.type, groupName: linha.group.name, minutes: linha.minutes },
          })
        ),
      ]);
      total += validas.length;
    }

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${total} linhas cliente/competência (${meses.length} ${meses.length === 1 ? "mês" : "meses"}) em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s` +
          (puladas > 0 ? ` — ${puladas} puladas (cliente ainda não sincronizado localmente)` : "") +
          (semClienteLinhas > 0 ? ` — ${semClienteMinutos.toFixed(2)} min sem cliente no Kyria (não gravados)` : ""),
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

export function scheduleKyriaCustomerHoursSync(): void {
  cron.schedule(CRON_EXPR, () => runKyriaCustomerHoursSync());
}
