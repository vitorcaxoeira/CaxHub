-- AlterTable
-- O DEFAULT true já backfilla toda linha PRÉ-EXISTENTE desta tabela pra true no mesmo ALTER
-- (proposta_modo_alocacao tem linhas desde 23/07/2026, via POST .../modo, bem antes desta
-- coluna existir — nenhuma delas representa uma escolha real sobre a trava de excedente,
-- então herdar o novo default é o comportamento certo, não uma migração de dado arriscada).
ALTER TABLE "proposta_modo_alocacao" ADD COLUMN     "bloqueiaExcedenteEstrutura" BOOLEAN NOT NULL DEFAULT true;

