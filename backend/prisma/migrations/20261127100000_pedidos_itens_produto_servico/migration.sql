-- Abas "Itens de Produto" e "Itens de Serviço" da visualização do pedido (portado do CaxHub_Dash, 27/11/2026). Só acréscimos.

-- E120ISP: a tabela já existia (Licenças da Gestão de Metas); entram os campos que a aba lê. Ficam nulos até o próximo sync.
ALTER TABLE "pedidos_itens_servico"
    ADD COLUMN "qtdrea" DECIMAL(14,5),
    ADD COLUMN "qtdfat" DECIMAL(14,5),
    ADD COLUMN "qtdcan" DECIMAL(14,5),
    ADD COLUMN "qtdabe" DECIMAL(14,5),
    ADD COLUMN "unimed" VARCHAR(3),
    ADD COLUMN "codmoe" VARCHAR(3),
    ADD COLUMN "datent" DATE;

-- E120IPD: espelho novo, no mesmo molde do de serviço.
CREATE TABLE "pedidos_itens_produto" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numped" INTEGER NOT NULL,
    "seqipd" INTEGER NOT NULL,
    "codpro" VARCHAR(14),
    "codder" VARCHAR(7),
    "cplipd" VARCHAR(250),
    "qtdped" DECIMAL(14,5) NOT NULL,
    "qtdaen" DECIMAL(14,5),
    "qtdfat" DECIMAL(14,5),
    "qtdcan" DECIMAL(14,5),
    "qtdabe" DECIMAL(14,5),
    "unimed" VARCHAR(3),
    "preuni" DECIMAL(21,10),
    "codmoe" VARCHAR(3),
    "vlrliq" DECIMAL(15,2),
    "datent" DATE,
    "sitipd" INTEGER NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "pedidos_itens_produto_pkey" PRIMARY KEY ("codemp","codfil","numped","seqipd")
);
-- Domínio LSitPed (1 a 9).
ALTER TABLE "pedidos_itens_produto" ADD CONSTRAINT "chk_pedidos_itens_produto_sitipd" CHECK ("sitipd" IN (1, 2, 3, 4, 5, 6, 7, 8, 9));
