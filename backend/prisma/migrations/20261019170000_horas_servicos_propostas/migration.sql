-- Horas de Serviços da Gestão de Metas do Comercial passam a vir das propostas aprovadas (regra do ERP entregue pelo Vitor em
-- 19/10/2026): USU_TE077PRO situação 4/7/8, mês da data de retorno, itens com faturamento S/A, horas = USU_QTDHOR (minutos) / 60.
-- A pessoa recebe as horas do representante (codrep) dela; representante sem pessoa vai para "Não atribuído".

ALTER TABLE "metas_comercial_participantes" ADD COLUMN "codrep" INTEGER;

ALTER TABLE "metas_comercial_indicadores" DROP CONSTRAINT "metas_comercial_indicadores_origem_check";
ALTER TABLE "metas_comercial_indicadores" ADD CONSTRAINT "metas_comercial_indicadores_origem_check"
  CHECK ("origem" IN ('MANUAL', 'FATURAMENTO_SENIOR', 'CARTEIRA_SENIOR', 'PROPOSTAS_SENIOR'));

UPDATE "metas_comercial_indicadores" SET "origem" = 'PROPOSTAS_SENIOR' WHERE "codigo" = 'HORAS_SERVICOS';

-- Taíza (codfor 580) é a representante TAIZA (codrep 32) no Senior.
UPDATE "metas_comercial_participantes" SET "codrep" = 32 WHERE "codfor" = 580;

-- O realizado de horas agora vem das propostas: some o digitado (importado da planilha); linha sem meta some inteira (a observação
-- dela falava do valor digitado).
UPDATE "metas_comercial_lancamentos" SET "realizado" = NULL
 WHERE "indicadorId" = (SELECT "id" FROM "metas_comercial_indicadores" WHERE "codigo" = 'HORAS_SERVICOS');
DELETE FROM "metas_comercial_lancamentos"
 WHERE "indicadorId" = (SELECT "id" FROM "metas_comercial_indicadores" WHERE "codigo" = 'HORAS_SERVICOS')
   AND "meta" IS NULL;
