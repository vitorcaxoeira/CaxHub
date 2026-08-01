import cron from "node-cron";
import { prisma } from "../db/prisma";
import { RAIA_A_FAZER, colunaEfetiva, montarOperacoesMovimentacao } from "../domain/execucaoAtividade";
import { diaSemanaDaSessao } from "../domain/jornadaConsultor";
import { limiteDaSessaoAberta } from "../domain/limiteSessao";
import { randomUUID } from "crypto";

// Fecha sozinha a sessão de execução que passou de algum limite. Existe porque uma sessão
// aberta não escreve nada: o card fica "Em Andamento" e o cronômetro conta sozinho de
// madrugada, no fim de semana e muito além do que foi alocado — e ninguém percebe até
// alguém abrir a tela.
//
// São DOIS limites, e vale o menor: o teto de horas (alocado + excedente) e o fim do
// expediente do consultor naquele dia. Cada um pode estar ausente — atividade sem
// alocação não tem teto, consultor sem jornada cadastrada não tem expediente.
//
// O ponto central do desenho: a sessão é fechada NO INSTANTE DO LIMITE, não na hora em que
// a varredura percebeu. Uma sessão que deveria ter parado às 18:00 e foi detectada às
// 22:00 registra 18:00. Isso torna a precisão do registro independente da frequência do
// cron — a frequência só decide em quanto tempo o card some do "Em Andamento" na tela.
//
// A sessão fechada segue o fluxo normal e vira pendência pro consultor confirmar. NÃO se
// confirma sozinha: quem descreve o que foi feito é quem trabalhou.

const CRON_EXPR = "*/5 * * * *";

export interface ResultadoParada {
  analisadas: number;
  paradas: number;
  motivos: Record<string, number>;
}

export async function pararExecucoesAutomaticamente(agora: Date = new Date()): Promise<ResultadoParada> {
  const abertas = await prisma.atividadeSessaoExecucao.findMany({
    where: { fim: null },
    include: { atividade: { include: { coluna: true } } },
  });

  const resultado: ResultadoParada = { analisadas: abertas.length, paradas: 0, motivos: {} };
  if (abertas.length === 0) return resultado;

  const colunaAFazer = await prisma.quadroColuna.findFirst({ where: { nome: RAIA_A_FAZER } });
  const primeiraColuna = await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });
  if (!colunaAFazer) {
    console.error("[parada-automatica] raia 'A Fazer' não configurada — nada a fazer");
    return resultado;
  }

  // Jornada de quem tem sessão aberta, indexada por consultor + dia da semana da sessão.
  // Uma consulta só, e não uma por sessão.
  const jornadas = await prisma.jornadaConsultor.findMany({
    where: { codfor: { in: [...new Set(abertas.map((s) => s.atividade.codfor))] } },
  });
  const jornadaPorChave = new Map(jornadas.map((j) => [`${j.codemp}-${j.codfor}-${j.diaSemana}`, j]));

  for (const sessao of abertas) {
    const atividade = sessao.atividade;

    const jornada = jornadaPorChave.get(`${atividade.codemp}-${atividade.codfor}-${diaSemanaDaSessao(sessao.inicio)}`) ?? null;
    const limiteSessao = await limiteDaSessaoAberta(sessao.inicio, atividade, jornada);
    if (!limiteSessao || limiteSessao.instante.getTime() > agora.getTime()) continue;

    const { instante: limite, motivo } = limiteSessao;
    try {
      const { operacoes } = await montarOperacoesMovimentacao({
        atividade,
        colunaAnterior: colunaEfetiva(atividade.coluna, primeiraColuna),
        colunaNova: colunaAFazer,
        usuarioId: null,
        origemSessao: "manual",
        correlationId: randomUUID(),
        agora: limite,
        origemEvento: "job",
        motivoParada: motivo,
      });
      await prisma.$transaction(operacoes);
      resultado.paradas++;
      resultado.motivos[motivo] = (resultado.motivos[motivo] ?? 0) + 1;
      console.log(
        `[parada-automatica] atividade ${atividade.id} (proposta ${atividade.codpro}) parada por ${motivo} — sessão fechada em ${limite.toISOString()}`
      );
    } catch (error) {
      // Uma sessão problemática não pode derrubar a varredura das outras.
      console.error(`[parada-automatica] falha ao parar a atividade ${atividade.id}:`, error instanceof Error ? error.message : error);
    }
  }

  return resultado;
}

export function agendarParadaAutomatica() {
  cron.schedule(CRON_EXPR, () => {
    pararExecucoesAutomaticamente().catch((error) => {
      console.error("[parada-automatica] erro na varredura:", error instanceof Error ? error.message : error);
    });
  });
}
