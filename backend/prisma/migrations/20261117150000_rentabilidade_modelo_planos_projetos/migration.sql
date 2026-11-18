-- Rentabilidade (17/11/2026): reimporta a E043PCM como `modelo_planos` (modelos de planos de contas
-- e de centros de custo, com a estrutura do modelo — foi removida em 12/08/2026 por falta de
-- consumidor, agora o BI de Rentabilidade usa) e importa a E615PRJ (projeto → centro de custo da
-- hora de consultoria). Espelhos puros do Senior, ressincronizáveis do zero.

-- CreateTable
CREATE TABLE "modelo_planos" (
    "codmpc" INTEGER NOT NULL,
    "ctared" INTEGER NOT NULL,
    "clacta" VARCHAR(30),
    "descta" VARCHAR(250),
    "abrcta" VARCHAR(20),
    "anasin" VARCHAR(1),
    "nivcta" INTEGER,
    "mskgcc" VARCHAR(40),
    "defgru" VARCHAR(1),
    "natcta" VARCHAR(1),
    "despar" VARCHAR(80),
    "clapar" VARCHAR(30),
    "ctapar" INTEGER,
    "codccu" VARCHAR(9),
    "tipccu" INTEGER,
    "datalt" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "modelo_planos_pkey" PRIMARY KEY ("codmpc","ctared")
);

-- CreateTable
CREATE TABLE "projetos" (
    "codemp" INTEGER NOT NULL,
    "numprj" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "codtpj" INTEGER NOT NULL,
    "nomprj" VARCHAR(150),
    "abrprj" VARCHAR(20) NOT NULL,
    "codcli" INTEGER,
    "clifat" INTEGER,
    "codccu" VARCHAR(9),
    "sitprj" VARCHAR(3),
    "prjapr" VARCHAR(1),
    "prjsup" INTEGER,
    "datipj" DATE,
    "datfpj" DATE,
    "cli0800" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "projetos_pkey" PRIMARY KEY ("codemp","numprj")
);

-- CreateIndex
CREATE INDEX "projetos_codccu_idx" ON "projetos"("codccu");

-- CreateIndex
CREATE INDEX "projetos_codcli_idx" ON "projetos"("codcli");
