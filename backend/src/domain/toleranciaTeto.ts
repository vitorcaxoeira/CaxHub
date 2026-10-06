import { prisma } from "../db/prisma";

// Tolerância do teto de horas na CONFIRMAÇÃO de sessões já trabalhadas.
//
// horini/horfim do RatItem truncam no minuto, o que alarga o intervalo em até 1 min em relação ao
// que a parada automática por teto calculou em milissegundos — e cada confirmação desloca o
// realizado da atividade um pouco, de modo que sessões pendentes dela travam por 1 minuto.
// Configurável por consultor (ConfiguracaoApontamentoConsultor.toleranciaTetoMin), mantida pelo
// admin ou pelo líder do departamento dele.
//
// Só vale na confirmação de sessão preexistente (recusarSeEstourarTeto, routes/apontamentos.ts).
// Criação/aprovação de pedidos, parada automática e entrada em execução seguem no teto exato.

// Mesmo valor do DEFAULT da coluna: consultor sem linha na tabela recebe o padrão.
export const TOLERANCIA_TETO_PADRAO_MIN = 5;
export const MAX_TOLERANCIA_TETO_MIN = 15;

export async function toleranciaTetoDoConsultor(codemp: number, codfor: number): Promise<number> {
  const config = await prisma.configuracaoApontamentoConsultor.findUnique({ where: { codemp_codfor: { codemp, codfor } } });
  return config?.toleranciaTetoMin ?? TOLERANCIA_TETO_PADRAO_MIN;
}
