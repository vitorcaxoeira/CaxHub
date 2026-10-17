import { prisma } from "../db/prisma";

// Fonte única de "quanto foi faturado": a Análise de Faturamento (routes/analiseFaturamento.ts) e a Gestão de Metas do Comercial
// (routes/metasComercial.ts) leem daqui, então os dois números nunca divergem.

// Filtro de "NF válida pra faturamento" usado em toda query deste router — mesmo filtro da
// query original de Faturamento que o Vitor deu no início da sessão (WHERE sitnfv='2'), mais o
// par de removido_em_senior de sempre (item e cabeçalho da NF podem ter sumido do Senior
// independentemente um do outro).
export const SITNFV_FECHADA = "2";

// ---------- Fonte canônica de "item faturado" — usada por TODA rota deste módulo ----------
// Nasceu do bug de 24/08/2026 (ver migration/plano): usar rateios_nfv.vlrrat como valor de
// faturamento subestimava o total em ~4,35%, porque o rateio contábil (conta × centro de
// custo) nem sempre fecha 100% do valor bruto do item. A fonte certa é o ITEM da NF
// (itens_servico_nfv/itens_produto_nfv), nunca o rateio. Toda visão nova neste arquivo parte
// desta MESMA CTE — garante que cliente+serviço+UF+recorrência são todos particionamentos do
// mesmo total de /dashboard (conferir isso é o item 1 da seção de Verificação do plano).
//
// Params posicionais fixos em toda query que usa esta CTE: $1=sitnfv, $2=anoMin, $3=anoMax.
// Params adicionais específicos de cada rota começam em $4.
export const CTE_ITENS = `
  itens AS (
    SELECT nf.codcli, nf.codrep, nf.codsnf, nf.numnfv,
           EXTRACT(YEAR FROM nf.datemi)::int AS ano, EXTRACT(MONTH FROM nf.datemi)::int AS mes,
           isv.codser AS codigo, 'S' AS tipo, isv.vlrbru AS valor, isv.numctr AS numctr
    FROM itens_servico_nfv isv
    JOIN notas_fiscais_venda nf
      ON nf.codemp = isv.codemp AND nf.codfil = isv.codfil
      AND nf.codsnf = isv.codsnf AND nf.numnfv = isv.numnfv
    WHERE nf.sitnfv = $1
      AND nf.removido_em_senior IS NULL
      AND isv.removido_em_senior IS NULL
      AND EXTRACT(YEAR FROM nf.datemi) BETWEEN $2 AND $3

    UNION ALL

    SELECT nf.codcli, nf.codrep, nf.codsnf, nf.numnfv,
           EXTRACT(YEAR FROM nf.datemi)::int, EXTRACT(MONTH FROM nf.datemi)::int,
           ipv.codpro, 'P', ipv.vlrbru, ipv.numctr
    FROM itens_produto_nfv ipv
    JOIN notas_fiscais_venda nf
      ON nf.codemp = ipv.codemp AND nf.codfil = ipv.codfil
      AND nf.codsnf = ipv.codsnf AND nf.numnfv = ipv.numnfv
    WHERE nf.sitnfv = $1
      AND nf.removido_em_senior IS NULL
      AND ipv.removido_em_senior IS NULL
      AND EXTRACT(YEAR FROM nf.datemi) BETWEEN $2 AND $3
  )
`;

export interface FaturamentoMes {
  ano: number;
  mes: number;
  valor: number;
}

/** Faturamento (NF fechada, valor bruto dos itens de serviço + produto) por ano e mês, de anoMin a anoMax. Meses sem NF não vêm. */
export function faturamentoMensal(anoMin: number, anoMax: number): Promise<FaturamentoMes[]> {
  return prisma.$queryRawUnsafe<FaturamentoMes[]>(
    `WITH ${CTE_ITENS}
     SELECT ano, mes, SUM(valor)::float8 AS valor
     FROM itens
     GROUP BY ano, mes`,
    SITNFV_FECHADA,
    anoMin,
    anoMax
  );
}
