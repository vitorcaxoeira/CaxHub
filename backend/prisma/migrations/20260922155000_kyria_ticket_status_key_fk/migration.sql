-- AddForeignKey (kyria_ticket_statuses foi populada — GET /ticket-statuses, 12 registros —
-- antes desta migration; os 11 status_key distintos usados nos 6.669 tickets locais batem
-- todos com um key real, confirmado em 22/09/2026 antes de aplicar).
ALTER TABLE "kyria_tickets" ADD CONSTRAINT "kyria_tickets_status_key_fkey" FOREIGN KEY ("status_key") REFERENCES "kyria_ticket_statuses"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
