-- Etiquetas do Kyria que cada departamento usa pra filtrar os tickets da análise (18/11/2026): ligação N:N departamento x etiqueta, config
-- nativa do CaxHub. Nasce vazia. Se a etiqueta sair de kyria_labels, a ligação some junto (CASCADE).

-- CreateTable
CREATE TABLE "departamento_label_kyria" (
    "codemp" INTEGER NOT NULL,
    "depexe" INTEGER NOT NULL,
    "kyria_label_id" VARCHAR(64) NOT NULL,

    CONSTRAINT "departamento_label_kyria_pkey" PRIMARY KEY ("codemp","depexe","kyria_label_id")
);

-- CreateIndex
CREATE INDEX "departamento_label_kyria_kyria_label_id_idx" ON "departamento_label_kyria"("kyria_label_id");

-- AddForeignKey
ALTER TABLE "departamento_label_kyria" ADD CONSTRAINT "departamento_label_kyria_kyria_label_id_fkey" FOREIGN KEY ("kyria_label_id") REFERENCES "kyria_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
