-- CreateEnum
CREATE TYPE "KyriaTicketPrioridade" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateTable
CREATE TABLE "kyria_tickets" (
    "id" VARCHAR(64) NOT NULL,
    "code" VARCHAR(24),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status_key" VARCHAR(64) NOT NULL,
    "priority" "KyriaTicketPrioridade" NOT NULL,
    "team_id" VARCHAR(64),
    "responsible_user_id" VARCHAR(64),
    "requester_user_id" VARCHAR(64) NOT NULL,
    "project_id" TEXT,
    "customer_id" VARCHAR(64),
    "opened_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "parent_ticket_id" TEXT,
    "revision" INTEGER NOT NULL,
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyria_ticket_hours" (
    "id" VARCHAR(64) NOT NULL,
    "group_type" VARCHAR(25) NOT NULL,
    "code" VARCHAR(32),
    "title" VARCHAR(255) NOT NULL,
    "minutes" DECIMAL(65,30) NOT NULL,
    "janela_de" DATE NOT NULL,
    "janela_ate" DATE NOT NULL,
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_ticket_hours_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "kyria_ticket_hours" ADD CONSTRAINT "kyria_ticket_hours_id_fkey" FOREIGN KEY ("id") REFERENCES "kyria_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
