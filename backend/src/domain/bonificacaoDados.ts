import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ENTIDADES_AUDITORIA } from "../audit/taxonomia";
import {
  ativoNoMes,
  calcularIndicador,
  emReais,
  regraVigente,
  valorEfetivo,
  type FaixaRegra,
  type FonteIndicador,
  type SentidoIndicador,
} from "./bonificacao";
import { apurarIndicador, type Apurado, type ContextoApuracao } from "./bonificacaoApuracao";
import { auditarDesconto, dec, isoCompetencia, isoDia, type Tx } from "./descontosDados";

// Acesso ao banco da Gestão de Bonificação que mais de uma rota/job usa: apuração do fechamento, recálculo de um resultado e auditoria.
// A auditoria reaproveita o gravador de Descontos (é genérico: só recebe tipo de entidade e de evento da taxonomia).

export { dec, isoCompetencia, isoDia };
export type { Tx };
export const auditarBonificacao = auditarDesconto;

export class ErroBonificacao extends Error {
  constructor(message: string, public readonly status = 409) {
    super(message);
  }
}

export const faixasDoBanco = (faixas: { ordem: number; limite: Prisma.Decimal | null; pontos: Prisma.Decimal }[]): FaixaRegra[] =>
  [...faixas].sort((a, b) => a.ordem - b.ordem).map((f) => ({ limite: f.limite == null ? null : Number(f.limite), pontos: Number(f.pontos) }));

interface Calculado {
  pontos: number | null;
  valorBase: number | null;
  valor: number | null;
}

/** Pontos e valor a partir do valor efetivo; sem valor ou sem regra o resultado fica pendente (tudo nulo). */
export function calcularLinha(
  regra: { valorBase: number; faixas: FaixaRegra[] } | null,
  sentido: SentidoIndicador,
  apurado: number | null,
  informado: number | null
): Calculado {
  const efetivo = valorEfetivo(apurado, informado);
  if (regra == null) return { pontos: null, valorBase: null, valor: null };
  if (efetivo == null) return { pontos: null, valorBase: regra.valorBase, valor: null };
  const r = calcularIndicador(efetivo, regra, sentido);
  return { pontos: r.pontos, valorBase: regra.valorBase, valor: emReais(r.centavos) };
}

export interface ResumoApuracao {
  fechamentoId: number;
  consultores: number;
  resultados: number;
  pendentes: number;
}

const rotuloFechamento = (processo: string, competencia: Date) => `${processo} · ${isoCompetencia(competencia)}`;

/**
 * Apura (ou recalcula) o fechamento do processo na competência: para cada consultor enquadrado no mês e cada indicador ativo com regra vigente,
 * busca o valor (Kyria/HCM) e grava pontos e valor. O que a pessoa INFORMOU é preservado. Competência fechada não recalcula (reabra antes).
 * As consultas ao Kyria/HCM rodam FORA da transação (são lentas); a gravação é uma transação só.
 */
