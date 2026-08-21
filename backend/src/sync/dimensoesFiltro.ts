// Dimensões e propagação — Fase 4 do plano de filtros na importação
// (~/.claude/plans/se-liga-na-necessidade-resilient-lark.md, seção E). Uma "dimensão" é um
// campo que existe (com o mesmo SENTIDO) em várias tabelas espelho — hoje só `codemp`
// (Empresa), o exemplo que o Vitor deu no pedido original (21/08/2026): "se eu aplicar
// codemp=1 na tabela de empresa, a tabela filial deve aplicar o mesmo filtro".
//
// Diferente do desenho original do plano (mapa job->coluna MANTIDO À MÃO), aqui a coluna de
// cada job é DERIVADA de `job.colunas` (Fase 1) pelo ALIAS local — que já é uniformemente
// "codemp" nas 27 tabelas que têm essa dimensão (confirmado varrendo os 35 jobs de verdade,
// 21/08/2026; só a ORIGEM varia: codemp×15, CodEmp×4, USU_CodEmp×5, USU_CODEMP×3). Isso é
// estritamente melhor que o mapa à mão: uma tabela nova que nasça com uma coluna "codemp" no
// SELECT participa da dimensão automaticamente, sem precisar de registro manual nenhum — o
// próprio risco que o "teste de cobertura" do plano queria mitigar deixa de existir.
// `import type` nos dois — só usados como anotação de tipo aqui, e este módulo é importado
// por routes/syncErp.ts (que já importa registry.ts) e potencialmente por sync/filtrosAtivos.ts
// no futuro; manter os dois como valor arriscaria repetir o ciclo corrigido na Fase 3 (ver
// [[import-circular-quebra-array-eager]] no segundo cérebro).
import type { ColunaQuery } from "./consultaSenior";
import type { SyncJobDescriptor } from "./registry";

export interface Dimensao {
  chave: string;
  rotulo: string;
  // Nome do alias LOCAL (Postgres/Prisma) que identifica a dimensão — não a origem, que
  // varia por job. `job.colunas[].alias` é sempre lowercase (convenção do projeto), daí a
  // comparação em `colunaDimensaoDoJob` já ser case-insensitive por segurança, não por
  // necessidade real.
  aliasLocal: string;
}

export const DIMENSOES: Dimensao[] = [{ chave: "codemp", rotulo: "Empresa", aliasLocal: "codemp" }];

export function dimensaoPorChave(chave: string): Dimensao | null {
  return DIMENSOES.find((d) => d.chave === chave) ?? null;
}

/** A coluna (origem + alias) que representa esta dimensão no job, ou `null` se o job não a tem. */
export function colunaDimensaoDoJob(job: SyncJobDescriptor, dimensao: Dimensao): ColunaQuery | null {
  return job.colunas.find((c) => c.alias.toLowerCase() === dimensao.aliasLocal.toLowerCase()) ?? null;
}

export interface JobComDimensao {
  job: SyncJobDescriptor;
  coluna: ColunaQuery;
  // false só nos jobs cuja tabela de origem é uma view USU_V* sem registro no dicionário do
  // Senior (mesmo caso de `temDicionario` no catálogo, Fase 2) — têm a coluna, mas nenhum
  // predicado nela pode ser VALIDADO (validarEMontarPredicado exige o dicionário real), então
  // a propagação pula esses jobs e avisa em vez de tentar salvar algo que sempre falharia.
  filtravel: boolean;
}

/** Todo job que tem essa dimensão — a lista que a propagação percorre. */
export function jobsComDimensao(jobs: SyncJobDescriptor[], dimensao: Dimensao): JobComDimensao[] {
  const resultado: JobComDimensao[] = [];
  for (const job of jobs) {
    const coluna = colunaDimensaoDoJob(job, dimensao);
    if (coluna) resultado.push({ job, coluna, filtravel: job.temDicionario });
  }
  return resultado;
}

/** Jobs SEM a dimensão — cadastro compartilhado que precisa ficar completo por construção
 * (filtrar quebraria a FK/casamento por valor dos jobs que dependem dele). A UI mostra isso
 * explicitamente em vez de deixar parecer que a tabela "esqueceu" de ganhar o filtro. */
export function jobsSemDimensao(jobs: SyncJobDescriptor[], dimensao: Dimensao): SyncJobDescriptor[] {
  return jobs.filter((job) => colunaDimensaoDoJob(job, dimensao) === null);
}
