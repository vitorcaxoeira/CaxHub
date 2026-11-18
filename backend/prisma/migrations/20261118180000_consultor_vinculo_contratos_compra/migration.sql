-- Custo-hora real, bloco C da Rentabilidade (18/11/2026): vinculo do consultor com o funcionario do HCM (tabela nativa, nasce vazia) e os
-- espelhos dos contratos de compra do Senior (E460CTR/CCS/REA) que guardam o valor-hora do consultor PJ e o historico de reajuste. Nenhum dado
-- inicial: as tres tabelas de contrato sao preenchidas pelas syncs (contratos-compra-sync, contratos-compra-servicos-sync e
-- contratos-compra-reajustes-sync), e o vinculo, pela tela Administracao > Vinculo de Consultores.

-- CreateTable
CREATE TABLE "consultor_vinculos" (
    "codemp" INTEGER NOT NULL,
    "codusu" INTEGER NOT NULL,
    "hcm_numemp" INTEGER,
    "hcm_tipcol" INTEGER,
    "hcm_numcad" INTEGER,
    "observacao" VARCHAR(500),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,
    "atualizado_por" INTEGER,

    CONSTRAINT "consultor_vinculos_pkey" PRIMARY KEY ("codemp","codusu")
);

-- CreateTable
CREATE TABLE "contratos_compra" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numctr" INTEGER NOT NULL,
    "tipctr" INTEGER NOT NULL,
    "numofi" VARCHAR(20),
    "objctr" VARCHAR(250),
    "codfor" INTEGER NOT NULL,
    "datemi" DATE,
    "sitctr" VARCHAR(1) NOT NULL,
    "codmot" INTEGER,
    "inivig" DATE,
    "fimvig" DATE,
    "ultrea" DATE,
    "prdrea" INTEGER,
    "perrea" DECIMAL(5,2),
    "inirea" DATE,
    "datcan" DATE,
    "clifat" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "contratos_compra_pkey" PRIMARY KEY ("codemp","codfil","numctr")
);

-- CreateTable
CREATE TABLE "contratos_compra_servicos" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numctr" INTEGER NOT NULL,
    "datcpt" DATE NOT NULL,
    "seqccs" INTEGER NOT NULL,
    "codser" VARCHAR(14),
    "cplccs" VARCHAR(250),
    "qtdctr" DECIMAL(14,5),
    "qtdccs" DECIMAL(14,5) NOT NULL,
    "unimed" VARCHAR(3),
    "preuni" DECIMAL(21,10) NOT NULL,
    "usu_preuni" DECIMAL(21,10),
    "perdsc" DECIMAL(4,2),
    "vlrdsc" DECIMAL(15,2),
    "periss" DECIMAL(6,4),
    "perirf" DECIMAL(4,2),
    "perins" DECIMAL(4,2),
    "perpit" DECIMAL(7,4),
    "percsl" DECIMAL(4,2),
    "percrt" DECIMAL(7,4),
    "perour" DECIMAL(4,2),
    "sitccs" VARCHAR(1) NOT NULL,
    "codmot" INTEGER,
    "numprj" INTEGER,
    "codccu" VARCHAR(9),
    "ctared" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "contratos_compra_servicos_pkey" PRIMARY KEY ("codemp","codfil","numctr","datcpt","seqccs")
);

-- CreateTable
CREATE TABLE "contratos_compra_reajustes" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numctr" INTEGER NOT NULL,
    "datcpt" DATE NOT NULL,
    "seqccs" INTEGER NOT NULL,
    "seqccp" INTEGER NOT NULL,
    "ultrea" DATE NOT NULL,
    "vlrrea" DECIMAL(15,2),
    "vlratu" DECIMAL(15,2),
    "codusu" INTEGER NOT NULL,
    "datrea" DATE,
    "perrea" DECIMAL(7,4),
    "reapre" DECIMAL(7,4),
    "desrea" VARCHAR(100),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "contratos_compra_reajustes_pkey" PRIMARY KEY ("codemp","codfil","numctr","datcpt","seqccs","seqccp","ultrea")
);

-- CreateIndex
CREATE UNIQUE INDEX "consultor_vinculos_hcm_key" ON "consultor_vinculos"("hcm_numemp", "hcm_tipcol", "hcm_numcad");

-- CreateIndex
CREATE INDEX "contratos_compra_codfor_idx" ON "contratos_compra"("codfor");

-- CreateIndex
CREATE INDEX "contratos_compra_servicos_codemp_numctr_idx" ON "contratos_compra_servicos"("codemp", "numctr");

-- CreateIndex
CREATE INDEX "contratos_compra_reajustes_codemp_numctr_idx" ON "contratos_compra_reajustes"("codemp", "numctr");

-- AddForeignKey
ALTER TABLE "consultor_vinculos" ADD CONSTRAINT "consultor_vinculos_codemp_codusu_fkey" FOREIGN KEY ("codemp", "codusu") REFERENCES "consultores"("codemp", "codusu") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultor_vinculos" ADD CONSTRAINT "consultor_vinculos_hcm_numemp_hcm_tipcol_hcm_numcad_fkey" FOREIGN KEY ("hcm_numemp", "hcm_tipcol", "hcm_numcad") REFERENCES "hcm_colaboradores"("numemp", "tipcol", "numcad") ON DELETE SET NULL ON UPDATE CASCADE;
