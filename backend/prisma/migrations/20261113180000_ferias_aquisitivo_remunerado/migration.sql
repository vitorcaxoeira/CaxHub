-- Férias remuneradas ou não, por período aquisitivo (13/11/2026): nem todo consultor PJ tem férias pagas no contrato. true (padrão) mantém o comportamento dos períodos
-- já cadastrados (o gozo calcula o valor); false = o gozo só marca os dias no calendário e consome o saldo, sem valor a pagar.
ALTER TABLE "ferias_periodos_aquisitivos" ADD COLUMN "remunerado" BOOLEAN NOT NULL DEFAULT true;
