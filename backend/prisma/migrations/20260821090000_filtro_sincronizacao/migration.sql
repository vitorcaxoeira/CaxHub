-- CreateTable
CREATE TABLE "filtros_sincronizacao" (
    "job_name" TEXT NOT NULL,
    "predicados" JSONB NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "atualizado_por" INTEGER,

    CONSTRAINT "filtros_sincronizacao_pkey" PRIMARY KEY ("job_name")
);
