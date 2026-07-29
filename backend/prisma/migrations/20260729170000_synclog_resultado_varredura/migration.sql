-- AlterTable
-- Sem backfill: log anterior ao mecanismo de varredura fica com NULL nos dois campos, que
-- é exatamente a verdade ("esta execução não varreu").
ALTER TABLE "SyncLog" ADD COLUMN     "varreduraDetectados" INTEGER,
ADD COLUMN     "varreduraModo" TEXT;
