-- Painel de Eficiência: plano de ação (ação com dono, prazo e status, criada a partir dos alertas).
-- Tabela nova, nada existente é reescrito.
CREATE TABLE "eficiencia_acoes" (
    "id" SERIAL NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "observacao" VARCHAR(1000),
    "codemp" INTEGER,
    "codpro" INTEGER,
    "codforAlvo" INTEGER,
    "origemAlerta" VARCHAR(200),
    "depexe" INTEGER,
    "responsavelCodfor" INTEGER NOT NULL,
    "prazo" DATE NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'aberta',
    "concluidaEm" TIMESTAMP(3),
    "avisoVencidaEm" TIMESTAMP(3),
    "criadoPor" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" INTEGER,

    CONSTRAINT "eficiencia_acoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "eficiencia_acoes_status_prazo_idx" ON "eficiencia_acoes"("status", "prazo");
CREATE INDEX "eficiencia_acoes_responsavelCodfor_idx" ON "eficiencia_acoes"("responsavelCodfor");
