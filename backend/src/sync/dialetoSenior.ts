// Literais de data nos SQLs que vão ao Senior pelo "Consulta Genérica".
//
// O ERP segue exatamente como sempre foi no CaxHub: a data entra entre aspas simples
// ('AAAA-MM-DD'), e é isso que `substituirVariavelUltimaSincronizacao` (filtroSenior.ts)
// espera achar quando troca o token da variável "última sincronização".
//
// O HCM (Vetorh) usa CONVERT(date, '...', 23): colunas datetime do RH comparadas com 'AAAA-MM-DD'
// solto dependem do SET DATEFORMAT/LANGUAGE da sessão (com dmy, '2026-10-09' vira 10/09), e o
// estilo 23 (ISO 8601) não depende de nada. A data continua entre aspas simples dentro do
// CONVERT, então a troca do token da variável funciona igual.

import type { SistemaSenior } from "../config/sistemaSenior";

/** Literal de data pronto para entrar em um predicado SQL. `valor` é 'AAAA-MM-DD' (ou o token da
 * variável "última sincronização", que é trocado depois). */
export function literalData(valor: string, sistema: SistemaSenior = "erp"): string {
  const seguro = valor.replace(/'/g, "''");
  return sistema === "hcm" ? `CONVERT(date, '${seguro}', 23)` : `'${seguro}'`;
}

/** Atalho para o corte incremental dos syncs: `CAMPO >= literalData(desde)`. Job sem campo de data
 * não tem sincronização incremental (suportaAlterados = false) e nunca deveria chegar aqui. */
export function predicadoCorteIncremental(campo: string | null, desde: Date, sistema: SistemaSenior = "erp"): string {
  if (campo == null) throw new Error("job sem campo de data não suporta sincronização incremental");
  return `${campo} >= ${literalData(desde.toISOString().slice(0, 10), sistema)}`;
}
