// Verificação só-leitura da tolerância do teto na confirmação (sessão 2355 / atividade 148796).
// Uso: node_modules/.bin/ts-node scripts/verificar-tolerancia-teto.ts
import { prisma } from "../src/db/prisma";
import { recusarSeEstourarTeto } from "../src/routes/apontamentos";
import { toleranciaTetoDoConsultor } from "../src/domain/toleranciaTeto";

async function main() {
  const sessao = await prisma.atividadeSessaoExecucao.findUniqueOrThrow({ where: { id: 2355 }, include: { atividade: true } });
  const { atividade } = sessao;
  const fim = sessao.fim!;
  const duracaoAtual = Math.round((fim.getTime() - sessao.inicio.getTime()) / 60000);
  const tolerancia = await toleranciaTetoDoConsultor(atividade.codemp, atividade.codfor);
  console.log(`tolerância do consultor ${atividade.codfor}:`, tolerancia);

  const sem = await recusarSeEstourarTeto(atividade, sessao.inicio, fim, duracaoAtual);
  console.log("sem tolerância  →", sem ? `RECUSA ${sem.status} (realizado ${sem.body.realizado}, teto ${sem.body.teto})` : "libera");

  const com = await recusarSeEstourarTeto(atividade, sessao.inicio, fim, duracaoAtual, { toleranciaMin: tolerancia });
  console.log(`com tolerância ${tolerancia} →`, com ? `RECUSA ${com.status}` : "libera");

  // sintético: estica a sessão até passar da tolerância (teto + tolerancia + 1)
  const extra = new Date(fim.getTime() + (tolerancia + 1) * 60_000);
  const alem = await recusarSeEstourarTeto(atividade, sessao.inicio, extra, duracaoAtual, { toleranciaMin: tolerancia });
  console.log("teto+tolerância+1 →", alem ? `RECUSA ${alem.status}` : "libera (ERRADO)");
}
main().finally(() => prisma.$disconnect());
