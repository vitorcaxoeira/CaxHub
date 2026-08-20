import { prisma } from "../db/prisma";

// Upsert em lote via SQL puro (`$executeRawUnsafe`, valores sempre parametrizados — o
// "Unsafe" é só o SQL vir montado como string, mesmo padrão já usado em
// routes/contabil.ts:88/177) — substitui o `for (const row of rows) { await
// prisma.X.upsert(...) }` que hoje faz um round-trip ao Postgres por linha em todo sync
// contábil (~527 mil round-trips/noite; ver nota "PLANEJADO: importação contábil em lote" no
// segundo cérebro pro diagnóstico completo). NUNCA apaga-e-reinsere — só agrupa upserts por
// statement; o ganho vem de juntar linhas num INSERT só, não de evitar o ON CONFLICT.
//
// Responsabilidade de quem chama: cada valor já formatado como string (ou null), pronto pra
// ir num `$n::cast` — nunca number/bigint/Date cru (tira BigInt/Decimal/Date do caminho de
// serialização do driver), e nunca `undefined` (trate como null explícito — o FOR JSON do
// Senior omite chave nula, e é assim que uma coluna que virou NULL lá é limpa aqui também).
// O tipo do parâmetro já força isso: só aceita `string | null`.

export interface ColunaUpsert {
  /** Nome da coluna no Postgres (snake_case final da tabela). */
  nome: string;
  /** Cast explícito aplicado a todo valor desta coluna, ex.: "bigint", "numeric", "date", "text", "int". */
  cast: string;
}

export interface LinhaUpsert {
  /** Chave de dedup dentro do lote — normalmente a concatenação dos valores de PK. */
  chave: string;
  /** Um valor por coluna de `colunas`, na MESMA ordem. */
  valores: (string | null)[];
}

export interface OpcoesUpsertEmLote {
  tabela: string;
  /** Todas as colunas do INSERT (incluindo as de PK), na ordem usada em `LinhaUpsert.valores`. */
  colunas: ColunaUpsert[];
  /** Nomes (snake_case) que formam a cláusula ON CONFLICT. */
  colunasPk: string[];
  /**
   * Quando definido, toda linha ganha `visto_em_sync = <carimbo>` (mesmo valor pra todo o
   * lote — 1 parâmetro só, `$1::timestamptz`, nunca um por linha) e `removido_em_senior =
   * NULL` literal e incondicional, tanto no INSERT quanto no DO UPDATE — reproduz `carimbo()`
   * (varrerRemovidos.ts:101-105) em SQL puro. Omitir pra tabela que não tem essas 2 colunas
   * (ex.: CentroCusto, que hoje não grava carimbo).
   */
  carimbo?: Date;
  /** Linhas por INSERT. Default 1000 (Vitor sugeriu 100 — já captura ~97% do ganho; 1000 é
   * grátis, com 8x de margem sob o teto de parâmetros). Nunca ultrapassa esse teto. */
  tamanhoLote?: number;
}

export interface ResultadoUpsertEmLote {
  /** Linhas realmente gravadas, já após dedup por PK dentro do lote. */
  linhasProcessadas: number;
  lotes: number;
}

const TAMANHO_LOTE_PADRAO = 1000;
// Bind carrega a contagem de parâmetros do statement num Int16 do protocolo — 65535 é o
// teto real, não um número arbitrário escolhido por conservadorismo.
const TETO_PARAMS_PROTOCOLO = 65535;

