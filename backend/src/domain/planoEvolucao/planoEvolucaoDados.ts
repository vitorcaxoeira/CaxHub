import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { RAT_ITEM_VALIDO } from "../eficienciaDados";
import { SITPRO_GANHAS } from "../propostasDominio";
import { HoraComOrigem, OrigemDaHora } from "./eficienciaIndividual";
import { HoraApontada, ItemNoCiclo } from "./eficienciaItens";

// Plano de Evolução Profissional e Eficiência — tudo que vem do banco. A conta mora em domain/planoEvolucao/*.ts (puro).
//
// Fonte do EXECUTADO: RatItem válido (a mesma regra `RAT_ITEM_VALIDO` do Painel de Eficiência: RAT não cancelada, nada removido no Senior,
// duração positiva), por (codemp, codpro, seqite). NÃO usa atividade atribuída, seqati, quadro Kanban nem as exclusões "só do painel"
// (essas valem apenas na tela do painel, ver domain/eficienciaExclusoes.ts). As sessões Start/Stop ainda não confirmadas ficam de fora:
// viram RatItem quando o consultor confirma, e entram no ciclo pela data do apontamento.

export interface PeriodoDoCiclo {
  /** "AAAA-MM-DD" */
  inicio: string;
  fim: string;
  /** depexe do ITEM da proposta que formam a área. */
  departamentosArea: number[];
}

interface LinhaHora {
  codemp: number;
  codpro: number;
  seqite: number;
  vendido: number;
  id: number;
  codfor: number | null;
  minutos: number;
}

/**
 * Itens da área com horas apontadas no ciclo, já com o que cada um tinha executado ANTES do ciclo e as horas do ciclo em ordem
 * cronológica (data, hora inicial, id). Só entram itens de propostas ganhas (aprovada, em execução ou executada) e não removidas do Senior.
 */
export async function carregarItensDoCiclo(periodo: PeriodoDoCiclo): Promise<ItemNoCiclo[]> {
  if (periodo.departamentosArea.length === 0) return [];
  const ganhas = [...SITPRO_GANHAS];
  const [horas, antes] = await Promise.all([
    prisma.$queryRaw<LinhaHora[]>`
      SELECT pi.codemp, pi.codpro, pi.seqite, COALESCE(pi.qtdhor, 0)::int AS vendido,
             ri.id, r.codfor, (ri.horfim - ri.horini)::int AS minutos
      FROM propostas_itens pi
      JOIN propostas p ON p.codemp = pi.codemp AND p.codpro = pi.codpro
      JOIN rat_itens ri ON ri.codemp = pi.codemp AND ri.codpro = pi.codpro AND ri.seqite = pi.seqite
      JOIN rats r ON r.id = ri."ratId"
      WHERE pi.removido_em_senior IS NULL AND p.removido_em_senior IS NULL
        AND p.sitpro = ANY(${ganhas}::int[]) AND pi.depexe = ANY(${periodo.departamentosArea}::int[])
        AND ${RAT_ITEM_VALIDO}
        AND ri.datati >= ${periodo.inicio}::date AND ri.datati <= ${periodo.fim}::date
      ORDER BY pi.codemp, pi.codpro, pi.seqite, ri.datati, ri.horini, ri.id
    `,
    prisma.$queryRaw<{ codemp: number; codpro: number; seqite: number; minutos: number }[]>`
      SELECT ri.codemp, ri.codpro, ri.seqite, SUM(ri.horfim - ri.horini)::int AS minutos
      FROM propostas_itens pi
      JOIN propostas p ON p.codemp = pi.codemp AND p.codpro = pi.codpro
      JOIN rat_itens ri ON ri.codemp = pi.codemp AND ri.codpro = pi.codpro AND ri.seqite = pi.seqite
      JOIN rats r ON r.id = ri."ratId"
      WHERE pi.removido_em_senior IS NULL AND p.removido_em_senior IS NULL
        AND p.sitpro = ANY(${ganhas}::int[]) AND pi.depexe = ANY(${periodo.departamentosArea}::int[])
        AND ${RAT_ITEM_VALIDO}
        AND ri.datati < ${periodo.inicio}::date
      GROUP BY ri.codemp, ri.codpro, ri.seqite
    `,
  ]);

  const executadoAntes = new Map(antes.map((a) => [`${a.codemp}-${a.codpro}-${a.seqite}`, a.minutos]));
  const itens = new Map<string, ItemNoCiclo>();
  for (const h of horas) {
    const chave = `${h.codemp}-${h.codpro}-${h.seqite}`;
    let item = itens.get(chave);
    if (!item) {
      item = { codemp: h.codemp, codpro: h.codpro, seqite: h.seqite, vendido: h.vendido, executadoAntes: executadoAntes.get(chave) ?? 0, horas: [] };
      itens.set(chave, item);
    }
    const hora: HoraApontada = { id: h.id, codfor: h.codfor, minutos: h.minutos };
    item.horas.push(hora);
  }
  return [...itens.values()];
}

