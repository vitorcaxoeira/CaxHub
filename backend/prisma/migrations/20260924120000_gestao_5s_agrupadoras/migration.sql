-- Gestão 5S — área agrupadora: avaliações de ambiente ligadas a uma avaliação-pai (invólucro).
-- AlterTable
ALTER TABLE "avaliacoes_5s" ADD COLUMN     "avaliacaoPaiId" INTEGER;

-- CreateIndex
CREATE INDEX "avaliacoes_5s_avaliacaoPaiId_idx" ON "avaliacoes_5s"("avaliacaoPaiId");

-- AddForeignKey
ALTER TABLE "avaliacoes_5s" ADD CONSTRAINT "avaliacoes_5s_avaliacaoPaiId_fkey" FOREIGN KEY ("avaliacaoPaiId") REFERENCES "avaliacoes_5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

