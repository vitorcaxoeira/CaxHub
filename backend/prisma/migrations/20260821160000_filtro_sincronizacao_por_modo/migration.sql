-- Fase 6 do plano de filtros na importação: até 2 filtros por tabela, um por modo
-- ("todos"/"alterados", mesmo vocabulário de POST /:jobName/run). Backfill: toda linha
-- existente vale hoje "pra tudo" (comportamento atual antes desta migration), então vira
-- modo='todos' — não perde nada, só passa a ser explícito.
ALTER TABLE "filtros_sincronizacao" ADD COLUMN "modo" TEXT NOT NULL DEFAULT 'todos';

ALTER TABLE "filtros_sincronizacao" DROP CONSTRAINT "filtros_sincronizacao_pkey";
ALTER TABLE "filtros_sincronizacao" ADD CONSTRAINT "filtros_sincronizacao_pkey" PRIMARY KEY ("job_name", "modo");

-- O default só existia pra dar um valor às linhas já existentes na hora do ALTER acima; daqui
-- pra frente todo INSERT passa pelo Prisma, que sempre informa `modo` explicitamente.
ALTER TABLE "filtros_sincronizacao" ALTER COLUMN "modo" DROP DEFAULT;
