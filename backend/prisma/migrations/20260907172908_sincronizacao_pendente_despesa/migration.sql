-- CreateTable
CREATE TABLE "sincronizacao_pendente_despesa" (
    "id" SERIAL NOT NULL,
    "despesaId" INTEGER NOT NULL,
    "tipo" VARCHAR(40) NOT NULL DEFAULT 'enviar_despesa',
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "sincronizacao_pendente_despesa_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sincronizacao_pendente_despesa" ADD CONSTRAINT "sincronizacao_pendente_despesa_despesaId_fkey" FOREIGN KEY ("despesaId") REFERENCES "registros_despesa_viagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
