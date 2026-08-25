import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "notas_fiscais_venda-sync";
export const CRON_EXPR = "55 5 * * *";
// Só existe DatGer (sem DatAlt) nesta tabela — mesma lógica conservadora de tituloReceberSync.ts:
// não captura toda mudança (ex.: só a situação da NF mudando, sem regravar DatGer), mas é o
// único campo de data disponível no dicionário do Senior pra esta tabela.
export const CAMPO_DATA: string | null = "DatGer";
// Campos ampliados a pedido do Vitor (24/08/2026, mesma sessão) — lista completa que ele deu,
// mesma ordem do dicionário do Senior.
export const BASE_QUERY = `SELECT codemp AS codemp, codfil AS codfil, codsnf AS codsnf, numnfv AS numnfv, tipnfs AS tipnfs, codedc AS codedc, tnspro AS tnspro, tnsser AS tnsser, noppro AS noppro, nopser AS nopser, datemi AS datemi, codcli AS codcli, codrep AS codrep, codcpg AS codcpg, codfpg AS codfpg, codmoe AS codmoe, codtra AS codtra, vlrfre AS vlrfre, ciffob AS ciffob, sitnfv AS sitnfv FROM e140nfv`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface NotaFiscalVendaRow {
  codemp: number;
  codfil: number;
  codsnf: string;
  numnfv: number;
  tipnfs?: number;
  codedc?: string;
  tnspro?: string;
  tnsser?: string;
  noppro?: string;
  nopser?: string;
  datemi: string;
  codcli: number;
  codrep: number;
  codcpg: string;
  codfpg?: number;
  codmoe?: string;
  codtra?: number;
  vlrfre?: number;
  ciffob?: string;
  sitnfv: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "codsnf", cast: "text" },
  { nome: "numnfv", cast: "int" },
  { nome: "tipnfs", cast: "int" },
  { nome: "codedc", cast: "text" },
  { nome: "tnspro", cast: "text" },
  { nome: "tnsser", cast: "text" },
  { nome: "noppro", cast: "text" },
  { nome: "nopser", cast: "text" },
  { nome: "datemi", cast: "date" },
  { nome: "codcli", cast: "int" },
  { nome: "codrep", cast: "int" },
  { nome: "codcpg", cast: "text" },
  { nome: "codfpg", cast: "int" },
  { nome: "codmoe", cast: "text" },
  { nome: "codtra", cast: "int" },
  { nome: "vlrfre", cast: "numeric" },
  { nome: "ciffob", cast: "text" },
  { nome: "sitnfv", cast: "text" },
];

function linhaDe(row: NotaFiscalVendaRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.codsnf}-${row.numnfv}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      row.codsnf,
      String(row.numnfv),
      row.tipnfs != null ? String(row.tipnfs) : null,
      row.codedc != null ? row.codedc : null,
      row.tnspro != null ? row.tnspro : null,
      row.tnsser != null ? row.tnsser : null,
      row.noppro != null ? row.noppro : null,
      row.nopser != null ? row.nopser : null,
      String(row.datemi).slice(0, 10),
      String(row.codcli),
      String(row.codrep),
      row.codcpg,
      row.codfpg != null ? String(row.codfpg) : null,
      row.codmoe != null ? row.codmoe : null,
      row.codtra != null ? String(row.codtra) : null,
      row.vlrfre != null ? row.vlrfre.toFixed(2) : null,
      row.ciffob != null ? row.ciffob : null,
      row.sitnfv,
    ],
  };
}

export async function runNotaFiscalVendaSync(desde?: Date): Promise<void> {
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
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfil", "codsnf", "numnfv"])) as NotaFiscalVendaRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "notas_fiscais_venda",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "codsnf", "numnfv"],
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
    // const varredura = await varrerRemovidos<Prisma.NotaFiscalVendaWhereInput>(prisma.notaFiscalVenda, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: `SELECT COUNT(*) AS total FROM e140nfv`,
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

// Cabeçalho da NF de venda — roda 1x por dia às 5h55, antes dos itens (dependem dela).
export function scheduleNotaFiscalVendaSync(): void {
  cron.schedule(CRON_EXPR, () => runNotaFiscalVendaSync());
}
