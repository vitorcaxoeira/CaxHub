import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "itens_produto_nfv-sync";
export const CRON_EXPR = "5 6 * * *";
export const CAMPO_DATA: string | null = "DatGer";
// Campos ampliados a pedido do Vitor (24/08/2026, mesma sessão) — "complemente" (aditivo):
// codpro/cplipv/vlrbru já existentes preservados, mesma ordem do dicionário do Senior.
export const BASE_QUERY = `SELECT codemp AS codemp, codfil AS codfil, codsnf AS codsnf, numnfv AS numnfv, seqipv AS seqipv, tnspro AS tnspro, noppro AS noppro, filped AS filped, numped AS numped, seqipd AS seqipd, filctr AS filctr, numctr AS numctr, datcpt AS datcpt, seqcvp AS seqcvp, codpro AS codpro, codder AS codder, cplipv AS cplipv, qtdfat AS qtdfat, qtddev AS qtddev, unimed AS unimed, uniemi AS uniemi, codtpr AS codtpr, preuni AS preuni, prebas AS prebas, perdsc AS perdsc, perofe AS perofe, univen AS univen, qtdven AS qtdven, preven AS preven, vlrbru AS vlrbru FROM e140ipv`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface ItemProdutoNfVendaRow {
  codemp: number;
  codfil: number;
  codsnf: string;
  numnfv: number;
  seqipv: number;
  tnspro?: string;
  noppro?: string;
  filped?: number;
  numped?: number;
  seqipd?: number;
  filctr?: number;
  numctr?: number;
  datcpt?: string;
  seqcvp?: number;
  codpro?: string;
  codder?: string;
  cplipv?: string;
  qtdfat?: number;
  qtddev?: number;
  unimed?: string;
  uniemi?: string;
  codtpr?: string;
  preuni?: number;
  prebas?: number;
  perdsc?: number;
  perofe?: number;
  univen?: string;
  qtdven?: number;
  preven?: number;
  vlrbru?: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "codsnf", cast: "text" },
  { nome: "numnfv", cast: "int" },
  { nome: "seqipv", cast: "int" },
  { nome: "tnspro", cast: "text" },
  { nome: "noppro", cast: "text" },
  { nome: "filped", cast: "int" },
  { nome: "numped", cast: "int" },
  { nome: "seqipd", cast: "int" },
  { nome: "filctr", cast: "int" },
  { nome: "numctr", cast: "int" },
  { nome: "datcpt", cast: "date" },
  { nome: "seqcvp", cast: "int" },
  { nome: "codpro", cast: "text" },
  { nome: "codder", cast: "text" },
  { nome: "cplipv", cast: "text" },
  { nome: "qtdfat", cast: "numeric" },
  { nome: "qtddev", cast: "numeric" },
  { nome: "unimed", cast: "text" },
  { nome: "uniemi", cast: "text" },
  { nome: "codtpr", cast: "text" },
  { nome: "preuni", cast: "numeric" },
  { nome: "prebas", cast: "numeric" },
  { nome: "perdsc", cast: "numeric" },
  { nome: "perofe", cast: "numeric" },
  { nome: "univen", cast: "text" },
  { nome: "qtdven", cast: "numeric" },
  { nome: "preven", cast: "numeric" },
  { nome: "vlrbru", cast: "numeric" },
];

function linhaDe(row: ItemProdutoNfVendaRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.codsnf}-${row.numnfv}-${row.seqipv}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      row.codsnf,
      String(row.numnfv),
      String(row.seqipv),
      row.tnspro != null ? row.tnspro : null,
      row.noppro != null ? row.noppro : null,
      row.filped != null ? String(row.filped) : null,
      row.numped != null ? String(row.numped) : null,
      row.seqipd != null ? String(row.seqipd) : null,
      row.filctr != null ? String(row.filctr) : null,
      row.numctr != null ? String(row.numctr) : null,
      row.datcpt != null ? String(row.datcpt).slice(0, 10) : null,
      row.seqcvp != null ? String(row.seqcvp) : null,
      row.codpro != null ? row.codpro : null,
      row.codder != null ? row.codder : null,
      row.cplipv != null ? row.cplipv : null,
      row.qtdfat != null ? row.qtdfat.toFixed(5) : null,
      row.qtddev != null ? row.qtddev.toFixed(5) : null,
      row.unimed != null ? row.unimed : null,
      row.uniemi != null ? row.uniemi : null,
      row.codtpr != null ? row.codtpr : null,
      row.preuni != null ? row.preuni.toFixed(10) : null,
      row.prebas != null ? row.prebas.toFixed(10) : null,
      row.perdsc != null ? row.perdsc.toFixed(2) : null,
      row.perofe != null ? row.perofe.toFixed(5) : null,
      row.univen != null ? row.univen : null,
      row.qtdven != null ? row.qtdven.toFixed(5) : null,
      row.preven != null ? row.preven.toFixed(10) : null,
      row.vlrbru != null ? row.vlrbru.toFixed(2) : null,
    ],
  };
}

export async function runItemProdutoNfVendaSync(desde?: Date): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  const QUERY = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfil", "codsnf", "numnfv", "seqipv"])) as ItemProdutoNfVendaRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "itens_produto_nfv",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "codsnf", "numnfv", "seqipv"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — vem comentada de
    // propósito: ligar a varredura exige duas decisões que um gerador não tem como
    // adivinhar, e o default de politicaVarredura.ts é "desligada" justamente pra tabela
    // nova nunca começar a marcar registro sozinha.
    //   1. ESCOPO — precisa excluir registro nascido no CaxHub, se esta tabela for de mão
    //      dupla (ex.: { origemCaxHub: false }), senão ele é acusado de removido.
    //   2. CONTAGEM NA ORIGEM — tem que repetir exatamente o mesmo FROM/WHERE da QUERY
    //      acima, incluindo filtro aplicado às linhas dentro do laço, senão a guarda
    //      acusa truncamento onde não houve.
    //
    // Pra ligar: descomentar o bloco, acrescentar aos imports
    //   import { Prisma } from "@prisma/client";
    //   import { varrerRemovidos } from "./varrerRemovidos";
    // e registrar o JOB_NAME em src/sync/politicaVarredura.ts começando por "simular" —
    // nunca direto em "marcar", sem antes conferir os detectados contra o ERP.
    //
    // const varredura = await varrerRemovidos<Prisma.ItemProdutoNfVendaWhereInput>(prisma.itemProdutoNfVenda, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: `SELECT COUNT(*) AS total FROM e140ipv`,
    // });

    await prisma.syncLog.create({
      // Ao ligar a varredura, acrescentar aqui pra ela aparecer no painel:
      //   message: `${resultado.linhasProcessadas} linhas em ...s — ${varredura.resumo}`,
      //   varreduraModo: varredura.modo,
      //   varreduraDetectados: varredura.candidatos,
      //   varreduraInicio: inicio,
      data: {
        jobName: JOB_NAME,
        query: QUERY,
        status: "success",
        message:
          `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes)`,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Itens de produto da NF — roda 1x por dia às 6h05, junto com itens de serviço.
export function scheduleItemProdutoNfVendaSync(): void {
  cron.schedule(CRON_EXPR, () => runItemProdutoNfVendaSync());
}
