-- Aceite do solicitante sobre a cotação sugerida pelo atendimento (status "aguardando_aceite").
-- Só colunas novas e anuláveis: nenhuma linha existente é tocada.
ALTER TABLE "solicitacoes_viagem"
  ADD COLUMN "aceiteDecisao" VARCHAR(10),
  ADD COLUMN "aceiteObservacao" VARCHAR(1000),
  ADD COLUMN "aceiteEm" TIMESTAMP(3);
