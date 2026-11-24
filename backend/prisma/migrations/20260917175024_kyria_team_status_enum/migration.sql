-- CreateEnum
CREATE TYPE "KyriaStatus" AS ENUM ('active', 'inactive');

-- AlterTable: converte a coluna existente (TEXT) pro enum, preservando as linhas já
-- sincronizadas em vez do DROP+ADD que "prisma migrate diff" sugeriu (perderia os dados).
ALTER TABLE "kyria_teams"
  ALTER COLUMN "status" TYPE "KyriaStatus" USING status::"KyriaStatus";
