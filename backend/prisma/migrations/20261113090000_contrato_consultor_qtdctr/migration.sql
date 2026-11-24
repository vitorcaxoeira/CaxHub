-- Quantidade fixa do contrato do consultor (13/11/2026): a view USU_VBI01CTRCS ganhou `qtdctr`. Com codmot = 12 o contrato é de VALOR FIXO e o valor da
-- nota é vlrhor × qtdctr (vlrhor segue sendo o valor da hora). NULL nos demais contratos. O espelho se corrige no próximo sync (contratos-consultores-sync).
ALTER TABLE "contratos_consultores" ADD COLUMN "qtdctr" DECIMAL(15,5);
