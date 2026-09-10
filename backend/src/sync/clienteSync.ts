import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { carimbo, executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "cliente-sync";
export const CRON_EXPR = "20 3 * * *";
export const CAMPO_DATA: string | null = "DatAtu";
export const BASE_QUERY =`SELECT
  codcli AS codcli, nomcli AS nomcli, apecli AS apecli, sencli AS sencli,
  tipcli AS tipcli, tipmer AS tipmer, tipemc AS tipemc, codram AS codram,
  insest AS insest, cgccpf AS cgccpf, endcli AS endcli, cplend AS cplend,
  cepcli AS cepcli, baicli AS baicli, cidcli AS cidcli, sigufs AS sigufs,
  codpai AS codpai
FROM e085cli`;

// Fase 1 do plano de filtros na importação: a montagem passa a ser um acumulador de
// predicados (sync/consultaSenior.ts), não concatenação — lista vazia devolve BASE_QUERY
// intacta, byte a byte. `predicados` ganha mais itens quando a Fase 3 ligar
// sync/filtrosAtivos.ts; nenhuma mudança de comportamento até lá.
function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  // Pedido do Vitor (21/08/2026): se o admin já salvou um predicado explícito no campo de
  // data (Filtro(Alterados), inclusive com a variável "última sincronização"), ele substitui
  // a injeção automática por inteiro em vez de empilhar os dois — "editável de verdade".
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface ClienteRow {
  codcli: number;
  nomcli: string;
  apecli: string;
  sencli: string;
  tipcli: string;
  tipmer: string;
  tipemc: number;
  codram: string;
  insest: string;
  cgccpf: number;
  endcli: string;
  cplend: string;
  cepcli: number;
  baicli: string;
  cidcli: string;
  sigufs: string;
  codpai: string;
}

export async function runClienteSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    const rows = (await runSqlViaSoap(query)) as ClienteRow[];

    for (const row of rows) {
      const data = { ...row, cgccpf: BigInt(row.cgccpf), ...carimbo(inicio) };
      await prisma.cliente.upsert({
        where: { codcli: row.codcli },
        update: data,
        create: data,
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.ClienteWhereInput>(prisma.cliente, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(BASE_QUERY),
      inicio,
      linhasProcessadas: rows.length,
      desde,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message: varredura ? varredura.resumo : undefined,
        varreduraModo: varredura?.modo ?? null,
        varreduraDetectados: varredura?.candidatos ?? null,
        varreduraInicio: varredura ? inicio : null,
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

// Cadastro de clientes muda pouco — roda 1x por dia às 3h20. O modo incremental só
// roda quando disparado manualmente pela tela de administração de sincronização.
export function scheduleClienteSync(): void {
  cron.schedule(CRON_EXPR, () => runClienteSync());
}
