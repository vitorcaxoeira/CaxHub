-- Painel de Eficiência: exclusão de apontamento do cálculo do PAINEL (só do painel; não mexe em RAT, teto nem Senior).
-- Tabela nova, nada existente é reescrito.
CREATE TABLE "eficiencia_apontamentos_excluidos" (
    "id" SERIAL NOT NULL,
    "ratItemId" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "seqite" INTEGER NOT NULL,
    "codfor" INTEGER,
    "minutos" INTEGER NOT NULL,
    "motivo" VARCHAR(30) NOT NULL,
    "observacao" VARCHAR(300),
    "excluidoPor" INTEGER NOT NULL,
    "excluidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restauradoPor" INTEGER,
    "restauradoEm" TIMESTAMP(3),

    CONSTRAINT "eficiencia_apontamentos_excluidos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "eficiencia_apontamentos_excluidos_codemp_codpro_seqite_idx"
    ON "eficiencia_apontamentos_excluidos"("codemp", "codpro", "seqite");

-- No máximo UMA exclusão ativa por apontamento (as restauradas ficam como histórico). O Prisma não expressa índice parcial.
CREATE UNIQUE INDEX "eficiencia_apontamentos_excluidos_ativo_uq"
    ON "eficiencia_apontamentos_excluidos"("ratItemId")
    WHERE "restauradoEm" IS NULL;

ALTER TABLE "eficiencia_apontamentos_excluidos"
    ADD CONSTRAINT "eficiencia_apontamentos_excluidos_ratItemId_fkey"
    FOREIGN KEY ("ratItemId") REFERENCES "rat_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
