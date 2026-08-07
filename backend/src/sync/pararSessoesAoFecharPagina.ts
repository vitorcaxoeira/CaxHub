import { prisma } from "../db/prisma";
import { RAIA_A_FAZER, colunaEfetiva, montarOperacoesMovimentacao } from "../domain/execucaoAtividade";
import { randomUUID } from "crypto";

// Fecha a sessão que ficou marcada como "a aba pode estar fechando" (POST
// /atividades/:id/agendar-parada) e ninguém voltou a confirmar que ainda está ali.
//
// Separado de pararExecucoesAutomaticamente.ts (teto de horas / fim de expediente) de
// propósito: aquela varredura roda a cada 5 minutos, calibrada pra um atraso que ninguém
// nota porque o motivo (acabaram as horas, acabou o expediente) já era esperado. Aqui o
// pedido foi por uma resposta perto de 10s — fechar a aba é uma ação do agora, não algo
// que se descobre "eventualmente".
//
// O cancelamento mora do OUTRO lado (GET /atividades/minha-sessao-aberta, que o vigia já
// consulta a cada 30s): se o app volta a perguntar pela sessão, `fechamentoSolicitadoEm`
// volta a null sozinho. Esta função só vê o que sobrou sem resposta.

const INTERVALO_MS = 15_000;
const TOLERANCIA_MS = 10_000;

export interface ResultadoParadaPorFechamento {
  analisadas: number;
  paradas: number;
}

export async function pararSessoesAoFecharPagina(agora: Date = new Date()): Promise<ResultadoParadaPorFechamento> {
  const limite = new Date(agora.getTime() - TOLERANCIA_MS);
  const pendentes = await prisma.atividadeSessaoExecucao.findMany({
    where: { fim: null, fechamentoSolicitadoEm: { not: null, lte: limite } },
    include: { atividade: { include: { coluna: true } } },
  });

  const resultado: ResultadoParadaPorFechamento = { analisadas: pendentes.length, paradas: 0 };
  if (pendentes.length === 0) return resultado;

  const colunaAFazer = await prisma.quadroColuna.findFirst({ where: { nome: RAIA_A_FAZER } });
  const primeiraColuna = await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });
  if (!colunaAFazer) {
    console.error("[parada-fechamento] raia 'A Fazer' não configurada — nada a fazer");
    return resultado;
  }

  for (const sessao of pendentes) {
    const atividade = sessao.atividade;
    try {
      // O instante que fecha é o do PEDIDO (quando o pagehide disparou), não o desta
      // checagem — mesmo princípio da varredura de teto/expediente: o registro não pode
      // depender de quando o sistema percebeu.
      const { operacoes } = await montarOperacoesMovimentacao({
        atividade,
        colunaAnterior: colunaEfetiva(atividade.coluna, primeiraColuna),
        colunaNova: colunaAFazer,
        usuarioId: null,
        origemSessao: "manual",
        correlationId: randomUUID(),
        agora: sessao.fechamentoSolicitadoEm!,
        origemEvento: "job",
        motivoParada: "pagina_fechada",
      });
      await prisma.$transaction(operacoes);
      resultado.paradas++;
      console.log(
        `[parada-fechamento] atividade ${atividade.id} (proposta ${atividade.codpro}) parada por pagina_fechada — sessão fechada em ${sessao.fechamentoSolicitadoEm!.toISOString()}`
      );
    } catch (error) {
      console.error(`[parada-fechamento] falha ao parar a atividade ${atividade.id}:`, error instanceof Error ? error.message : error);
    }
  }

  return resultado;
}

export function agendarParadaPorFechamento(): void {
  setInterval(() => {
    pararSessoesAoFecharPagina().catch((error) => {
      console.error("[parada-fechamento] erro na checagem:", error instanceof Error ? error.message : error);
    });
  }, INTERVALO_MS);
}
