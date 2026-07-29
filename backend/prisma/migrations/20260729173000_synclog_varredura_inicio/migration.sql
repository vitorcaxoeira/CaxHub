-- AlterTable
-- Migration separada da 20260729170000 porque aquela já foi aplicada: o Prisma valida o
-- checksum das migrations aplicadas, então editar o arquivo antigo quebraria o histórico.
ALTER TABLE "SyncLog" ADD COLUMN     "varreduraInicio" TIMESTAMP(3);
