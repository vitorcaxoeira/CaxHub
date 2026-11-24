import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import type { EntidadeAuditoriaTipo, EventoAuditoriaTipo, OrigemAuditoria } from "../audit/taxonomia";
import { diaBrasilComoData } from "./fusoBrasil";
import {
  numeroDoProcesso,
  SITUACAO_PARCELA_ROTULO,
  somarReais,
  statusDoProcesso,
  type SituacaoParcela,
  type StatusProcesso,
} from "./descontos";

// Acesso ao banco da Gestão de Descontos que mais de uma rota/job usa (sequência, status, auditoria e o detalhe por competência da Home).

export type Tx = Prisma.TransactionClient;

export const dec = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));
export const isoDia = (d: Date) => d.toISOString().slice(0, 10);
export const isoCompetencia = (d: Date) => d.toISOString().slice(0, 7);

/** Hoje, no dia de Brasília (produção roda em UTC: depois das 21h o dia UTC já é amanhã). */
export const hojeBrasil = () => diaBrasilComoData(new Date());

/** Próximo número do processo no ano: uma linha por ano, incrementada na MESMA transação que cria o processo (sem buraco nem repetição). */
export async function proximaSequencia(tx: Tx, ano: number): Promise<number> {
  const r = await tx.descontoSequencia.upsert({ where: { ano }, create: { ano, ultimo: 1 }, update: { ultimo: { increment: 1 } } });
  return r.ultimo;
}

/** Reavalia o status do processo a partir das parcelas e grava se mudou. */
export async function recalcularStatusDoProcesso(tx: Tx, processoId: number): Promise<StatusProcesso> {
  const processo = await tx.descontoProcesso.findUniqueOrThrow({ where: { id: processoId }, select: { vigenciaFim: true, status: true } });
  const parcelas = await tx.descontoParcela.findMany({ where: { processoId }, select: { situacao: true } });
  const status = statusDoProcesso(parcelas as { situacao: SituacaoParcela }[], processo.vigenciaFim, hojeBrasil());
  if (status !== processo.status) await tx.descontoProcesso.update({ where: { id: processoId }, data: { status } });
  return status;
}

export interface AuditoriaDesconto {
  usuarioId: number | null;
  origem: OrigemAuditoria;
  correlationId: string;
  entidadeTipo: EntidadeAuditoriaTipo;
  entidadeId: string;
  rotulo: string;
  evento: EventoAuditoriaTipo;
  alteracoes?: Parameters<typeof criarEventoAuditoria>[0]["alteracoes"];
  metadata?: Record<string, unknown> | null;
}

export function auditarDesconto(tx: Tx, a: AuditoriaDesconto) {
  return criarEventoAuditoria(
    {
      origem: a.origem,
      usuarioId: a.usuarioId,
      entidadeTipo: a.entidadeTipo,
      entidadeId: a.entidadeId,
      entidadeRotulo: a.rotulo,
      eventoTipo: a.evento,
      alteracoes: a.alteracoes ?? null,
      metadata: a.metadata ?? null,
      correlationId: a.correlationId,
    },
    tx
  );
}

export const rotuloDoProcesso = (p: { ano: number; sequencia: number }) => numeroDoProcesso(p.ano, p.sequencia);

export interface ItemDescontoCompetencia {
  parcelaId: number;
  processoId: number;
  processo: string;
  tipo: string;
  numero: number;
  qtdParcelas: number;
  valor: number;
  valorDescontado: number;
  vencimento: string;
  situacao: SituacaoParcela;
  situacaoRotulo: string;
  /** O que ainda falta descontar do processo depois desta competência (parcelas pendentes de meses seguintes, inclusive o saldo transportado). */
  saldoRemanescente: number;
  observacao: string | null;
  /** Veio de saldo que não coube na nota do mês anterior. */
  transportada: boolean;
}

export interface DescontoCompetencia {
  competencia: string; // AAAA-MM
  ano: number;
  mes: number;
  /** Quanto sai da nota neste mês: o já descontado (mês fechado) + o previsto das parcelas ainda pendentes. */
  total: number;
  fechada: boolean;
  /** O mês fechou e a nota não cobriu tudo: parte do desconto seguiu para o mês seguinte. */
  parcial: boolean;
  itens: ItemDescontoCompetencia[];
}

const SITUACOES_NA_NOTA: SituacaoParcela[] = ["pendente", "descontada", "parcial"];

/**
 * Os descontos de um consultor em cada competência pedida (só parcelas que pesam na nota: pendente, descontada e parcial; cancelada,
 * estornada e quitada antecipadamente não entram). Alimenta o card da Home e o modal de detalhe.
 */
export async function descontosPorCompetencia(codemp: number, codfor: number, competencias: Date[]): Promise<DescontoCompetencia[]> {
  if (competencias.length === 0) return [];
  const [parcelas, fechamentos] = await Promise.all([
    prisma.descontoParcela.findMany({
      where: { competencia: { in: competencias }, situacao: { in: SITUACOES_NA_NOTA }, processo: { codemp, codfor } },
      include: { processo: { include: { tipo: true } } },
      orderBy: [{ vencimento: "asc" }, { processoId: "asc" }, { numero: "asc" }],
    }),
    prisma.descontoFechamento.findMany({ where: { codemp, codfor, competencia: { in: competencias } }, select: { competencia: true } }),
  ]);

  // Saldo que sobra de cada processo DEPOIS de cada competência: pendentes de meses seguintes.
  const processoIds = [...new Set(parcelas.map((p) => p.processoId))];
  const pendentes = processoIds.length
    ? await prisma.descontoParcela.findMany({
        where: { processoId: { in: processoIds }, situacao: "pendente" },
        select: { processoId: true, competencia: true, valor: true },
      })
    : [];
  const saldoApos = (processoId: number, competencia: Date) =>
    somarReais(pendentes.filter((p) => p.processoId === processoId && p.competencia.getTime() > competencia.getTime()).map((p) => dec(p.valor)));

  const fechadas = new Set(fechamentos.map((f) => f.competencia.getTime()));
  return competencias.map((competencia) => {
    const doMes = parcelas.filter((p) => p.competencia.getTime() === competencia.getTime());
    const itens: ItemDescontoCompetencia[] = doMes.map((p) => ({
      parcelaId: p.id,
      processoId: p.processoId,
      processo: rotuloDoProcesso(p.processo),
      tipo: p.processo.tipo.nome,
      numero: p.numero,
      qtdParcelas: p.processo.qtdParcelas,
      valor: dec(p.valor),
      valorDescontado: dec(p.valorDescontado),
      vencimento: isoDia(p.vencimento),
      situacao: p.situacao as SituacaoParcela,
      situacaoRotulo: SITUACAO_PARCELA_ROTULO[p.situacao as SituacaoParcela] ?? p.situacao,
      saldoRemanescente: saldoApos(p.processoId, competencia),
      observacao: p.observacao,
      transportada: p.origemParcelaId != null,
    }));
    const total = somarReais(itens.map((i) => (i.situacao === "pendente" ? i.valor : i.valorDescontado)));
    return {
      competencia: isoCompetencia(competencia),
      ano: competencia.getUTCFullYear(),
      mes: competencia.getUTCMonth() + 1,
      total,
      fechada: fechadas.has(competencia.getTime()),
      parcial: itens.some((i) => i.situacao === "parcial"),
      itens,
    };
  });
}
