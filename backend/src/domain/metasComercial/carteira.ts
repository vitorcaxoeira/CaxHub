import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

// Carteira de mensalidades = relatório RVTR101 do Senior (Vendas/Contratos), lido do espelho local de E160CTR/E160CVS:
// itens de serviço ativos de contratos ativos com motivo 500 ("Contratos Vendas Mensalidade"), com serviço
// (E080SER) e cliente de faturamento (E085CLI) existentes. Valor do item = PreUni / DiaPar × QtdCvs (regra LSP do relatório).
// Conferido em 19/10/2026: 1.113 itens, 139 contratos, R$ 938.580,29, igual ao "Total Geral" do relatório. O relatório filtra o
// número do contrato de 1 a 1999; a pedido do Vitor (19/10/2026) essa faixa NÃO é aplicada aqui: entram também os contratos de
// número maior (hoje 2 contratos, R$ 12.998,60), e a carteira passa a R$ 951.578,89.
export const CODMOT_MENSALIDADE = 500;

export interface Carteira {
  valor: number;
  contratos: number;
  itens: number;
}

export type FonteCarteira = "FOTO" | "RECONSTRUIDA";

export async function calcularCarteiraMensalidade(): Promise<Carteira> {
  const [l] = await prisma.$queryRaw<{ valor: number | null; contratos: number; itens: number }[]>(Prisma.sql`
    SELECT ROUND(SUM(s.preuni / NULLIF(c.diapar, 0) * s.qtdcvs)::numeric, 2)::float8 AS valor,
           COUNT(DISTINCT (c.codemp, c.codfil, c.numctr))::int AS contratos,
           COUNT(*)::int AS itens
    FROM contratos_venda_servicos s
    JOIN contratos_venda c ON c.codemp = s.codemp AND c.codfil = s.codfil AND c.numctr = s.numctr
    JOIN servicos sv ON sv.codemp = s.codemp AND sv.codser = s.codser
    JOIN clientes cl ON cl.codcli = c.clifat
    WHERE s.sitcvs = 'A'
      AND c.sitctr = 'A'
      AND c.codmot = ${CODMOT_MENSALIDADE}
      AND s.removido_em_senior IS NULL AND c.removido_em_senior IS NULL
      AND sv.removido_em_senior IS NULL AND cl.removido_em_senior IS NULL`);
  return { valor: l?.valor ?? 0, contratos: l?.contratos ?? 0, itens: l?.itens ?? 0 };
}

/** Ano e mês no fuso de São Paulo (a foto das 6h30 de 1º do mês já é do mês novo, mesmo com o servidor em UTC). */
export function anoMesSaoPaulo(agora: Date): { ano: number; mes: number } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(agora);
  return { ano: Number(partes.find((p) => p.type === "year")!.value), mes: Number(partes.find((p) => p.type === "month")!.value) };
}

/** Primeiro e último dia do mês ('AAAA-MM-DD'). */
export function limitesDoMes(ano: number, mes: number): { ini: string; fim: string } {
  const doisDig = (n: number) => String(n).padStart(2, "0");
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { ini: `${ano}-${doisDig(mes)}-01`, fim: `${ano}-${doisDig(mes)}-${doisDig(ultimo)}` };
}

/**
 * Grava (ou regrava) a foto do mês corrente. A última foto de cada mês fica como o realizado da Mensalidade daquele mês.
 * Carteira sem nenhum item não é gravada: é espelho incompleto (ex.: os contratos sincronizaram e os itens ainda não), nunca
 * uma carteira zerada de verdade, e gravar zero apagaria a foto boa do mês.
 */
export async function fotografarCarteira(agora: Date = new Date()): Promise<Carteira & { ano: number; mes: number; gravou: boolean }> {
  const carteira = await calcularCarteiraMensalidade();
  const { ano, mes } = anoMesSaoPaulo(agora);
  if (carteira.itens === 0) return { ...carteira, ano, mes, gravou: false };
  await prisma.metaComercialCarteira.upsert({
    where: { ano_mes: { ano, mes } },
    create: { ano, mes, valor: carteira.valor, contratos: carteira.contratos, itens: carteira.itens, capturadoEm: agora, fonte: "FOTO" },
    update: { valor: carteira.valor, contratos: carteira.contratos, itens: carteira.itens, capturadoEm: agora, fonte: "FOTO" },
  });
  return { ...carteira, ano, mes, gravou: true };
}