export async function upsertEmLote(linhas: LinhaUpsert[], opcoes: OpcoesUpsertEmLote): Promise<ResultadoUpsertEmLote> {
  if (linhas.length === 0) return { linhasProcessadas: 0, lotes: 0 };

  // Dedup por PK — `ON CONFLICT DO UPDATE` derruba o lote inteiro (erro 21000
  // cardinality_violation do Postgres) se a mesma chave aparecer 2x no mesmo VALUES; a
  // paginação por OFFSET (runSqlViaSoapPaginated) pode repetir uma linha entre páginas
  // quando o ERP insere no meio da consulta. Map preserva a ordem da PRIMEIRA inserção
  // mesmo quando o valor é sobrescrito depois — mantém a ordem do ORDER BY da paginação,
  // o que evita deadlock entre execuções concorrentes do mesmo job.
  const porChave = new Map<string, LinhaUpsert>();
  for (const linha of linhas) porChave.set(linha.chave, linha);
  const linhasUnicas = [...porChave.values()];

  const colunasNaoPk = opcoes.colunas.filter((c) => !opcoes.colunasPk.includes(c.nome));
  const setUpdate = [
    ...colunasNaoPk.map((c) => `${c.nome} = EXCLUDED.${c.nome}`),
    ...(opcoes.carimbo ? ["visto_em_sync = EXCLUDED.visto_em_sync", "removido_em_senior = NULL"] : []),
  ];
  if (setUpdate.length === 0) {
    throw new Error(`upsertEmLote(${opcoes.tabela}): nenhuma coluna fora da PK pra atualizar — DO UPDATE ficaria vazio`);
  }

  const colunasInsert = [
    ...opcoes.colunas.map((c) => c.nome),
    ...(opcoes.carimbo ? ["visto_em_sync", "removido_em_senior"] : []),
  ];

  const paramsPorLinha = opcoes.colunas.length;
  const paramsBase = opcoes.carimbo ? 1 : 0;
  const tamanhoLote = Math.min(
    opcoes.tamanhoLote ?? TAMANHO_LOTE_PADRAO,
    Math.floor((TETO_PARAMS_PROTOCOLO - paramsBase) / paramsPorLinha)
  );

  let lotes = 0;
  for (let inicio = 0; inicio < linhasUnicas.length; inicio += tamanhoLote) {
    const lote = linhasUnicas.slice(inicio, inicio + tamanhoLote);
    await executarLote(opcoes, lote, colunasInsert, setUpdate);
    lotes++;
  }

  return { linhasProcessadas: linhasUnicas.length, lotes };
}

async function executarLote(
  opcoes: OpcoesUpsertEmLote,
  lote: LinhaUpsert[],
  colunasInsert: string[],
  setUpdate: string[]
): Promise<void> {
  const { sql, params } = montarStatement(opcoes, lote, colunasInsert, setUpdate);
  try {
    await prisma.$executeRawUnsafe(sql, ...params);
  } catch (erro) {
    // Lote falhou — reprocessa linha a linha só pra nomear a culpada (existem CHECKs reais
    // nessas tabelas, ex. chk_rateios_lancamento_debcre). Sem isso o SyncLog diria só "o
    // lote 47 falhou", sem indicar qual das ~1000 linhas foi.
    await diagnosticarFalha(opcoes, lote, colunasInsert, setUpdate);
    throw erro; // nenhuma linha isolada falhou (raro, ex. erro transiente) — relança o original
  }
}

async function diagnosticarFalha(
  opcoes: OpcoesUpsertEmLote,
  lote: LinhaUpsert[],
  colunasInsert: string[],
  setUpdate: string[]
): Promise<void> {
  for (const linha of lote) {
    const { sql, params } = montarStatement(opcoes, [linha], colunasInsert, setUpdate);
    try {
      await prisma.$executeRawUnsafe(sql, ...params);
    } catch (erroLinha) {
      const motivo = erroLinha instanceof Error ? erroLinha.message : String(erroLinha);
      throw new Error(`upsertEmLote(${opcoes.tabela}): linha "${linha.chave}" falhou: ${motivo}`);
    }
  }
}

function montarStatement(
  opcoes: OpcoesUpsertEmLote,
  lote: LinhaUpsert[],
  colunasInsert: string[],
  setUpdate: string[]
): { sql: string; params: (string | null)[] } {
  const params: (string | null)[] = [];
  let proximoParam = 1;

  // Carimbo compartilhado: 1 parâmetro só pro lote inteiro, não 1 por linha.
  let paramCarimbo: number | null = null;
  if (opcoes.carimbo) {
    params.push(opcoes.carimbo.toISOString());
    paramCarimbo = proximoParam++;
  }

  const tuplas = lote.map((linha) => {
    if (linha.valores.length !== opcoes.colunas.length) {
      throw new Error(
        `upsertEmLote(${opcoes.tabela}): linha "${linha.chave}" tem ${linha.valores.length} valores, esperado ${opcoes.colunas.length}`
      );
    }
    const partes = opcoes.colunas.map((coluna, i) => {
      params.push(linha.valores[i]);
      return `$${proximoParam++}::${coluna.cast}`;
    });
    if (opcoes.carimbo) {
      partes.push(`$${paramCarimbo}::timestamptz`, "NULL");
    }
    return `(${partes.join(", ")})`;
  });

  const sql = `
    INSERT INTO ${opcoes.tabela} (${colunasInsert.join(", ")})
    VALUES ${tuplas.join(",\n           ")}
    ON CONFLICT (${opcoes.colunasPk.join(", ")}) DO UPDATE SET
      ${setUpdate.join(",\n      ")}
  `;

  return { sql, params };
}
