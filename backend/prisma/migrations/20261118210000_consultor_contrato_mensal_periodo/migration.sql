-- Periodo do preco mensal (18/11/2026): o mesmo contrato pode ter sido por hora, passado a mensal e voltado a por hora (ex.: contratos cujo
-- historico de reajuste vai de 33,18 por hora para 14.084,55 por mes). Datas no dia 1 do mes; nulo = sem limite daquele lado.

-- AlterTable
ALTER TABLE "consultor_vinculos" ADD COLUMN "mensal_desde" DATE,
ADD COLUMN "mensal_ate" DATE;
