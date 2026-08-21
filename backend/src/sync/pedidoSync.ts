import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoap, runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { carimbo, varrerRemovidos } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";

export const JOB_NAME = "pedidos-sync";
// jobName separado pro sync sob demanda de um cliente só (runPedidoSyncPorCliente): o
// painel de Sincronização com o ERP (backend/src/routes/syncErp.ts) usa o último log de
// JOB_NAME pra dizer quando a tabela Pedidos sincronizou por inteiro — um pull parcial
// não pode se passar por isso.
export const JOB_NAME_CLIENTE = "pedidos-sync-cliente";
export const CRON_EXPR = "35 4 * * *"; // horário livre, sem dependência de outro job
export const CAMPO_DATA: string | null = "DatEmi";
const BASE_QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumPed AS numped, TipPed AS tipped, PrcPed AS prcped, TnsPro AS tnspro, TnsSer AS tnsser, DatEmi AS datemi, HorEmi AS horemi, DatPrv AS datprv, ObsPed AS obsped, VlrLiq AS vlrliq, ObsMot AS obsmot, CodCli AS codcli, PedCli AS pedcli, CodCpg AS codcpg, CodFpg AS codfpg, SitPed AS sitped, usu_numrat AS numrat FROM E120PED`;

// Guarda principal da varredura: quantas linhas a origem diz ter. Precisa ter o MESMO
// FROM/WHERE da consulta do sync, senão a comparação acusa truncamento onde não houve.
// O alias é obrigatório — o serviço usa FOR JSON internamente e recusa coluna sem alias.
const QUERY_CONTAGEM_ORIGEM = `SELECT COUNT(*) AS total FROM E120PED`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

export interface PedidoRow {
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

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (Pedido): vlrliq Decimal(15,2), numrat BigInt.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numped", cast: "int" },
  { nome: "tipped", cast: "int" },
  { nome: "prcped", cast: "int" },
  { nome: "tnspro", cast: "text" },
  { nome: "tnsser", cast: "text" },
  { nome: "datemi", cast: "date" },
  { nome: "horemi", cast: "int" },
  { nome: "datprv", cast: "date" },
  { nome: "obsped", cast: "text" },
  { nome: "vlrliq", cast: "numeric" },
  { nome: "obsmot", cast: "text" },
  { nome: "codcli", cast: "int" },
  { nome: "pedcli", cast: "text" },
  { nome: "codcpg", cast: "text" },
  { nome: "codfpg", cast: "int" },
  { nome: "sitped", cast: "int" },
  { nome: "numrat", cast: "bigint" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)`. `!= null` (não `!== undefined`)
// trata ausência de chave e null da mesma forma — é o que faz a linha sintética mínima do
// script prisma/verificarVarreduraRemocoes.ts (só codemp/codfil/numped/datemi/codcli/
// codcpg/sitped) funcionar sem quebrar nos campos ausentes.
function linhaDe(row: PedidoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numped}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.numped),
      row.tipped != null ? String(row.tipped) : null,
      row.prcped != null ? String(row.prcped) : null,
      row.tnspro != null ? row.tnspro : null,
      row.tnsser != null ? row.tnsser : null,
      String(row.datemi).slice(0, 10),
      row.horemi != null ? String(row.horemi) : null,
      row.datprv != null ? String(row.datprv).slice(0, 10) : null,
      row.obsped != null ? row.obsped : null,
      row.vlrliq != null ? row.vlrliq.toFixed(2) : null,
      row.obsmot != null ? row.obsmot : null,
      String(row.codcli),
      row.pedcli != null ? row.pedcli : null,
      row.codcpg,
      row.codfpg != null ? String(row.codfpg) : null,
      String(row.sitped),
      row.numrat != null ? String(row.numrat) : null,
    ],
  };
}

// `inicio` é o instante em que a execução começou; vai pro carimbo `vistoEmSync` de toda
// linha vista nesta rodada, e é o que a varredura usa depois pra descobrir quem não veio.
// Só usada por runPedidoSyncPorClientes (pull sob demanda, linha a linha — volume pequeno
// por natureza, não é o gargalo que motivou o upsert em lote).
async function upsertPedido(row: PedidoRow, inicio: Date): Promise<void> {
  const data = { codemp: row.codemp, codfil: row.codfil, numped: row.numped, tipped: row.tipped, prcped: row.prcped, tnspro: row.tnspro, tnsser: row.tnsser, datemi: new Date(row.datemi), horemi: row.horemi, datprv: row.datprv != null ? new Date(row.datprv) : null, obsped: row.obsped, vlrliq: row.vlrliq, obsmot: row.obsmot, codcli: row.codcli, pedcli: row.pedcli, codcpg: row.codcpg, codfpg: row.codfpg, sitped: row.sitped, numrat: row.numrat != null ? BigInt(row.numrat) : null, ...carimbo(inicio) };
  await prisma.pedido.upsert({
    where: { codemp_codfil_numped: { codemp: row.codemp, codfil: row.codfil, numped: row.numped } },
    update: data,
    create: data,
  });
}