/**
 * Horas de cada consultor no ciclo, por ORIGEM (medida na Fase 0), para o indicador de apontamento online. Conta TODAS as horas do
 * consultor no ciclo (não só as da área): o regulamento fala em apontar online, não em onde. Devolve linhas já agregadas por
 * (consultor, origem, atraso): `atrasoDias` 0 = registrado no mesmo dia, 1 = depois, null = sem data de registro ou não se aplica.
 */
export async function carregarHorasPorOrigem(inicio: string, fim: string, codfors: number[]): Promise<Map<number, HoraComOrigem[]>> {
  const saida = new Map<number, HoraComOrigem[]>();
  if (codfors.length === 0) return saida;
  const linhas = await prisma.$queryRaw<{ codfor: number; origem: OrigemDaHora; atraso: number | null; minutos: number }[]>`
    SELECT r.codfor,
           CASE WHEN se.id IS NULL THEN 'senior'
                WHEN EXISTS (SELECT 1 FROM solicitacoes_apontamento s WHERE s."sessaoId" = se.id) THEN 'solicitacao'
                WHEN EXTRACT(EPOCH FROM (se."criadoEm" - se.inicio)) <= 300 THEN 'ao_vivo'
                ELSE 'sessao_tardia' END AS origem,
           CASE WHEN se.id IS NOT NULL OR ri.datreg IS NULL THEN NULL WHEN ri.datreg - ri.datati <= 0 THEN 0 ELSE 1 END AS atraso,
           SUM(ri.horfim - ri.horini)::int AS minutos
    FROM rat_itens ri
    JOIN rats r ON r.id = ri."ratId"
    LEFT JOIN LATERAL (
      SELECT x.id, x."criadoEm", x.inicio FROM atividade_sessoes_execucao x WHERE x."ratItemId" = ri.id AND x."excluidaEm" IS NULL LIMIT 1
    ) se ON true
    WHERE ${RAT_ITEM_VALIDO}
      AND ri.datati >= ${inicio}::date AND ri.datati <= ${fim}::date
      AND r.codfor = ANY(${codfors}::int[])
    GROUP BY 1, 2, 3
  `;
  for (const l of linhas) {
    const lista = saida.get(l.codfor) ?? [];
    lista.push({ minutos: l.minutos, origem: l.origem, atrasoDias: l.atraso });
    saida.set(l.codfor, lista);
  }
  return saida;
}

/** Nome e departamento de cada consultor (cadastro do Senior). */
export async function carregarNomesDeConsultores(codfors: number[]): Promise<Map<number, { nome: string; departamento: string | null }>> {
  const mapa = new Map<number, { nome: string; departamento: string | null }>();
  if (codfors.length === 0) return mapa;
  const linhas = await prisma.consultor.findMany({ where: { codfor: { in: codfors } }, select: { codfor: true, nomcom: true, nomfor: true, depexedes: true } });
  for (const c of linhas) {
    if (c.codfor == null || mapa.has(c.codfor)) continue;
    mapa.set(c.codfor, { nome: c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`, departamento: c.depexedes ?? null });
  }
  return mapa;
}

/** Valor Hora Base vigente (o lançamento mais recente com `desde` <= data), em centavos. null = nenhum. */
export function baseVigenteEm(valores: { valorHoraBase: Prisma.Decimal | number | string; desde: Date }[], dataIso: string): number | null {
  const vigentes = valores.filter((v) => v.desde.toISOString().slice(0, 10) <= dataIso).sort((a, b) => b.desde.getTime() - a.desde.getTime());
  if (vigentes.length === 0) return null;
  return Math.round(Number(vigentes[0].valorHoraBase) * 100);
}
