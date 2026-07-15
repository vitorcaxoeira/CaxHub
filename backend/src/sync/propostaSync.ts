import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "propostas-sync";
const QUERY = `SELECT USU_CodEmp AS codemp, USU_CodPro AS codpro, USU_CodCli AS codcli, USU_QtdHor AS qtdhor, USU_DatPro AS datpro, USU_UsuGer AS usuger, USU_ForAte AS forate, USU_SitPro AS sitpro, USU_HorPro AS horpro, USU_TipPro AS tippro, USU_DesSol AS dessol, USU_ConSol AS consol, USU_PraRea AS prarea, USU_DatEnv AS datenv, USU_DatRet AS datret, USU_NumPrj AS numprj, USU_DatVal AS datval, USU_CodFpj AS codfpj, USU_SisPro AS sispro, USU_DesPro AS despro, usu_Numero AS numero, USU_ObrFas AS obrfas, USU_Executor AS executor, USU_ObsSit AS obssit, USU_LiqBru AS liqbru, USU_CodCcu AS codccu, USU_CtaFin AS ctafin, USU_ClaPro AS clapro, USU_AreExe AS areexe, USU_IdCom AS idcom, USU_CodRep AS codrep, USU_ForFat AS forfat, USU_DscFpg AS dscfpg, USU_HisPro AS hispro, USU_ObsPro AS obspro, USU_PreEnt AS preent, USU_PriPro AS pripro, USU_StaPro AS stapro, USU_TipVen AS tipven, USU_OrdemCns AS ordemcns, USU_SitMot AS sitmot, USU_TipPrj AS tipprj, USU_FrmPrj AS frmprj, USU_CodLev2 AS codlev2, USU_CliFat AS clifat, USU_ExiPedCli AS exipedcli, USU_PedCli AS pedcli, USU_ForFatRdv AS forfatrdv, USU_ModPro AS modpro, USU_ForFatLev AS forfatlev, USU_NumPed AS numped, USU_IdBpm AS idbpm, USU_DepExe AS depexe, USU_FatHrsDes AS fathrsdes FROM USU_TE077PRO`;

interface PropostaRow {
  codemp: number;
  codpro: number;
  codcli: number;
  qtdhor?: number;
  datpro?: string;
  usuger?: number;
  forate?: string;
  sitpro?: number;
  horpro?: number;
  tippro?: number;
  dessol?: string;
  consol?: string;
  prarea?: string;
  datenv?: string;
  datret?: string;
  numprj: number;
  datval?: string;
  codfpj: number;
  sispro?: number;
  despro?: string;
  numero?: number;
  obrfas?: string;
  executor?: number;
  obssit?: string;
  liqbru?: string;
  codccu?: string;
  ctafin?: number;
  clapro?: number;
  areexe?: number;
  idcom: number;
  codrep: number;
  forfat?: number;
  dscfpg?: string;
  hispro?: string;
  obspro?: string;
  preent?: string;
  pripro?: number;
  stapro?: number;
  tipven?: number;
  ordemcns?: number;
  sitmot?: number;
  tipprj?: number;
  frmprj?: number;
  codlev2?: number;
  clifat?: number;
  exipedcli?: string;
  pedcli?: string;
  forfatrdv?: number;
  modpro?: number;
  forfatlev?: number;
  numped: number;
  idbpm?: number;
  depexe?: number;
  fathrsdes?: string;
}

export async function runPropostaSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codpro"])) as PropostaRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codpro: row.codpro, codcli: row.codcli, qtdhor: row.qtdhor, datpro: row.datpro != null ? new Date(row.datpro) : null, usuger: row.usuger, forate: row.forate, sitpro: row.sitpro, horpro: row.horpro, tippro: row.tippro, dessol: row.dessol, consol: row.consol, prarea: row.prarea, datenv: row.datenv != null ? new Date(row.datenv) : null, datret: row.datret != null ? new Date(row.datret) : null, numprj: row.numprj, datval: row.datval != null ? new Date(row.datval) : null, codfpj: row.codfpj, sispro: row.sispro, despro: row.despro, numero: row.numero != null ? BigInt(row.numero) : null, obrfas: row.obrfas, executor: row.executor, obssit: row.obssit, liqbru: row.liqbru, codccu: row.codccu, ctafin: row.ctafin, clapro: row.clapro, areexe: row.areexe, idcom: row.idcom, codrep: row.codrep, forfat: row.forfat, dscfpg: row.dscfpg, hispro: row.hispro, obspro: row.obspro, preent: row.preent != null ? new Date(row.preent) : null, pripro: row.pripro, stapro: row.stapro, tipven: row.tipven, ordemcns: row.ordemcns, sitmot: row.sitmot, tipprj: row.tipprj, frmprj: row.frmprj, codlev2: row.codlev2, clifat: row.clifat, exipedcli: row.exipedcli, pedcli: row.pedcli, forfatrdv: row.forfatrdv, modpro: row.modpro, forfatlev: row.forfatlev, numped: row.numped, idbpm: row.idbpm, depexe: row.depexe, fathrsdes: row.fathrsdes };
      await prisma.proposta.upsert({
        where: { codemp_codpro: { codemp: row.codemp, codpro: row.codpro } },
        update: data,
        create: data,
      });
    }

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
export function schedulePropostaSync(): void {
  cron.schedule("0 4 * * *", runPropostaSync);
}