// Extraído do laço pra poder ser exercitado com linhas sintéticas, sem SOAP, pelo script
// backend/prisma/verificarVarreduraRemocoes.ts — mesmo motivo pelo qual propostaSync.ts
// separou processarLinhasProposta. Assinatura preservada (Promise<void>, mesmos parâmetros)
// mesmo depois de trocar o laço por upsertEmLote — o script chama isso repetidas vezes
// simulando rodadas de sync com `inicio` diferente a cada chamada, sem olhar retorno.
export async function processarLinhasPedido(rows: PedidoRow[], inicio: Date): Promise<void> {
  await upsertEmLote(rows.map(linhaDe), {
    tabela: "pedidos",
    colunas: COLUNAS,
    colunasPk: ["codemp", "codfil", "numped"],
    carimbo: inicio,
  });
}

export async function runPedidoSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codfil", "numped"])) as PedidoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    await processarLinhasPedido(rows, inicio);
    const msEscrita = Date.now() - inicioEscrita;

    // Varredura só faz sentido no modo COMPLETO: no incremental a query é um recorte por
    // DatEmi, então quase toda a tabela ficaria sem carimbo e seria acusada de removida.
    const varredura = desde
      ? null
      : await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
          jobName: JOB_NAME,
          inicio,
          linhasProcessadas: rows.length,
          escopo: {},
          queryContagemOrigem: QUERY_CONTAGEM_ORIGEM,
        });

    const tempo = `${((msFetch + msEscrita) / 1000).toFixed(1)}s (fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s)`;
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message: varredura
          ? `${rows.length} linhas em ${tempo} — ${varredura.resumo}`
          : `${rows.length} linha(s) em ${tempo}, sem varredura (sync incremental)`,
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
// que também só faz upsert. Fora do escopo da conversão pra lote: volume pequeno por
// natureza (no máximo os pedidos do filtro atual da tela), não é o gargalo medido.
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

  const inicio = new Date();
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
        await upsertPedido(row, inicio);
      }
    }

    // Varredura restrita aos clientes consultados: sem esse escopo, um sync de um cliente
    // só marcaria como removida a tabela inteira que ele nem consultou. Restrita assim,
    // ela detecta exclusão dentro daquele cliente de graça — e é o caminho mais rápido de
    // conferir a detecção, porque são poucos pedidos pra checar no Senior.
    const varredura = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
      jobName: JOB_NAME_CLIENTE,
      inicio,
      linhasProcessadas: total,
      escopo: { codcli: { in: alvos } },
      // Contagem na origem lote a lote, somada — mesmo recorte da consulta principal.
      contarOrigem: async () => {
        let soma = 0;
        for (const lote of lotes) {
          const r = (await runSqlViaSoap(
            `SELECT COUNT(*) AS total FROM E120PED WHERE CodCli IN (${lote.join(",")})`
          )) as { total: number }[];
          soma += Number(r?.[0]?.total ?? NaN);
        }
        return soma;
      },
      // Teto mais frouxo que o do job noturno porque aqui o escopo é pequeno: um cliente
      // com 3 pedidos estouraria os 2% do padrão com uma única exclusão legítima. O mínimo
      // de 25 cobre esse caso (dá pra esvaziar um cliente pequeno inteiro), e os 10%
      // limitam o estrago quando o escopo é grande — o botão "Sinc. ERP — N clientes do
      // filtro" aceita o filtro inteiro, então uma clicada só pode cobrir os 265 clientes
      // e 12 mil pedidos de uma vez.
      teto: { pct: 0.1, minimo: 25 },
    });

    const resultado = { total, criados, atualizados: total - criados };
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME_CLIENTE,
        query: queryLog,
        status: "success",
        message:
          `${alvos.length} cliente(s), ${total} pedido(s): ${criados} novo(s), ` +
          `${resultado.atualizados} atualizado(s) — ${varredura.resumo}`,
        varreduraModo: varredura.modo,
        varreduraDetectados: varredura.candidatos,
        varreduraInicio: inicio,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
    return resultado;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME_CLIENTE, query: queryLog, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
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
