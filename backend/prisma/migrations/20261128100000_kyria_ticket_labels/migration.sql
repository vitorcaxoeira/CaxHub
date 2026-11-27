-- Etiquetas de cada chamado do Kyria (GET /tickets/{ticketId}/labels), 27/11/2026: de onde sai a "área do chamado" no relatório
-- Horas Kyria x Trabalhadas (grupo de etiqueta de chave "area"). Etiqueta e grupo sem FK: o catálogo pode chegar depois.
CREATE TABLE "kyria_ticket_labels" (
    "ticket_id" VARCHAR(64) NOT NULL,
    "label_id" VARCHAR(64) NOT NULL,
    "group_id" VARCHAR(64),
    "applied_at" TIMESTAMPTZ(3),
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyria_ticket_labels_pkey" PRIMARY KEY ("ticket_id","label_id")
);

CREATE INDEX "kyria_ticket_labels_label_id_idx" ON "kyria_ticket_labels"("label_id");

ALTER TABLE "kyria_ticket_labels" ADD CONSTRAINT "kyria_ticket_labels_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "kyria_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