/**
 * Carteira de um mês PASSADO, reconstruída (o Senior só mostra a carteira do momento). Validada com o Vitor em 19/10/2026 contra
 * o faturado em NF dos contratos com motivo 500: fev–out de 2026 a até 3%, jan +5,8%. Regra, para o mês M:
 *  - contrato motivo 500 (qualquer número), ativo hoje OU com último faturamento (DatUft) a partir de M;
 *  - item ativo hoje OU faturado a partir de M, e com início de vigência até o fim de M (31/12/1900 = item antigo);
 *  - preço = PreUni de hoje desfazendo os reajustes posteriores a M (E160REA com VlrAtu > 0: vale o preço anterior ao primeiro
 *    reajuste depois de M) e descontando os upgrades posteriores a M (linhas de E160REA com VlrAtu = 0 e USU_VlrUpg);
 *  - valor = preço / DiaPar × QtdCvs (a quantidade não tem histórico: vale a de hoje).
 * Limites: o upgrade registrado não bate exatamente com a mudança de preço; contratos encerrados perto do início do mês sobram.
 */
export async function reconstruirCarteiraMensalidade(ano: number, mes: number): Promise<Carteira> {
  const { ini, fim } = limitesDoMes(ano, mes);
  const [l] = await prisma.$queryRaw<{ valor: number | null; contratos: number; itens: number }[]>(Prisma.sql`
    WITH base AS (
      SELECT c.codemp, c.codfil, c.numctr, c.diapar, s.qtdcvs,
             COALESCE((SELECT r.vlratu - COALESCE(r.vlrrea, 0) FROM contratos_venda_reajustes r
                        WHERE r.codemp = s.codemp AND r.codfil = s.codfil AND r.numctr = s.numctr AND r.datcpt = s.datcpt
                          AND r.seqcvs = s.seqcvs AND r.seqcvp = 0 AND r.vlratu > 0 AND r.removido_em_senior IS NULL
                          AND r.ultrea > ${fim}::date
                        ORDER BY r.ultrea LIMIT 1), s.preuni) AS preco,
             COALESCE((SELECT SUM(r.usu_vlrupg) FROM contratos_venda_reajustes r
                        WHERE r.codemp = s.codemp AND r.codfil = s.codfil AND r.numctr = s.numctr AND r.datcpt = s.datcpt
                          AND r.seqcvs = s.seqcvs AND r.seqcvp = 0 AND COALESCE(r.vlratu, 0) = 0 AND r.removido_em_senior IS NULL
                          AND r.ultrea > ${fim}::date), 0) AS upgrades
      FROM contratos_venda_servicos s
      JOIN contratos_venda c ON c.codemp = s.codemp AND c.codfil = s.codfil AND c.numctr = s.numctr
      JOIN servicos sv ON sv.codemp = s.codemp AND sv.codser = s.codser
      JOIN clientes cl ON cl.codcli = c.clifat
      WHERE c.codmot = ${CODMOT_MENSALIDADE}
        AND (c.sitctr = 'A' OR c.datuft >= ${ini}::date)
        AND (s.sitcvs = 'A' OR s.datuft >= ${ini}::date)
        AND (s.inivig IS NULL OR s.inivig <= ${fim}::date OR EXTRACT(YEAR FROM s.inivig) = 1900)
        AND s.removido_em_senior IS NULL AND c.removido_em_senior IS NULL
        AND sv.removido_em_senior IS NULL AND cl.removido_em_senior IS NULL
    )
    SELECT ROUND(SUM(GREATEST(preco - upgrades, 0) / NULLIF(diapar, 0) * qtdcvs)::numeric, 2)::float8 AS valor,
           COUNT(DISTINCT (codemp, codfil, numctr))::int AS contratos,
           COUNT(*)::int AS itens
    FROM base`);
  return { valor: l?.valor ?? 0, contratos: l?.contratos ?? 0, itens: l?.itens ?? 0 };
}

