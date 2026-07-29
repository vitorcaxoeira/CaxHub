-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "removido_em_senior" TIMESTAMPTZ(6),
ADD COLUMN     "visto_em_sync" TIMESTAMPTZ(6);

-- Backfill: tudo que já está na tabela veio do Senior, então entra elegível à varredura
-- com um carimbo antigo. Sem isso a primeira varredura não acharia nada, porque
-- `visto_em_sync` NULL nunca é varrido (`NULL < x` é NULL em SQL). A data sentinela
-- deixa óbvio, numa inspeção manual, quem nunca passou por uma sync pós-deploy.
UPDATE "pedidos" SET "visto_em_sync" = TIMESTAMPTZ '2000-01-01 00:00:00+00';
