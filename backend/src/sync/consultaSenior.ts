// Fundação pra filtros na importação (Fase 1 do plano "Filtros na importação do ERP
// Senior"): parsing puro (sem SOAP) da query base de cada job, e o acumulador de
// predicados que substitui a concatenação ad-hoc que existia em cada arquivo.
//
// `extrairTabela`/`extrairColunas` fazem, em memória e sem rede, o mesmo parsing que
// `soap/queryValidator.ts` faz (que além disso confere contra o dicionário do Senior via
// SOAP — validação de verdade, não é este módulo). Aqui só serve pra alimentar o catálogo
// do registry (`tabelaSenior`/`colunas`) a partir da query que cada job já tem, sem
// duplicar a transcrição manual em 35 arquivos.

export interface ColunaQuery {
  /** Nome de origem no Senior (ex.: "USU_CodEmp") — é o que entra num WHERE, nunca o alias. */
  origem: string;
  /** Nome local, o que o SELECT projeta (ex.: "codemp"). */
  alias: string;
}

// Aceita a mesma forma que queryValidator.ts exige de todo job: "SELECT col AS alias, ...
// FROM tabela", uma tabela só, sem JOIN. A tabela pode ter um WHERE já embutido depois do
// FROM (hoje só atividadeConsultorSync.ts) — o regex para no primeiro espaço/quebra.
export function extrairTabela(query: string): string {
  const match = query.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
  if (!match) {
    throw new Error(`extrairTabela: não achei "FROM tabela" na query: ${query}`);
  }
  return match[1];
}

export function extrairColunas(query: string): ColunaQuery[] {
  const match = query.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\s+[a-zA-Z0-9_]+/i);
  if (!match) {
    throw new Error(`extrairColunas: query fora do padrão "SELECT ... FROM tabela": ${query}`);
  }
  return match[1].split(",").map((parte) => {
    const colMatch = parte.trim().match(/^([a-zA-Z0-9_.]+)\s+AS\s+([a-zA-Z0-9_]+)$/i);
    if (!colMatch) {
      throw new Error(`extrairColunas: coluna sem "origem AS alias" reconhecível: "${parte.trim()}"`);
    }
    return { origem: colMatch[1], alias: colMatch[2] };
  });
}

// Acumulador de predicados — substitui a concatenação que cada job fazia à mão
// (`${BASE_QUERY} WHERE ...` ou, no único caso com WHERE já embutido, `${BASE_QUERY} AND
// ...`). Detecta automaticamente qual dos dois casos se aplica, então todo job passa a usar
// a MESMA chamada independente de ter WHERE embutido ou não. Lista vazia devolve a base
// inalterada, byte a byte — é o que garante que ligar este helper (Fase 1) não muda
// nenhuma query hoje; o comportamento só muda quando `predicados` deixar de vir vazio
// (Fase 3, via sync/filtrosAtivos.ts).
//
// `predicados` só pode vir de sync/filtroSenior.ts (Fase 3) — nunca string montada à mão a
// partir de input de usuário. Este módulo não valida nem escapa nada, só junta.
export function montarQuerySenior(baseQuery: string, predicados: string[]): string {
  if (predicados.length === 0) return baseQuery;
  const jaTemWhere = /\bWHERE\b/i.test(baseQuery);
  const juntor = jaTemWhere ? "AND" : "WHERE";
  return `${baseQuery} ${juntor} ${predicados.join(" AND ")}`;
}