/**
 * Preenche os meses do ano corrente ANTERIORES ao mês atual que não têm foto real (fonte FOTO) com a carteira reconstruída.
 * Foto real nunca é sobrescrita; mês reconstruído é refeito a cada chamada (o espelho pode ter mudado). Devolve o que gravou.
 */
export async function reconstruirMesesSemFoto(agora: Date = new Date()): Promise<Array<Carteira & { mes: number }>> {
  const { ano, mes: mesAtual } = anoMesSaoPaulo(agora);
  const existentes = await prisma.metaComercialCarteira.findMany({ where: { ano }, select: { mes: true, fonte: true } });
  const comFoto = new Set(existentes.filter((e) => e.fonte === "FOTO").map((e) => e.mes));
  const gravados: Array<Carteira & { mes: number }> = [];
  for (let mes = 1; mes < mesAtual; mes++) {
    if (comFoto.has(mes)) continue;
    const c = await reconstruirCarteiraMensalidade(ano, mes);
    if (c.itens === 0) continue;
    // `fonte` na condição: se uma foto real entrou nesse meio tempo, não pisa nela.
    const atualizou = await prisma.metaComercialCarteira.updateMany({
      where: { ano, mes, fonte: "RECONSTRUIDA" },
      data: { valor: c.valor, contratos: c.contratos, itens: c.itens, capturadoEm: agora },
    });
    if (atualizou.count === 0) {
      await prisma.metaComercialCarteira.createMany({
        data: [{ ano, mes, valor: c.valor, contratos: c.contratos, itens: c.itens, capturadoEm: agora, fonte: "RECONSTRUIDA" }],
        skipDuplicates: true,
      });
    }
    gravados.push({ ...c, mes });
  }
  return gravados;
}

/** Carteira do ano (12 posições, null = mês sem valor), a fonte de cada mês e o instante da foto real mais recente. */
export async function carteiraDoAno(ano: number): Promise<{ mensal: Array<number | null>; fontes: Array<FonteCarteira | null>; ultimaFoto: Date | null }> {
  const fotos = await prisma.metaComercialCarteira.findMany({ where: { ano } });
  const mensal = new Array<number | null>(12).fill(null);
  const fontes = new Array<FonteCarteira | null>(12).fill(null);
  let ultimaFoto: Date | null = null;
  for (const f of fotos) {
    mensal[f.mes - 1] = Number(f.valor);
    fontes[f.mes - 1] = f.fonte as FonteCarteira;
    if (f.fonte === "FOTO" && (!ultimaFoto || f.capturadoEm > ultimaFoto)) ultimaFoto = f.capturadoEm;
  }
  return { mensal, fontes, ultimaFoto };
}

/** Chamada ao fim das sincronizações de contratos, itens e reajustes: foto do mês e reconstrução dos meses sem foto. Nunca
 * derruba a sync que a disparou. */
export async function fotografarCarteiraSemFalhar(origem: string): Promise<void> {
  try {
    const f = await fotografarCarteira();
    console.log(
      f.gravou
        ? `[metas-carteira] foto ${f.mes}/${f.ano} após ${origem}: R$ ${f.valor.toFixed(2)} (${f.contratos} contratos, ${f.itens} itens)`
        : `[metas-carteira] foto ${f.mes}/${f.ano} não gravada após ${origem}: carteira sem itens (espelho incompleto)`
    );
    const reconstruidos = await reconstruirMesesSemFoto();
    if (reconstruidos.length > 0) console.log(`[metas-carteira] ${reconstruidos.length} mês(es) sem foto reconstruído(s) após ${origem}`);
  } catch (error) {
    console.error(`[metas-carteira] foto falhou após ${origem}:`, error instanceof Error ? error.message : String(error));
  }
}
