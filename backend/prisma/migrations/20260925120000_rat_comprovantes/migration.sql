-- Comprovantes (foto/PDF) das despesas de viagem, sempre ligados a uma RAT e opcionalmente a
-- uma despesa dela. Arquivo fica em disco (uploads/comprovantes-rat); aqui só o metadado.

-- CreateTable
CREATE TABLE "rat_comprovantes" (
    "id" SERIAL NOT NULL,
    "ratId" INTEGER NOT NULL,
    "despesaId" INTEGER,
    "userId" INTEGER,
    "nomeArquivo" VARCHAR(255) NOT NULL,
    "caminhoArquivo" VARCHAR(500) NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rat_comprovantes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rat_comprovantes_ratId_idx" ON "rat_comprovantes"("ratId");

-- CreateIndex
CREATE INDEX "rat_comprovantes_despesaId_idx" ON "rat_comprovantes"("despesaId");

-- AddForeignKey
ALTER TABLE "rat_comprovantes" ADD CONSTRAINT "rat_comprovantes_ratId_fkey" FOREIGN KEY ("ratId") REFERENCES "rats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rat_comprovantes" ADD CONSTRAINT "rat_comprovantes_despesaId_fkey" FOREIGN KEY ("despesaId") REFERENCES "registros_despesa_viagem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rat_comprovantes" ADD CONSTRAINT "rat_comprovantes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
