import cron from "node-cron";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { diffCampos, criarEventoAuditoria, paraDiff } from "../audit/registrarEvento";
import { CAMPOS_AUDITADOS_PROPOSTA_ITEM } from "../audit/camposAuditados";
import { EVENTOS_AUDITORIA, ENTIDADES_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdPropostaItem } from "../audit/identidadeEntidade";

export const JOB_NAME = "propostas_itens-sync";
export const CRON_EXPR = "0 4 * * *";
// USU_TE077ITE não tem campo de data de geração/alteração no dicionário do Senior.
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT USU_CodEmp AS codemp, USU_CodPro AS codpro, USU_SeqIte AS seqite, USU_NumPrj AS numprj, USU_CodSer AS codser, USU_QtdHor AS qtdhor, USU_ValHor AS valhor, USU_DesPro AS despro, USU_EntPro AS entpro, USU_CodFpj AS codfpj, USU_FatSer AS fatser, USU_SitMot AS sitmot, USU_ForFat AS forfat, USU_TipPrj AS tipprj, USU_FrmPrj AS frmprj, USU_SitPrz AS sitprz, USU_ATVPSO AS atvpso, USU_DepExe AS depexe FROM USU_TE077ITE`;

export interface PropostaItemRow {
  codemp: number;
  codpro: number;
  seqite: number;
  numprj: number;
  codser: string;
  qtdhor?: number;
  valhor?: number;
  despro?: string;
  entpro?: string;
  codfpj: number;
  fatser?: string;
  sitmot?: number;
  forfat?: number;
  tipprj?: number;
  frmprj?: number;
  sitprz?: number;
  atvpso?: number;
  depexe?: number;
}

// Corpo do processamento extraído à parte de runPropostaItemSync() para poder ser
// exercitado com linhas sintéticas (ver backend/prisma/verificarAceiteAuditoria.ts) sem
// depender do webservice SOAP real — mesma lógica, sem mudança de comportamento.
export async function processarLinhasPropostaItem(rows: PropostaItemRow[]): Promise<void> {
  for (const row of rows) {
    const data = { codemp: row.codemp, codpro: row.codpro, seqite: row.seqite, numprj: row.numprj, codser: row.codser, qtdhor: row.qtdhor, valhor: row.valhor, despro: row.despro, entpro: row.entpro, codfpj: row.codfpj, fatser: row.fatser, sitmot: row.sitmot, forfat: row.forfat, tipprj: row.tipprj, frmprj: row.frmprj, sitprz: row.sitprz, atvpso: row.atvpso != null ? BigInt(row.atvpso) : null, depexe: row.depexe };

    const existente = await prisma.propostaItem.findUnique({
      where: { codemp_codpro_seqite: { codemp: row.codemp, codpro: row.codpro, seqite: row.seqite } },
    });
    const ehNovo = existente === null;
    const { alteracoes, algumaMudanca } = diffCampos(CAMPOS_AUDITADOS_PROPOSTA_ITEM, existente, paraDiff(data));

    const upsert = prisma.propostaItem.upsert({
      where: { codemp_codpro_seqite: { codemp: row.codemp, codpro: row.codpro, seqite: row.seqite } },
      update: data,
      create: data,
    });

    if (!ehNovo && !algumaMudanca) {
      await upsert;
      continue;
    }

    const correlationId = randomUUID();
    const entidadeId = entidadeIdPropostaItem(row.codemp, row.codpro, row.seqite);
    const entidadeRotulo = `Item ${row.seqite} — Proposta ${row.codemp}/${row.codpro}`;
    const operacoes: Prisma.PrismaPromise<unknown>[] = [
      upsert,
      criarEventoAuditoria({
        origem: "integracao_senior",
        entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA_ITEM,
        entidadeId,
        entidadeRotulo,
        codemp: row.codemp,
        codpro: row.codpro,
        eventoTipo: ehNovo ? EVENTOS_AUDITORIA.PROPOSTA_ITEM_CRIADO : EVENTOS_AUDITORIA.PROPOSTA_ITEM_ALTERADO,
        alteracoes: ehNovo ? null : alteracoes,
        metadata: null,
        correlationId,
      }),
    ];

    await prisma.$transaction(operacoes);
  }
}

export async function runPropostaItemSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codpro", "seqite"])) as PropostaItemRow[];
    await processarLinhasPropostaItem(rows);

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Ajustar o horário conforme a necessidade real de atualização desta tabela.
export function schedulePropostaItemSync(): void {
  cron.schedule(CRON_EXPR, runPropostaItemSync);
}
