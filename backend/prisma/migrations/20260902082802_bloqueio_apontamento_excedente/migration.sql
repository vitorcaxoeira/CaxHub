-- AlterTable
ALTER TABLE "proposta_modo_alocacao" ADD COLUMN "bloqueiaApontamento" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "proposta_modo_alocacao" ADD COLUMN "bloqueiaExcedente" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "atividades_consultor" ADD COLUMN "bloqueiaApontamento" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "atividades_consultor" ADD COLUMN "bloqueiaExcedente" BOOLEAN NOT NULL DEFAULT true;

-- Sem UPDATE de backfill: os defaults acima já reproduzem o comportamento de hoje
-- (apontamento livre, excedente exige liberação explícita) tanto pra linha nova quanto
-- pra linha pré-existente — decisão confirmada com o Vitor em 02/09/2026 exatamente pra
-- evitar bloquear apontamento em produção no instante do deploy.
