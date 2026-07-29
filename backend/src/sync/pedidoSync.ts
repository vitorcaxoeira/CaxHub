import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "pedidos-sync";
// jobName separado pro sync sob demanda de um cliente só (runPedidoSyncPorCliente): o
// painel de Sincronização com o ERP (backend/src/routes/syncErp.ts) usa o último log de
// JOB_NAME pra dizer quando a tabela Pedidos sincronizou por inteiro — um pull parcial
// não pode se passar por isso.
export const JOB_NAME_CLIENTE = "pedidos-sync-cliente";
export const CRON_EXPR = "35 4 * * *"; // horário livre, sem dependência de outro job
export const CAMPO_DATA: string | null = "DatEmi";
const BASE_QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumPed AS numped, TipPed AS tipped, PrcPed AS prcped, TnsPro AS tnspro, TnsSer AS tnsser, DatEmi AS datemi, HorEmi AS horemi, DatPrv AS datprv, ObsPed AS obsped, VlrLiq AS vlrliq, ObsMot AS obsmot, CodCli AS codcli, PedCli AS pedcli, CodCpg AS codcpg, CodFpg AS codfpg, SitPed AS sitped, usu_numrat AS numrat FROM E120PED`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface PedidoRow {
  codemp: number;
  codfil: number;
  numped: number;
  tipped?: number;
  prcped?: number;
  tnspro?: string;
  tnsser?: string;
  datemi: string;
  horemi?: number;
  datprv?: string;
  obsped?: string;
  vlrliq?: number;
  obsmot?: string;
  codcli: number;
  pedcli?: string;
  codcpg: string;
  codfpg?: number;
  sitped: number;
  numrat?: number;
}

async function upsertPedido(row: PedidoRow): Promise<void> {
  const data = { codemp: row.codemp, codfil: row.codfil, numped: row.numped, tipped: row.tipped, prcped: row.prcped, tnspro: row.tnspro, tnsser: row.tnsser, datemi: new Date(row.datemi), horemi: row.horemi, datprv: row.datprv != null ? new Date(row.datprv) : null, obsped: row.obsped, vlrliq: row.vlrliq, obsmot: row.obsmot, codcli: row.codcli, pedcli: row.pedcli, codcpg: row.codcpg, codfpg: row.codfpg, sitped: row.sitped, numrat: row.numrat != null ? BigInt(row.numrat) : null };
  await prisma.pedido.upsert({
    where: { codemp_codfil_numped: { codemp: row.codemp, codfil: row.codfil, numped: row.numped } },
    update: data,
    create: data,
  });
}

export async function runPedidoSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codfil", "numped"])) as PedidoRow[];

    for (const row of rows) {
      await upsertPedido(row);
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export interface ResultadoSyncPorCliente {
  total: number;
  criados: number;
  atualizados: number;
}

// Quantos clientes entram em cada `WHERE CodCli IN (...)`. Um cliente por query seria
// uma ida ao SOAP por linha da tela (lento e desnecessário); um IN gigante estoura o
// tamanho da query. 300 códigos dá ~2 KB de SQL, bem dentro do que o serviço aceita.
const CLIENTES_POR_LOTE = 300;

// Sincronização sob demanda dos pedidos de um conjunto de clientes — ações "Sinc. ERP"
// (uma linha) e "Sincronizar filtro" (todos os clientes do filtro atual) da aba Por
// Cliente em Mercado > Listar Pedidos, pra não ter que esperar o job diário que varre a
// E120PED inteira. É um pull do Senior (não há canal de escrita confirmado, ver
// outboxSenior.ts): traz pedidos novos e atualiza os que já existem localmente.
//
// Não apaga pedidos locais que sumiram do Senior — mesmo comportamento do job completo,
// que também só faz upsert.
export async function runPedidoSyncPorClientes(codclis: number[]): Promise<ResultadoSyncPorCliente> {
  // Os códigos entram direto na query (o serviço SOAP não aceita bind de parâmetros),
  // então só segue adiante se forem mesmo inteiros — as rotas já validam, isso aqui é a
  // segunda barreira pra nunca concatenar texto arbitrário no SQL.
  const invalido = codclis.find((c) => !Number.isInteger(c));
  if (invalido !== undefined) throw new Error(`codcli inválido: ${invalido}`);

  const alvos = [...new Set(codclis)];
  if (alvos.length === 0) return { total: 0, criados: 0, atualizados: 0 };

  const lotes: number[][] = [];
  for (let i = 0; i < alvos.length; i += CLIENTES_POR_LOTE) {
    lotes.push(alvos.slice(i, i + CLIENTES_POR_LOTE));
  }
  // Guardado só pra registrar no syncLog o que foi consultado (a query real é uma por lote).
  const queryLog =
    lotes.length === 1
      ? `${BASE_QUERY} WHERE CodCli IN (${lotes[0].join(",")})`
      : `${BASE_QUERY} WHERE CodCli IN (...) — ${alvos.length} cliente(s) em ${lotes.length} lote(s)`;

  try {
    // Chaves já existentes lidas ANTES dos upserts, pra conseguir dizer na tela quantos
    // pedidos são novos e quantos só foram atualizados.
    const existentes = await prisma.pedido.findMany({
      where: { codcli: { in: alvos } },
      select: { codemp: true, codfil: true, numped: true },
    });
    const chavesExistentes = new Set(existentes.map((p) => `${p.codemp}-${p.codfil}-${p.numped}`));

    let total = 0;
    let criados = 0;
    for (const lote of lotes) {
      const query = `${BASE_QUERY} WHERE CodCli IN (${lote.join(",")})`;
      const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codfil", "numped"])) as PedidoRow[];
      total += rows.length;
      for (const row of rows) {
        if (!chavesExistentes.has(`${row.codemp}-${row.codfil}-${row.numped}`)) criados += 1;
        await upsertPedido(row);
      }
    }

    const resultado = { total, criados, atualizados: total - criados };
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME_CLIENTE,
        query: queryLog,
        status: "success",
        message: `${alvos.length} cliente(s), ${total} pedido(s): ${criados} novo(s), ${resultado.atualizados} atualizado(s)`,
      },
    });
    return resultado;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME_CLIENTE, query: queryLog, status: "error", message },
    });
    console.error(`[${JOB_NAME_CLIENTE}] falhou (${alvos.length} cliente(s)):`, message);
    throw error;
  }
}

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental só é
// usado quando disparado manualmente pela tela de administração de sincronização.
export function schedulePedidoSync(): void {
  cron.schedule(CRON_EXPR, () => runPedidoSync());
}
