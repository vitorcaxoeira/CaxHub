-- Tabelas novas de Contábil/Orçamento identificadas a partir de uma SQL de BI fornecida pelo
-- usuário (11/08/2026) — lançamento contábil, rateio, orçamento, plano de contas hierárquico
-- e plano de contas paralelo. Colunas confirmadas contra o dicionário real do Senior
-- (r996tbl/r996fld), não só pelo texto da query. Gerado sem dado importado ainda de propósito
-- — a importação fica pra ser disparada manualmente pela tela Administração > Importados do
-- Senior, depois que este deploy estiver no ar.

-- AlterTable
ALTER TABLE "empresa" ADD COLUMN     "codmpc" INTEGER,
ADD COLUMN     "codmpu" INTEGER;

-- AlterTable
ALTER TABLE "centros_custo" ADD COLUMN     "claccu" VARCHAR(30);

-- CreateTable
CREATE TABLE "plano_contabil" (
    "codemp" INTEGER NOT NULL,
    "ctared" INTEGER NOT NULL,
    "descta" VARCHAR(250) NOT NULL,
    "clacta" VARCHAR(30) NOT NULL,
    "defgru" VARCHAR(1) NOT NULL,
    "natcta" VARCHAR(1) NOT NULL,
    "anasin" VARCHAR(1) NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "plano_contabil_pkey" PRIMARY KEY ("codemp","ctared")
);

-- CreateTable
CREATE TABLE "plano_contabil_paralelo" (
    "codmpc" INTEGER NOT NULL,
    "ctared" INTEGER NOT NULL,
    "despar" VARCHAR(80),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "plano_contabil_paralelo_pkey" PRIMARY KEY ("codmpc","ctared")
);

-- CreateTable
CREATE TABLE "lancamentos_contabeis" (
    "codemp" INTEGER NOT NULL,
    "numlct" BIGINT NOT NULL,
    "sitlct" INTEGER NOT NULL,
    "orilct" VARCHAR(3) NOT NULL,
    "cpllct" VARCHAR(250),
    "numlot" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "lancamentos_contabeis_pkey" PRIMARY KEY ("codemp","numlct")
);

-- CreateTable
CREATE TABLE "rateios_lancamento" (
    "codemp" INTEGER NOT NULL,
    "numlct" BIGINT NOT NULL,
    "ctared" INTEGER NOT NULL,
    "codccu" VARCHAR(9) NOT NULL,
    "debcre" VARCHAR(1),
    "datlct" DATE NOT NULL,
    "vlrrat" DECIMAL(17,2) NOT NULL,
    "sitrat" INTEGER NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "rateios_lancamento_pkey" PRIMARY KEY ("codemp","numlct","ctared","codccu")
);

-- CreateTable
CREATE TABLE "orcamentos_contabeis" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "mesano" DATE NOT NULL,
    "ctared" INTEGER NOT NULL,
    "codccu" VARCHAR(9) NOT NULL,
    "ctafin" INTEGER NOT NULL,
    "vlrrat" DECIMAL(17,2) NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "orcamentos_contabeis_pkey" PRIMARY KEY ("codemp","codfil","mesano","ctared","codccu","ctafin")
);


-- CHECK constraints (domínios do Senior)
ALTER TABLE "plano_contabil" ADD CONSTRAINT "chk_plano_contabil_defgru" CHECK ("defgru" IN ('A', 'P', 'D', 'R', 'X', 'M', 'N', 'U', 'L', 'V', 'C', 'S', 'E', 'O', 'T'));
ALTER TABLE "plano_contabil" ADD CONSTRAINT "chk_plano_contabil_natcta" CHECK ("natcta" IN ('D', 'C'));
ALTER TABLE "plano_contabil" ADD CONSTRAINT "chk_plano_contabil_anasin" CHECK ("anasin" IN ('A', 'S'));
ALTER TABLE "lancamentos_contabeis" ADD CONSTRAINT "chk_lancamentos_contabeis_sitlct" CHECK ("sitlct" IN ('1', '2', '3', '4'));
ALTER TABLE "lancamentos_contabeis" ADD CONSTRAINT "chk_lancamentos_contabeis_orilct" CHECK ("orilct" IN ('MAN', 'VEN', 'VEF', 'EST', 'REC', 'AFR', 'RAM', 'ARV', 'CPR', 'COF', 'PAG', 'COM', 'AFP', 'PAM', 'APV', 'TES', 'PRD', 'PAT', 'IVE', 'ICO', 'IVZ', 'IOD', 'IMP', 'RPA', 'UIV', 'IVR', 'IVO', 'IVI', 'PRJ', 'CTC', 'VRB', 'REG'));
ALTER TABLE "rateios_lancamento" ADD CONSTRAINT "chk_rateios_lancamento_debcre" CHECK ("debcre" IN ('D', 'C'));
ALTER TABLE "rateios_lancamento" ADD CONSTRAINT "chk_rateios_lancamento_sitrat" CHECK ("sitrat" IN ('1', '2', '3', '4'));
