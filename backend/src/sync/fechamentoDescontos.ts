import { randomUUID } from "crypto";
import cron from "node-cron";
import { prisma } from "../db/prisma";
import { ENTIDADES_AUDITORIA } from "../audit/taxonomia";
import { alocarNaCompetencia, competenciaDe, somarMeses, somarReais, vencimentoDa } from "../domain/descontos";
import { auditarDesconto, dec, hojeBrasil, isoCompetencia, recalcularStatusDoProcesso, rotuloDoProcesso } from "../domain/descontosDados";
import { produtividadeDoMes } from "../domain/relatorioProdutividade";
import { valorHoraVigente } from "../domain/resumoConsultor";

// Fechamento mensal dos descontos (Gestão de Descontos, 05/11/2026). Vira a competência: congela a nota do consultor (o "Valor Nota" do
// Relatório de Produtividade, o mesmo número do FJPO910 do Senior) e reparte entre as parcelas daquela competência:
//   - coube inteira  -> "descontada"
//   - coube em parte -> "parcial" (o que foi descontado fica nela) + parcela NOVA na competência seguinte com o restante
//   - nada coube     -> a parcela inteira vai para a competência seguinte (continua pendente; nada se perde nem se cancela)
// Consultor sem valor-hora (sem nota calculável) NÃO é fechado: o desconto fica pendente e aparece em Parcelas até haver nota.
// Idempotente: (competência, consultor) já fechado é pulado, então rodar de novo (job diário, botão manual) não repete nada.

export type OrigemFechamento = "job" | "manual";

/** "10/2026" para textos que a pessoa lê (a observação da parcela aparece nas telas). */
const mesAno = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

export interface ResultadoFechamento {
  competencia: string;
  fechados: number;
  jaFechados: number;
  semNota: number;
  erros: number;
}

type Desfecho = "fechado" | "ja_fechado" | "sem_nota";

async function fecharConsultor(
  competencia: Date,
  codemp: number,
  codfor: number,
  origem: OrigemFechamento,
  usuarioId: number | null
): Promise<Desfecho> {
  const jaFechado = await prisma.descontoFechamento.findUnique({ where: { competencia_codemp_codfor: { competencia, codemp, codfor } } });
  if (jaFechado) return "ja_fechado";

  const valorHora = await valorHoraVigente(codemp, codfor);
  if (!valorHora) return "sem_nota";
  const mes = await produtividadeDoMes(codemp, codfor, competencia.getUTCFullYear(), competencia.getUTCMonth() + 1, valorHora.vlrhor);
  const valorNota = mes.totais.valorNota;
  if (valorNota == null) return "sem_nota";

  const parcelas = await prisma.descontoParcela.findMany({
    where: { competencia, situacao: "pendente", processo: { codemp, codfor } },
    include: { processo: true },
  });
  const alocacao = alocarNaCompetencia(
    valorNota,
    parcelas.map((p) => ({ id: p.id, processoId: p.processoId, numero: p.numero, vencimento: p.vencimento, valor: dec(p.valor) }))
  );
  const porId = new Map(parcelas.map((p) => [p.id, p]));
  const proxima = somarMeses(competencia, 1);
  const origemAuditoria = origem === "job" ? "job" : "tela";
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const processosAfetados = new Set<number>();
    for (const r of alocacao) {
      const p = porId.get(r.id)!;
      processosAfetados.add(p.processoId);
      const base = { usuarioId, origem: origemAuditoria as "job" | "tela", correlationId, entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PARCELA, entidadeId: String(p.id) };
      const rotulo = `${rotuloDoProcesso(p.processo)} · parcela ${p.numero}`;
      const metadata = { processoId: p.processoId, competencia: isoCompetencia(competencia), valorNota, valorParcela: dec(p.valor) };

      if (r.acao === "descontada") {
        await tx.descontoParcela.update({ where: { id: p.id }, data: { situacao: "descontada", valorDescontado: r.valorDescontado } });
        await auditarDesconto(tx, {
          ...base,
          rotulo,
          evento: "DESCONTO_PARCELA_DESCONTADA",
          alteracoes: { situacao: { de: "pendente", para: "descontada", rotulo: "Situação" }, valorDescontado: { de: 0, para: r.valorDescontado, rotulo: "Valor descontado" } },
          metadata,
        });
      } else if (r.acao === "parcial") {
        await tx.descontoParcela.update({ where: { id: p.id }, data: { situacao: "parcial", valorDescontado: r.valorDescontado } });
        const ultimo = await tx.descontoParcela.aggregate({ where: { processoId: p.processoId }, _max: { numero: true } });
        const filha = await tx.descontoParcela.create({
          data: {
            processoId: p.processoId,
            numero: (ultimo._max.numero ?? p.numero) + 1,
            competencia: proxima,
            vencimento: vencimentoDa(proxima, p.processo.diaVencimento),
            valor: r.restante,
            origemParcelaId: p.id,
            observacao: `Saldo da parcela ${p.numero} (${mesAno(competencia)}): a nota do mês não cobriu o desconto inteiro`,
          },
        });
        await auditarDesconto(tx, {
          ...base,
          rotulo,
          evento: "DESCONTO_PARCELA_PARCIAL",
          alteracoes: { situacao: { de: "pendente", para: "parcial", rotulo: "Situação" }, valorDescontado: { de: 0, para: r.valorDescontado, rotulo: "Valor descontado" } },
          metadata: { ...metadata, naoDescontado: r.restante, saldoTransportadoParaParcela: filha.id, competenciaDoSaldo: isoCompetencia(proxima) },
        });
      } else {
        await tx.descontoParcela.update({
          where: { id: p.id },
          data: {
            competencia: proxima,
            vencimento: vencimentoDa(proxima, p.processo.diaVencimento),
            observacao: `Transportada de ${mesAno(competencia)}: a nota do mês não deixou saldo para este desconto`,
          },
        });
        await auditarDesconto(tx, {
          ...base,
          rotulo,
          evento: "DESCONTO_PARCELA_TRANSPORTADA",
          alteracoes: { competencia: { de: isoCompetencia(competencia), para: isoCompetencia(proxima), rotulo: "Competência" } },
          metadata: { ...metadata, naoDescontado: r.restante },
        });
      }
    }
    for (const processoId of processosAfetados) await recalcularStatusDoProcesso(tx, processoId);

    await tx.descontoFechamento.create({
      data: {
        competencia,
        codemp,
        codfor,
        valorNota,
        totalPrevisto: somarReais(parcelas.map((p) => dec(p.valor))),
        totalDescontado: somarReais(alocacao.map((r) => r.valorDescontado)),
        saldoTransportado: somarReais(alocacao.map((r) => r.restante)),
        origem,
        fechadoPorId: usuarioId,
      },
    });
  });
  return "fechado";
}