export async function apurarFechamento(args: { processoId: number; competencia: Date; usuarioId: number | null; origem: "tela" | "job"; correlationId: string }): Promise<ResumoApuracao> {
  const { processoId, competencia } = args;
  const processo = await prisma.bonificacaoProcesso.findUnique({
    where: { id: processoId },
    include: {
      indicadores: { where: { ativo: true }, orderBy: { ordem: "asc" }, include: { regras: { include: { faixas: true } } } },
      enquadramentos: { include: { times: true } },
    },
  });
  if (!processo) throw new ErroBonificacao("Processo não encontrado", 404);
  if (!processo.ativo) throw new ErroBonificacao("Processo inativo: não há apuração");
  const existente = await prisma.bonificacaoFechamento.findUnique({ where: { processoId_competencia: { processoId, competencia } } });
  if (existente?.situacao === "fechado") throw new ErroBonificacao("Esta competência já está fechada: reabra para recalcular");

  const enquadrados = processo.enquadramentos.filter((e) => ativoNoMes({ inicio: e.vigenciaInicio, fim: e.vigenciaFim }, competencia));
  const memo = new Map<string, Promise<Apurado>>();
  const apurar = (fonte: FonteIndicador, ctx: ContextoApuracao): Promise<Apurado> => {
    // Capacidade, eficiência e chamados antigos dependem só dos times (e da idade): consultores com os mesmos times dividem a consulta.
    const chave = fonte === "kyria_pct_ponto" ? `${fonte}|${ctx.codemp}|${ctx.codfor}` : `${fonte}|${[...ctx.timesIds].sort().join(",")}|${ctx.idadeMeses ?? ""}`;
    let p = memo.get(chave);
    if (!p) {
      p = apurarIndicador(fonte, ctx).catch((e): Apurado => ({ valor: null, detalhe: { motivo: `Falha na apuração: ${e instanceof Error ? e.message : String(e)}` } }));
      memo.set(chave, p);
    }
    return p;
  };

  interface Linha {
    codemp: number;
    codfor: number;
    indicadorId: number;
    regraId: number | null;
    apurado: number | null;
    detalhe: Record<string, unknown>;
    sentido: SentidoIndicador;
    regra: { valorBase: number; faixas: FaixaRegra[] } | null;
  }
  const linhas: Linha[] = [];
  for (const enq of enquadrados) {
    const timesIds = enq.times.map((t) => t.kyriaTeamId);
    for (const ind of processo.indicadores) {
      const regraDb = regraVigente(ind.regras, competencia);
      const regra = regraDb ? { valorBase: Number(regraDb.valorBase), faixas: faixasDoBanco(regraDb.faixas) } : null;
      let apurado: Apurado = { valor: null, detalhe: {} };
      if (regraDb && ind.fonte !== "manual") {
        apurado = await apurar(ind.fonte as FonteIndicador, { competencia, codemp: enq.codemp, codfor: enq.codfor, timesIds, idadeMeses: regraDb.idadeMeses });
      } else if (!regraDb) {
        apurado = { valor: null, detalhe: { motivo: "Sem regra vigente nesta competência" } };
      }
      linhas.push({ codemp: enq.codemp, codfor: enq.codfor, indicadorId: ind.id, regraId: regraDb?.id ?? null, apurado: apurado.valor, detalhe: apurado.detalhe, sentido: ind.sentido as SentidoIndicador, regra });
    }
  }

  return prisma.$transaction(
    async (tx) => {
      const fechamento = existente ?? (await tx.bonificacaoFechamento.create({ data: { processoId, competencia } }));
      const atuais = await tx.bonificacaoResultado.findMany({ where: { fechamentoId: fechamento.id } });
      const porChave = new Map(atuais.map((r) => [`${r.codfor}|${r.indicadorId}`, r]));
      let pendentes = 0;
      for (const l of linhas) {
        const atual = porChave.get(`${l.codfor}|${l.indicadorId}`);
        const informado = atual?.valorInformado == null ? null : Number(atual.valorInformado);
        const c = calcularLinha(l.regra, l.sentido, l.apurado, informado);
        if (c.valor == null) pendentes++;
        const dados = {
          codemp: l.codemp,
          regraId: l.regraId,
          valorApurado: l.apurado,
          pontos: c.pontos,
          valorBase: c.valorBase,
          valor: c.valor,
          detalhe: l.detalhe as Prisma.InputJsonValue,
        };
        await tx.bonificacaoResultado.upsert({
          where: { fechamentoId_codfor_indicadorId: { fechamentoId: fechamento.id, codfor: l.codfor, indicadorId: l.indicadorId } },
          create: { fechamentoId: fechamento.id, codfor: l.codfor, indicadorId: l.indicadorId, ...dados },
          update: dados,
        });
      }
      // Quem saiu do enquadramento (ou indicador desativado) some do fechamento aberto, a menos que tenha valor digitado (esse a pessoa decide).
      const vivos = new Set(linhas.map((l) => `${l.codfor}|${l.indicadorId}`));
      const orfaos = atuais.filter((r) => !vivos.has(`${r.codfor}|${r.indicadorId}`) && r.valorInformado == null).map((r) => r.id);
      if (orfaos.length) await tx.bonificacaoResultado.deleteMany({ where: { id: { in: orfaos } } });
      await tx.bonificacaoFechamento.update({ where: { id: fechamento.id }, data: { apuradoEm: new Date() } });
      await auditarBonificacao(tx, {
        usuarioId: args.usuarioId,
        origem: args.origem,
        correlationId: args.correlationId,
        entidadeTipo: ENTIDADES_AUDITORIA.BONIFICACAO_FECHAMENTO,
        entidadeId: String(fechamento.id),
        rotulo: rotuloFechamento(processo.nome, competencia),
        evento: "BONIFICACAO_FECHAMENTO_APURADO",
        metadata: { processoId, competencia: isoCompetencia(competencia), consultores: enquadrados.length, resultados: linhas.length, pendentes },
      });
      return { fechamentoId: fechamento.id, consultores: enquadrados.length, resultados: linhas.length, pendentes };
    },
    { timeout: 60_000, maxWait: 15_000 }
  );
}

/** Informa (ou limpa) o valor de um resultado do fechamento aberto e recalcula pontos e valor com a regra gravada nele. */
export async function informarResultado(
  tx: Tx,
  resultadoId: number,
  informado: number | null,
  observacao: string | null
): Promise<{ antes: { valorInformado: number | null; valor: number | null }; depois: { valorInformado: number | null; valor: number | null; pontos: number | null }; rotulo: string; fechamentoId: number }> {
  const r = await tx.bonificacaoResultado.findUnique({
    where: { id: resultadoId },
    include: { fechamento: { include: { processo: { select: { nome: true } } } }, indicador: true, regra: { include: { faixas: true } } },
  });
  if (!r) throw new ErroBonificacao("Resultado não encontrado", 404);
  if (r.fechamento.situacao === "fechado") throw new ErroBonificacao("Competência fechada: reabra para alterar");
  const regra = r.regra ? { valorBase: Number(r.regra.valorBase), faixas: faixasDoBanco(r.regra.faixas) } : null;
  if (!regra) throw new ErroBonificacao("Não há regra vigente para este indicador na competência: cadastre a regra e apure de novo");
  const apurado = r.valorApurado == null ? null : Number(r.valorApurado);
  const c = calcularLinha(regra, r.indicador.sentido as SentidoIndicador, apurado, informado);
  await tx.bonificacaoResultado.update({
    where: { id: r.id },
    data: { valorInformado: informado, observacao, pontos: c.pontos, valorBase: c.valorBase, valor: c.valor },
  });
  return {
    antes: { valorInformado: r.valorInformado == null ? null : Number(r.valorInformado), valor: r.valor == null ? null : Number(r.valor) },
    depois: { valorInformado: informado, valor: c.valor, pontos: c.pontos },
    rotulo: `${r.fechamento.processo.nome} · ${isoCompetencia(r.fechamento.competencia)} · ${r.indicador.nome}`,
    fechamentoId: r.fechamentoId,
  };
}
