import { prisma } from "../db/prisma";
import { runSqlViaSoap } from "../soap/client";

// Centro de custo do cliente (rentabilidade, ajuste 01 de 17/11/2026, pedido do Vitor).
//
// E085RAT é o rateio PREVISTO do cliente: 1 cliente pode ter N linhas (codcli, seqrat, codccu...).
// A regra combinada é guardar UM centro de custo por cliente — o maior `codccu` das linhas dele.
// Fica numa query à parte, e não como subselect em BASE_QUERY de clienteSync.ts, porque toda a
// infraestrutura de importação (extrairTabela/extrairColunas, filtros por campo, queryValidator)
// exige "SELECT col AS alias FROM tabela", uma tabela só, sem JOIN nem subselect.
export const QUERY_RATEIO_CLIENTE = "SELECT codcli AS codcli, codccu AS codccu FROM e085rat";

export interface RateioClienteRow {
  codcli: number;
  codccu: string | null;
}

const SO_DIGITOS = /^\d+$/;

/**
 * "Maior" codccu por cliente. `codccu` é varchar(9) no Senior e, comparado como TEXTO, "90" vence
 * "1176" ("9" > "1"); os códigos de centro de custo são numéricos (nenhum não numérico em
 * 17/11/2026), então a comparação é numérica. Código não numérico só vale se o cliente não tiver
 * nenhum numérico (aí vence o maior como texto) — nunca é descartado em silêncio. Hoje cada cliente
 * tem 1 só linha em E085RAT e as duas leituras coincidem; a diferença só aparece quando um cliente
 * passar a ter 2+ rateios.
 */
export function escolherCentroCustoPorCliente(rows: RateioClienteRow[]): Map<number, string> {
  const numericos = new Map<number, string>();
  const textuais = new Map<number, string>();

  for (const row of rows) {
    const cc = row.codccu?.trim();
    if (!cc) continue;
    const alvo = SO_DIGITOS.test(cc) ? numericos : textuais;
    const atual = alvo.get(row.codcli);
    if (atual === undefined) {
      alvo.set(row.codcli, cc);
    } else if (alvo === numericos ? Number(cc) > Number(atual) : cc > atual) {
      alvo.set(row.codcli, cc);
    }
  }

  const resultado = new Map(numericos);
  for (const [codcli, cc] of textuais) if (!resultado.has(codcli)) resultado.set(codcli, cc);
  return resultado;
}

/**
 * Grava `clientes.codccu` a partir do mapa: agrupa por centro de custo (1 UPDATE por CC, não por
 * cliente), só toca linha cujo valor muda, e zera quem deixou de ter rateio previsto. O mapa cobre
 * TODOS os clientes com rateio (a query é completa, ~150 linhas), então a atualização também é
 * completa mesmo quando a sync de clientes roda em modo "alterados".
 */
export async function aplicarCentroCustoNosClientes(mapa: Map<number, string>): Promise<{ gravados: number; zerados: number }> {
  const porCc = new Map<string, number[]>();
  for (const [codcli, cc] of mapa) porCc.set(cc, [...(porCc.get(cc) ?? []), codcli]);

  const resultados = await prisma.$transaction([
    prisma.cliente.updateMany({
      where: { codccu: { not: null }, codcli: { notIn: [...mapa.keys()] } },
      data: { codccu: null },
    }),
    ...[...porCc].map(([cc, codclis]) =>
      prisma.cliente.updateMany({
        where: { codcli: { in: codclis }, OR: [{ codccu: null }, { codccu: { not: cc } }] },
        data: { codccu: cc },
      })
    ),
  ]);

  const [zerados, ...gravacoes] = resultados;
  return { zerados: zerados.count, gravados: gravacoes.reduce((soma, r) => soma + r.count, 0) };
}

/** Lê E085RAT no Senior, escolhe o CC de cada cliente e grava. Devolve o resumo pro log da sync. */
export async function sincronizarCentroCustoDosClientes(): Promise<string> {
  const rows = (await runSqlViaSoap(QUERY_RATEIO_CLIENTE)) as RateioClienteRow[];
  const mapa = escolherCentroCustoPorCliente(rows);
  const { gravados, zerados } = await aplicarCentroCustoNosClientes(mapa);
  return `CC do cliente (E085RAT): ${mapa.size} clientes com rateio, ${gravados} atualizados, ${zerados} zerados`;
}
