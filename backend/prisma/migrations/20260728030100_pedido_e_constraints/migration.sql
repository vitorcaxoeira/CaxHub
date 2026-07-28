-- CreateTable
CREATE TABLE "pedidos" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numped" INTEGER NOT NULL,
    "tipped" INTEGER,
    "prcped" INTEGER,
    "tnspro" VARCHAR(5),
    "tnsser" VARCHAR(5),
    "datemi" DATE NOT NULL,
    "horemi" INTEGER,
    "datprv" DATE,
    "obsped" VARCHAR(999),
    "codcli" INTEGER NOT NULL,
    "pedcli" VARCHAR(20),
    "codcpg" VARCHAR(6) NOT NULL,
    "codfpg" INTEGER,
    "sitped" INTEGER NOT NULL,
    "numrat" BIGINT,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("codemp","codfil","numped")
);

-- CheckConstraint (gerada por scripts/scaffold-table.ts a partir do dominio Senior, ver backend/prisma/constraints/pedidos.sql)
ALTER TABLE "pedidos" ADD CONSTRAINT "chk_pedidos_tipped" CHECK ("tipped" IN ('1', '2', '3', '4', '5', '6', '7', '8', '9'));
ALTER TABLE "pedidos" ADD CONSTRAINT "chk_pedidos_prcped" CHECK ("prcped" IN ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'));
ALTER TABLE "pedidos" ADD CONSTRAINT "chk_pedidos_sitped" CHECK ("sitped" IN ('1', '2', '3', '4', '5', '6', '7', '8', '9'));
