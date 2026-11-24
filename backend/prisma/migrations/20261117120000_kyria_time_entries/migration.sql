-- CreateEnum
CREATE TYPE "KyriaOrigemApontamento" AS ENUM ('automatic', 'manual');

-- CreateTable
CREATE TABLE "kyria_time_entries" (
    "id" VARCHAR(64) NOT NULL,
    "ticket_id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(64),
    "team_id" VARCHAR(64),
    "origem" "KyriaOrigemApontamento" NOT NULL,
    "is_open" BOOLEAN NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "minutes" DECIMAL(12,2),
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "criado_em_kyria" TIMESTAMPTZ(3) NOT NULL,
    "alterado_em_kyria" TIMESTAMPTZ(3) NOT NULL,
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyria_sync_cursor" (
    "job_name" VARCHAR(64) NOT NULL,
    "cursor" TEXT NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_sync_cursor_pkey" PRIMARY KEY ("job_name")
);

-- CreateIndex
CREATE INDEX "kyria_time_entries_ticket_id_idx" ON "kyria_time_entries"("ticket_id");

-- CreateIndex
CREATE INDEX "kyria_time_entries_user_id_started_at_idx" ON "kyria_time_entries"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "kyria_time_entries_started_at_idx" ON "kyria_time_entries"("started_at");

-- AddForeignKey
ALTER TABLE "kyria_time_entries" ADD CONSTRAINT "kyria_time_entries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "kyria_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyria_time_entries" ADD CONSTRAINT "kyria_time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kyria_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
