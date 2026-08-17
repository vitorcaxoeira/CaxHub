import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { reconciliarAlocacoesOrfas, resumirReconciliacao } from "../domain/reconciliarEstrutura";

export const JOB_NAME = "atividades_consultor-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "USU_DatGer";
// USU_SeqIte > 0 direto na query, não só filtrado depois em memória: seqite=0 é "sem item de
// proposta vinculado" (nunca vira AtividadeConsultor de verdade, ver `validas` abaixo), e
// trazer essa linha da API SOAP só pra descartar é tráfego à toa — a mesma razão que já
// motivou paginar essa sync (>30 mil linhas fazem o Senior truncar a resposta). Regra de
// preferência do Vitor (17/08/2026): filtro de negócio sempre na query enviada ao ERP, nunca
// só em memória depois — ver [[filtro-de-negocio-na-query-nao-so-em-memoria]] no segundo
// cérebro. Foi um filtro em memória desse tipo, escondendo o dado que ainda vinha por inteiro,
// que deixou passar despercebida uma alocação duplicada (proposta 8749, 14/08/2026).
const BASE_QUERY = `SELECT USU_QtdHor AS qtdhor, USU_CodEmp AS codemp, USU_CodPro AS codpro, USU_SeqIte AS seqite, USU_CODFOR AS codfor, USU_SeqAti AS seqati, USU_SitReg AS sitreg, USU_DatGer AS datger, USU_HorGer AS horger, USU_UsuGer AS usuger, USU_PerLib AS perlib, USU_FasId AS fasid, USU_SelSol AS selsol FROM USU_TE077ATI WHERE USU_SeqIte > 0`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} AND ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface AtividadeConsultorRow {
  qtdhor?: number;
  codemp: number;
  codpro: number;
  seqite: number;
  codfor: number;
  seqati: number;
  sitreg?: string;
  datger?: string;
  horger?: number;
  usuger?: number;
  perlib?: number;
  fasid: number;
  selsol?: string;
}

// Essa tabela é a única de mão dupla do projeto (ver comentário do model
// AtividadeConsultor no schema.prisma) — a PK local é o `id` autoincrement do CaxHub,
// não o `seqati` do Senior. O upsert casa por `seqati` (único), não por `id`.
export async function runAtividadeConsultorSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária real da tabela no Senior (USU_SeqAti / seqati).
    const rows = (await runSqlViaSoapPaginated(query, ["seqati"])) as AtividadeConsultorRow[];

    // Rede de segurança, não a barreira principal: a query já filtra USU_SeqIte > 0 (ver
    // BASE_QUERY acima) — isso aqui só cobre a hipótese de o Senior devolver algo fora do
    // combinado (paginação, versão de serviço diferente etc.), sem custo de manter.
    const validas = rows.filter((row) => row.seqite !== 0);

    for (const row of validas) {
      const data = {
        codemp: row.codemp,
        codpro: row.codpro,
        seqite: row.seqite,
        codfor: row.codfor,
        qtdhor: row.qtdhor,
        sitreg: row.sitreg,
        datger: row.datger != null ? new Date(row.datger) : null,
        horger: row.horger,
        usuger: row.usuger,
        perlib: row.perlib,
        fasid: row.fasid,
        selsol: row.selsol,
      };
      await prisma.atividadeConsultor.upsert({
        where: { seqati: BigInt(row.seqati) },
        update: data,
        create: { ...data, seqati: BigInt(row.seqati) },
      });
    }

    // O Senior não tem como mandar `estruturaAtividadeId` — é conceito 100% CaxHub —, então
    // toda alocação importada nasce sem nó na EAP e fica invisível no cronograma (que
    // agrupa por nó, ver routes/alocacao.ts). A reconciliação roda AQUI, colada no import,
    // pra não existir janela entre a órfã nascer e ganhar seu nó.
    const reconciliacao = await reconciliarAlocacoesOrfas();

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "success", message: resumirReconciliacao(reconciliacao) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental
// só é usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleAtividadeConsultorSync(): void {
  cron.schedule(CRON_EXPR, () => runAtividadeConsultorSync());
}
