-- Contrato PJ com preco MENSAL (18/11/2026): alguns contratos do Senior guardam o valor do mes em PreUni (unidade UN), sem nenhuma marca que os
-- distinga dos contratos por hora. A escolha e explicita por consultor (tela Vinculo de Consultores); default false = o preco e por hora.

-- AlterTable
ALTER TABLE "consultor_vinculos" ADD COLUMN "contrato_mensal" BOOLEAN NOT NULL DEFAULT false;
