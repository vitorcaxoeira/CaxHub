import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

// Licenças vendidas = regra do Vitor em 19/10/2026, lida do espelho local de E120PED/E120ISP/E120RAT:
//  - pedidos pela data de emissão (E120PED.DatEmi), cancelado (SitPed 5) fora;
//  - itens de serviço do pedido (E120ISP) que têm rateio (E120RAT) na conta financeira 177;
//  - valor = PreUni × QtdPed (VlrBru/VlrLiq do item zeram quando o pedido é liquidado, conferido no Senior);
//  - representante = o do PEDIDO (E120PED.CodRep; o do item diverge em 3 de 132 itens).
// Conferido contra a planilha META 2026: abr–ago idênticos; o "ajuste avulso" de setembro (K27) era pedido da Jennifer.
export const CTAFIN_LICENCAS = 177;
export const SITPED_CANCELADO = 5;

const filtroLicenca = (ano: number) => Prisma.sql`
  EXTRACT(YEAR FROM p.datemi) = ${ano}
  AND p.sitped <> ${SITPED_CANCELADO}
  AND p.removido_em_senior IS NULL AND i.removido_em_senior IS NULL
  AND EXISTS (SELECT 1 FROM pedidos_rateios r
               WHERE r.codemp = i.codemp AND r.codfil = i.codfil AND r.numped = i.numped
                 AND r.seqisp = i.seqisp AND r.ctafin = ${CTAFIN_LICENCAS} AND r.removido_em_senior IS NULL)`;

/** Licenças vendidas no ano por representante do pedido (codrep → 12 meses; 0 = sem pedido no mês). */
export async function licencasVendidasPorRepresentante(ano: number): Promise<Map<number, number[]>> {
  const linhas = await prisma.$queryRaw<{ codrep: number | null; mes: number; valor: number }[]>(Prisma.sql`
    SELECT p.codrep, EXTRACT(MONTH FROM p.datemi)::int AS mes, ROUND(SUM(i.preuni * i.qtdped)::numeric, 2)::float8 AS valor
    FROM pedidos p
    JOIN pedidos_itens_servico i ON i.codemp = p.codemp AND i.codfil = p.codfil AND i.numped = p.numped
    WHERE ${filtroLicenca(ano)}
    GROUP BY p.codrep, EXTRACT(MONTH FROM p.datemi)`);
  const porRep = new Map<number, number[]>();
  for (const l of linhas) {
    const rep = l.codrep ?? 0; // sem representante: cai em "Não atribuído" (nenhuma pessoa tem codrep 0)
    const meses = porRep.get(rep) ?? new Array<number>(12).fill(0);
    meses[l.mes - 1] = Math.round((meses[l.mes - 1] + l.valor) * 100) / 100;
    porRep.set(rep, meses);
  }
  return porRep;
}

export interface PedidoLicenca {
  codemp: number;
  codfil: number;
  numped: number;
  emissao: string;
  sitped: number;
  codcli: number;
  cliente: string | null;
  codrep: number | null;
  representante: string | null;
  servicos: string;
  valor: number;
}

/** Pedidos que formam as Licenças de um mês (mesma regra do total, então a soma é o valor do mês). Maior valor primeiro. */
export async function pedidosLicencas(ano: number, mes: number): Promise<PedidoLicenca[]> {
  return prisma.$queryRaw<PedidoLicenca[]>(Prisma.sql`
    SELECT p.codemp, p.codfil, p.numped, to_char(p.datemi, 'YYYY-MM-DD') AS emissao, p.sitped,
           p.codcli, MIN(c.nomcli) AS cliente, p.codrep, MIN(rp.nomrep) AS representante,
           string_agg(DISTINCT COALESCE(NULLIF(trim(sv.desser), ''), i.codser), ' · ') AS servicos,
           ROUND(SUM(i.preuni * i.qtdped)::numeric, 2)::float8 AS valor
    FROM pedidos p
    JOIN pedidos_itens_servico i ON i.codemp = p.codemp AND i.codfil = p.codfil AND i.numped = p.numped
    LEFT JOIN clientes c ON c.codcli = p.codcli
    LEFT JOIN representantes rp ON rp.codrep = p.codrep
    LEFT JOIN servicos sv ON sv.codemp = i.codemp AND sv.codser = i.codser
    WHERE ${filtroLicenca(ano)} AND EXTRACT(MONTH FROM p.datemi) = ${mes}
    GROUP BY p.codemp, p.codfil, p.numped, p.datemi, p.sitped, p.codcli, p.codrep
    ORDER BY valor DESC, p.numped`);
}
