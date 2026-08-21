import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { reconciliarAlocacoesOrfas, resumirReconciliacao } from "../domain/reconciliarEstrutura";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";

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

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores. `seqati` é a PK do
// lote (não a natural codemp+codpro+seqite+codfor) — casa exatamente como o upsert antigo,
// que sempre resolvia por `where: { seqati: ... } }` (AtividadeConsultor.seqati é @unique;
// a PK local `id` autoincrement nunca é tocada por esta sync, mesmo comportamento de antes).
const COLUNAS: ColunaUpsert[] = [
  { nome: "seqati", cast: "bigint" },
  { nome: "codemp", cast: "int" },
  { nome: "codpro", cast: "int" },
  { nome: "seqite", cast: "int" },
  { nome: "codfor", cast: "int" },
  { nome: "qtdhor", cast: "int" },
  { nome: "sitreg", cast: "text" },
  { nome: "datger", cast: "date" },
  { nome: "horger", cast: "int" },
  { nome: "usuger", cast: "int" },
  { nome: "perlib", cast: "int" },
  { nome: "fasid", cast: "int" },
  { nome: "selsol", cast: "text" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)`. `!= null` (não `!== undefined`)
// trata ausência de chave e null da mesma forma.
function linhaDe(row: AtividadeConsultorRow): LinhaUpsert {
  return {
    chave: String(row.seqati),
    valores: [
      String(row.seqati),
      String(row.codemp),
      String(row.codpro),
      String(row.seqite),
      String(row.codfor),
      row.qtdhor != null ? String(row.qtdhor) : null,
      row.sitreg != null ? row.sitreg : null,
      row.datger != null ? String(row.datger).slice(0, 10) : null,
      row.horger != null ? String(row.horger) : null,
      row.usuger != null ? String(row.usuger) : null,
      row.perlib != null ? String(row.perlib) : null,
      String(row.fasid),
      row.selsol != null ? row.selsol : null,
    ],
  };
}

// Essa tabela é a única de mão dupla do projeto (ver comentário do model
// AtividadeConsultor no schema.prisma) — a PK local é o `id` autoincrement do CaxHub,
// não o `seqati` do Senior. O upsert casa por `seqati` (único), não por `id`.
export async function runAtividadeConsultorSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária real da tabela no Senior (USU_SeqAti / seqati).
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["seqati"])) as AtividadeConsultorRow[];
    const msFetch = Date.now() - inicioFetch;

    // Rede de segurança, não a barreira principal: a query já filtra USU_SeqIte > 0 (ver
    // BASE_QUERY acima) — isso aqui só cobre a hipótese de o Senior devolver algo fora do
    // combinado (paginação, versão de serviço diferente etc.), sem custo de manter.
    const validas = rows.filter((row) => row.seqite !== 0);

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(validas.map(linhaDe), {
      tabela: "atividades_consultor",
      colunas: COLUNAS,
      colunasPk: ["seqati"],
    });
    const msEscrita = Date.now() - inicioEscrita;

    // O Senior não tem como mandar `estruturaAtividadeId` — é conceito 100% CaxHub —, então
    // toda alocação importada nasce sem nó na EAP e fica invisível no cronograma (que
    // agrupa por nó, ver routes/alocacao.ts). A reconciliação roda AQUI, colada no import,
    // pra não existir janela entre a órfã nascer e ganhar seu nó.
    const reconciliacao = await reconciliarAlocacoesOrfas();

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes) — ${resumirReconciliacao(reconciliacao)}`,
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

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental
// só é usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleAtividadeConsultorSync(): void {
  cron.schedule(CRON_EXPR, () => runAtividadeConsultorSync());
}
