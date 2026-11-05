import { prisma } from "../db/prisma";
import { runRatItemSyncPorNumrat } from "./ratItemSync";
import { runRatSyncPorNumrat } from "./ratSync";
import { runRegistroDespesaViagemSyncPorNumrat } from "./registroDespesaViagemSync";

// "Sinc. ERP" de Mercado > Listar Pedidos também traz as RATs que o pedido cita (Pedido.numrat) e que ainda não existem no CaxHub
// (05/11/2026): sem a RAT, Consultor, Proposta, Mod./Sit. Prop. e Faturamento do pedido ficam vazios até o job noturno de RAT.
//
// É a Fase 1 do "Sinc. ERP" da RAT (POST /rats/:id/sincronizar, routes/rats.ts): só LEITURA do Senior, upsert do cabeçalho, dos itens e
// das despesas por numrat. A Fase 2 daquela rota (reenvio de pendências ao Senior) e a desvinculação de ausentes ficam de fora de
// propósito: uma RAT que acabou de chegar do Senior não tem nada local para reenviar nem para desvincular — e aqui nada é escrito no ERP.
//
// Só as que FALTAM (decisão do Vitor): RAT que já existe localmente, com ou sem proposta, não é tocada.

export interface ResultadoSyncRatsFaltantes {
  /** RATs citadas pelos pedidos dos clientes que não existiam no CaxHub. */
  faltantes: number;
  /** Trazidas do Senior (o cabeçalho voltou na consulta). */
  sincronizadas: number;
  /** O Senior não devolveu o cabeçalho (RAT apagada/cancelada lá): nada a trazer, não é erro. */
  naoEncontradas: number;
  /** Falhou ao consultar o Senior; as demais continuam e os pedidos já foram sincronizados. */
  falhas: number;
}

export const SEM_RATS_FALTANTES: ResultadoSyncRatsFaltantes = { faltantes: 0, sincronizadas: 0, naoEncontradas: 0, falhas: 0 };

interface RatCitada {
  codemp: number;
  numrat: number;
}

/** RATs (codemp + numrat distintos) citadas por pedidos dos clientes e ausentes da tabela `rats`. */
export async function ratsCitadasQueFaltam(codclis: number[]): Promise<RatCitada[]> {
  const alvos = [...new Set(codclis)].filter((c) => Number.isInteger(c));
  if (alvos.length === 0) return [];
  const linhas = await prisma.$queryRaw<{ codemp: number; numrat: number }[]>`
    SELECT DISTINCT pe.codemp, pe.numrat::int AS numrat
    FROM pedidos pe
    WHERE pe.removido_em_senior IS NULL
      AND pe.numrat IS NOT NULL AND pe.numrat <= 2147483647
      AND pe.codcli = ANY(${alvos}::int[])
      AND NOT EXISTS (SELECT 1 FROM rats r WHERE r.codemp = pe.codemp AND r.numrat = pe.numrat)
    ORDER BY pe.codemp, numrat`;
  return linhas.map((l) => ({ codemp: Number(l.codemp), numrat: Number(l.numrat) }));
}

export async function sincronizarRatsFaltantesDosPedidos(codclis: number[]): Promise<ResultadoSyncRatsFaltantes> {
  let faltam: RatCitada[];
  try {
    faltam = await ratsCitadasQueFaltam(codclis);
  } catch (error) {
    // Os pedidos já foram sincronizados: não perde esse resultado por causa da consulta local das RATs.
    console.error("[pedidos:rats-faltantes] consulta das RATs faltantes falhou:", error instanceof Error ? error.message : error);
    return { ...SEM_RATS_FALTANTES, falhas: 1 };
  }
  const resultado: ResultadoSyncRatsFaltantes = { ...SEM_RATS_FALTANTES, faltantes: faltam.length };

  for (const { codemp, numrat } of faltam) {
    try {
      const achou = await runRatSyncPorNumrat(codemp, numrat);
      if (!achou) {
        resultado.naoEncontradas += 1;
        continue;
      }
      await runRatItemSyncPorNumrat(codemp, numrat);
      await runRegistroDespesaViagemSyncPorNumrat(codemp, numrat);
      resultado.sincronizadas += 1;
    } catch (error) {
      // Uma RAT com problema não derruba as outras nem a sincronização dos pedidos (que já terminou).
      resultado.falhas += 1;
      console.error(`[pedidos:rats-faltantes] RAT ${numrat} (empresa ${codemp}) falhou:`, error instanceof Error ? error.message : error);
    }
  }
  return resultado;
}
