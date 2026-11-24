-- Licenças da Gestão de Metas do Comercial passam a vir dos pedidos de venda (regra do Vitor em 19/10/2026): pedidos pela data de
-- emissão (E120PED), somando os itens de serviço (E120ISP) que têm rateio (E120RAT) na conta financeira 177; valor = PreUni × QtdPed
-- (VlrBru/VlrLiq do item zeram quando o pedido é liquidado); pedido cancelado fica fora. A pessoa recebe as do representante do pedido.

ALTER TABLE "pedidos" ADD COLUMN "codrep" INTEGER;

CREATE TABLE "pedidos_itens_servico" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numped" INTEGER NOT NULL,
    "seqisp" INTEGER NOT NULL,
    "codser" VARCHAR(14),
    "cplisp" VARCHAR(250),
    "qtdped" DECIMAL(14,5) NOT NULL,
    "preuni" DECIMAL(21,10) NOT NULL,
    "vlrbru" DECIMAL(15,2),
    "vlrliq" DECIMAL(15,2),
    "sitisp" INTEGER NOT NULL,
    "ctafin" INTEGER,
    "codrep" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "pedidos_itens_servico_pkey" PRIMARY KEY ("codemp","codfil","numped","seqisp")
);
-- Domínio LSitPed (1 a 9).
ALTER TABLE "pedidos_itens_servico" ADD CONSTRAINT "chk_pedidos_itens_servico_sitisp" CHECK ("sitisp" IN (1, 2, 3, 4, 5, 6, 7, 8, 9));

CREATE TABLE "pedidos_rateios" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numped" INTEGER NOT NULL,
    "seqrat" INTEGER NOT NULL,
    "seqisp" INTEGER,
    "seqipd" INTEGER,
    "ctafin" INTEGER,
    "percta" DECIMAL(7,4),
    "vlrcta" DECIMAL(15,2),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "pedidos_rateios_pkey" PRIMARY KEY ("codemp","codfil","numped","seqrat")
);
-- Procura do rateio da licença por item (codemp, codfil, numped, seqisp) com a conta.
CREATE INDEX "pedidos_rateios_item_ctafin_idx" ON "pedidos_rateios"("codemp", "codfil", "numped", "seqisp", "ctafin");

-- Origem nova do indicador.
ALTER TABLE "metas_comercial_indicadores" DROP CONSTRAINT "metas_comercial_indicadores_origem_check";
ALTER TABLE "metas_comercial_indicadores" ADD CONSTRAINT "metas_comercial_indicadores_origem_check"
  CHECK ("origem" IN ('MANUAL', 'FATURAMENTO_SENIOR', 'CARTEIRA_SENIOR', 'PROPOSTAS_SENIOR', 'PEDIDOS_SENIOR'));

UPDATE "metas_comercial_indicadores" SET "origem" = 'PEDIDOS_SENIOR' WHERE "codigo" = 'LICENCAS';

-- O realizado de Licenças agora vem dos pedidos: some o digitado (importado da planilha); linha sem meta some inteira.
UPDATE "metas_comercial_lancamentos" SET "realizado" = NULL
 WHERE "indicadorId" = (SELECT "id" FROM "metas_comercial_indicadores" WHERE "codigo" = 'LICENCAS');
DELETE FROM "metas_comercial_lancamentos"
 WHERE "indicadorId" = (SELECT "id" FROM "metas_comercial_indicadores" WHERE "codigo" = 'LICENCAS')
   AND "meta" IS NULL;