/** Fecha a competência (dia 1 do mês) de todos os consultores que têm desconto pendente nela. */
export async function fecharCompetencia(competenciaQualquerDia: Date, origem: OrigemFechamento, usuarioId: number | null = null): Promise<ResultadoFechamento> {
  const competencia = competenciaDe(competenciaQualquerDia);
  const donos = await prisma.descontoParcela.findMany({
    where: { competencia, situacao: "pendente" },
    select: { processo: { select: { codemp: true, codfor: true } } },
  });
  const consultores = new Map(donos.map((d) => [`${d.processo.codemp}-${d.processo.codfor}`, d.processo]));

  const resultado: ResultadoFechamento = { competencia: isoCompetencia(competencia), fechados: 0, jaFechados: 0, semNota: 0, erros: 0 };
  for (const { codemp, codfor } of consultores.values()) {
    try {
      const desfecho = await fecharConsultor(competencia, codemp, codfor, origem, usuarioId);
      if (desfecho === "fechado") resultado.fechados += 1;
      else if (desfecho === "ja_fechado") resultado.jaFechados += 1;
      else resultado.semNota += 1;
    } catch (error) {
      // Um consultor com problema não impede o fechamento dos outros; fica pendente e é tentado de novo na próxima rodada.
      resultado.erros += 1;
      console.error(`[descontos-fechamento] consultor ${codfor} (${isoCompetencia(competencia)}) falhou:`, error instanceof Error ? error.message : error);
    }
  }
  return resultado;
}

/**
 * Dia do mês a partir do qual a competência anterior pode ser fechada (padrão: dia 1, a virada do mês). Existe para o caso de a nota do mês
 * ainda estar sendo ajustada nos primeiros dias (apontamentos confirmados depois): suba o valor via DESCONTOS_DIA_FECHAMENTO.
 */
export function diaDoFechamento(): number {
  const n = Number(process.env.DESCONTOS_DIA_FECHAMENTO);
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : 1;
}

/**
 * Fecha, em ordem, todas as competências já encerradas que ainda têm desconto pendente. A ordem importa: o que não coube em um mês vai
 * para o seguinte, que então precisa ser fechado depois. Rodar todo dia torna o fechamento à prova de servidor fora do ar no dia 1º.
 */
export async function fecharCompetenciasVencidas(origem: OrigemFechamento = "job", hoje: Date = hojeBrasil()): Promise<ResultadoFechamento[]> {
  const mesAtual = competenciaDe(hoje);
  const limite = hoje.getUTCDate() >= diaDoFechamento() ? mesAtual : somarMeses(mesAtual, -1); // fecha tudo ANTERIOR a `limite`
  const abertas = await prisma.descontoParcela.findMany({
    where: { situacao: "pendente", competencia: { lt: limite } },
    select: { competencia: true },
    distinct: ["competencia"],
    orderBy: { competencia: "asc" },
  });
  const resultados: ResultadoFechamento[] = [];
  for (const { competencia } of abertas) resultados.push(await fecharCompetencia(competencia, origem));
  return resultados;
}

export function agendarFechamentoDescontos() {
  // Todo dia às 03:10 (hora de São Paulo): no dia 1º fecha o mês que acabou; nos demais só pega o que ficou para trás (sem nota, erro).
  cron.schedule(
    "10 3 * * *",
    () => {
      fecharCompetenciasVencidas("job")
        .then((rs) => {
          const feitos = rs.filter((r) => r.fechados > 0 || r.semNota > 0 || r.erros > 0);
          for (const r of feitos) console.log(`[descontos-fechamento] ${r.competencia}: ${r.fechados} fechado(s), ${r.semNota} sem nota, ${r.erros} erro(s)`);
        })
        .catch((error) => console.error("[descontos-fechamento] erro:", error instanceof Error ? error.message : error));
    },
    { timezone: "America/Sao_Paulo" }
  );
}
