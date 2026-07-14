import { getTableFields, SeniorField } from "./metadata";

export interface ParsedColumn {
  source: string;
  alias: string;
}

export interface ValidatedQuery {
  tableName: string;
  columns: ParsedColumn[];
  fields: SeniorField[];
}

/**
 * Valida queries no padrão único usado pelos jobs de sincronização deste
 * projeto: `SELECT col1 AS col1, col2 AS col2, ... FROM tabela` (uma tabela
 * só, sem JOIN, toda coluna com alias explícito). Fora desse padrão, lança
 * erro pedindo para montar a query/job manualmente.
 */
export async function validateQuery(query: string): Promise<ValidatedQuery> {
  const match = query.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\s+([a-zA-Z0-9_]+)\s*;?\s*$/i);
  if (!match) {
    throw new Error(
      "Query fora do padrão suportado (SELECT col AS col, ... FROM tabela). Monte o model/job manualmente para este caso."
    );
  }

  const [, columnsRaw, tableName] = match;

  const columns: ParsedColumn[] = columnsRaw.split(",").map((part) => {
    const columnMatch = part.trim().match(/^([a-zA-Z0-9_]+)\s+AS\s+([a-zA-Z0-9_]+)$/i);
    if (!columnMatch) {
      throw new Error(
        `Coluna sem alias explícito ou em formato inesperado: "${part.trim()}". Toda coluna precisa ser "campo AS alias".`
      );
    }
    const [, source, alias] = columnMatch;
    return { source, alias };
  });

  const fields = await getTableFields(tableName);
  if (fields.length === 0) {
    throw new Error(`Tabela "${tableName}" não encontrada (ou sem campos) em r996fld.`);
  }

  const realFieldNames = new Set(fields.map((f) => f.fldnam.toLowerCase()));
  for (const column of columns) {
    if (!realFieldNames.has(column.source.toLowerCase())) {
      throw new Error(
        `Coluna "${column.source}" não existe em "${tableName}" (conferido contra r996fld). Verifique se não é um typo.`
      );
    }
  }

  return { tableName, columns, fields };
}
