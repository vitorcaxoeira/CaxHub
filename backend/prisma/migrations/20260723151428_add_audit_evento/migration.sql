-- CreateTable
CREATE TABLE "audit_evento" (
    "id" BIGSERIAL NOT NULL,
    "ocorridoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER,
    "origem" VARCHAR(20) NOT NULL,
    "codemp" INTEGER,
    "codpro" INTEGER,
    "entidadeTipo" VARCHAR(40) NOT NULL,
    "entidadeId" VARCHAR(60) NOT NULL,
    "entidadeRotulo" VARCHAR(200),
    "eventoTipo" VARCHAR(60) NOT NULL,
    "alteracoes" JSONB,
    "metadata" JSONB,
    "correlationId" UUID NOT NULL,

    CONSTRAINT "audit_evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_evento_proposta" ON "audit_evento"("codemp", "codpro", "ocorridoEm" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_evento_entidade" ON "audit_evento"("entidadeTipo", "entidadeId", "ocorridoEm" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_evento_tipo" ON "audit_evento"("eventoTipo", "ocorridoEm" DESC);

-- AddForeignKey
ALTER TABLE "audit_evento" ADD CONSTRAINT "audit_evento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evento" ADD CONSTRAINT "audit_evento_codemp_codpro_fkey" FOREIGN KEY ("codemp", "codpro") REFERENCES "propostas"("codemp", "codpro") ON DELETE SET NULL ON UPDATE CASCADE;

