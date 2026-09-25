-- CreateEnum
CREATE TYPE "KyriaTicketStatusCategoria" AS ENUM ('triage', 'queue', 'awaiting_return', 'execution', 'done', 'cancelled');

-- CreateTable
CREATE TABLE "kyria_ticket_statuses" (
    "id" VARCHAR(64) NOT NULL,
    "team_id" VARCHAR(64),
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(16),
    "category" "KyriaTicketStatusCategoria" NOT NULL,
    "status" "KyriaStatus" NOT NULL,
    "sort_order" INTEGER,
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_ticket_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyria_ticket_statuses_key_key" ON "kyria_ticket_statuses"("key");

-- AddForeignKey (customer_id, team_id, responsible_user_id: já provados sem órfãos contra os
-- 6.669 tickets locais em 22/09/2026, seguros de aplicar direto em cima do dado existente).
ALTER TABLE "kyria_tickets" ADD CONSTRAINT "kyria_tickets_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "kyria_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kyria_tickets" ADD CONSTRAINT "kyria_tickets_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "kyria_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kyria_tickets" ADD CONSTRAINT "kyria_tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "kyria_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
