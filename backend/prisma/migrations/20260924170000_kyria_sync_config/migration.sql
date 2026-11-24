-- CreateTable
CREATE TABLE "kyria_sync_config" (
    "job_name" VARCHAR(64) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_sync_config_pkey" PRIMARY KEY ("job_name")
);
