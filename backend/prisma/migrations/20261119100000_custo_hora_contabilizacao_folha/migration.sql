-- Custo do CLT pela CONTABILIZACAO DA FOLHA (R048CTB do HCM), 19/11/2026: espelho das linhas originais (perrat = 0) e as regras de quais contas do plano
-- compoem o custo (custo_contas_folha, nasce vazia). Substitui a classificacao dos eventos da folha (R046VER) e os encargos em %, que nunca foram para
-- producao e saem aqui (custo_evento_classes e custo_encargos).

-- DropTable
DROP TABLE "custo_encargos";

-- DropTable
DROP TABLE "custo_evento_classes";

-- CreateTable
CREATE TABLE "hcm_contabilizacao_folha" (
    "id" SERIAL NOT NULL,
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "codcal" INTEGER,
    "codlot" INTEGER,
    "datlan" DATE NOT NULL,
    "opcctb" INTEGER,
    "orictb" VARCHAR(1),
    "codclc" INTEGER,
    "cplhis" VARCHAR(100),
    "debcre" VARCHAR(1) NOT NULL,
    "reddeb" INTEGER,
    "redcre" INTEGER,
    "ctared" INTEGER,
    "codccu" VARCHAR(18),
    "codfil" INTEGER,
    "vallan" DECIMAL(14,2) NOT NULL,
    "sincronizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hcm_contabilizacao_folha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custo_contas_folha" (
    "codemp" INTEGER NOT NULL,
    "ctared" INTEGER NOT NULL,
    "acao" VARCHAR(10) NOT NULL,

    CONSTRAINT "custo_contas_folha_pkey" PRIMARY KEY ("codemp","ctared")
);

-- CreateIndex
CREATE INDEX "hcm_contabilizacao_folha_numemp_tipcol_numcad_datlan_idx" ON "hcm_contabilizacao_folha"("numemp", "tipcol", "numcad", "datlan");

-- CreateIndex
CREATE INDEX "hcm_contabilizacao_folha_datlan_idx" ON "hcm_contabilizacao_folha"("datlan");

-- Parametro que deixou de existir (tipos de calculo da folha): o CLT agora vem da contabilizacao da folha.
DELETE FROM "custo_parametros" WHERE "chave" = 'tipos_calculo';
