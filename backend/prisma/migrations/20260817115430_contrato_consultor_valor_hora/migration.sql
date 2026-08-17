-- CreateTable
CREATE TABLE "contratos_consultores" (
    "codemp" INTEGER NOT NULL,
    "codusu" INTEGER NOT NULL,
    "codfor" INTEGER,
    "numctr" INTEGER,
    "codmot" INTEGER,
    "vlrhor" DECIMAL(15,5),
    "vlrmin" DECIMAL(15,8),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "contratos_consultores_pkey" PRIMARY KEY ("codemp","codusu")
);

-- CreateIndex
CREATE INDEX "contratos_consultores_codfor_idx" ON "contratos_consultores"("codfor");

