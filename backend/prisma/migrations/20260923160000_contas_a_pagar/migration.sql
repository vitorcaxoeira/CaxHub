-- Contas a Pagar no padrão do CaxHub_Atlas (24/09/2026): E095FOR (fornecedores), E501TCP
-- (titulos_pagar), E501MCP (movimentos_pagar) e E501RAT (rateios_pagar), tabelas inteiras, sem
-- recorte fixo. Substitui a versão de 23/09 desta migration, que espelhava só codtpt='10'
-- (nunca foi pra produção). `obstcp` é extra do CaxHub: o modal do card de RDV mostra a
-- observação do título.

-- CreateTable
CREATE TABLE "fornecedores" (
    "codfor" INTEGER NOT NULL,
    "nomfor" VARCHAR(100) NOT NULL,
    "apefor" VARCHAR(50) NOT NULL,
    "tipfor" VARCHAR(1) NOT NULL,
    "tipmer" VARCHAR(1) NOT NULL,
    "codram" VARCHAR(5),
    "insest" VARCHAR(25),
    "cgccpf" BIGINT,
    "endfor" VARCHAR(100),
    "cplend" VARCHAR(200),
    "cepfor" INTEGER,
    "baifor" VARCHAR(75),
    "cidfor" VARCHAR(60),
    "sigufs" VARCHAR(2),
    "codpai" VARCHAR(4),
    "sitfor" VARCHAR(1) NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("codfor")
);

-- CreateTable
CREATE TABLE "titulos_pagar" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numtit" VARCHAR(15) NOT NULL,
    "codtpt" VARCHAR(3) NOT NULL,
    "codfor" INTEGER NOT NULL,
    "codtns" VARCHAR(5) NOT NULL,
    "sittit" VARCHAR(2) NOT NULL,
    "datemi" DATE NOT NULL,
    "datent" DATE NOT NULL,
    "vctori" DATE NOT NULL,
    "vctpro" DATE NOT NULL,
    "vlrori" DECIMAL(15,2) NOT NULL,
    "vlrabe" DECIMAL(15,2),
    "codfpg" INTEGER,
    "codpor" VARCHAR(4) NOT NULL,
    "codmoe" VARCHAR(3),
    "ctafin" INTEGER,
    "ctared" INTEGER,
    "codccu" VARCHAR(9),
    "numprj" INTEGER,
    "codfpj" INTEGER,
    "obstcp" VARCHAR(250),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "titulos_pagar_pkey" PRIMARY KEY ("codemp","codfil","numtit","codtpt","codfor")
);

-- CreateTable
CREATE TABLE "movimentos_pagar" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numtit" VARCHAR(15) NOT NULL,
    "codtpt" VARCHAR(3) NOT NULL,
    "codfor" INTEGER NOT NULL,
    "seqmov" INTEGER NOT NULL,
    "codtns" VARCHAR(5) NOT NULL,
    "datmov" DATE NOT NULL,
    "datpgt" DATE,
    "vlrmov" DECIMAL(15,2) NOT NULL,
    "vlrliq" DECIMAL(15,2),
    "diaatr" INTEGER,
    "codpor" VARCHAR(4),
    "codcrt" VARCHAR(2),
    "ctafin" INTEGER,
    "ctared" INTEGER,
    "codccu" VARCHAR(9),
    "numcco" VARCHAR(14),
    "datcco" DATE,
    "seqcco" INTEGER,
    "seqmcr" INTEGER,
    "lctfin" VARCHAR(1) NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "movimentos_pagar_pkey" PRIMARY KEY ("codemp","codfil","numtit","codtpt","codfor","seqmov")
);

-- CreateTable
CREATE TABLE "rateios_pagar" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numtit" VARCHAR(15) NOT NULL,
    "codtpt" VARCHAR(3) NOT NULL,
    "codfor" INTEGER NOT NULL,
    "seqmov" INTEGER NOT NULL,
    "seqrat" INTEGER NOT NULL,
    "datbas" DATE,
    "codtns" VARCHAR(5),
    "mesano" DATE,
    "crirat" INTEGER NOT NULL,
    "somsub" INTEGER NOT NULL,
    "numprj" INTEGER,
    "codfpj" INTEGER,
    "ctafin" INTEGER,
    "ctared" INTEGER,
    "percta" DECIMAL(11,4),
    "vlrcta" DECIMAL(15,2),
    "codccu" VARCHAR(9),
    "perrat" DECIMAL(11,4),
    "vlrrat" DECIMAL(15,2),
    "obsrat" VARCHAR(120),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "rateios_pagar_pkey" PRIMARY KEY ("codemp","codfil","numtit","codtpt","codfor","seqmov","seqrat")
);

-- CreateIndex
CREATE INDEX "titulos_pagar_codfor_sittit_idx" ON "titulos_pagar"("codfor", "sittit");

-- CreateIndex
CREATE INDEX "rateios_pagar_codemp_ctafin_datbas_idx" ON "rateios_pagar"("codemp", "ctafin", "datbas");

-- AddForeignKey
ALTER TABLE "titulos_pagar" ADD CONSTRAINT "titulos_pagar_codfor_fkey" FOREIGN KEY ("codfor") REFERENCES "fornecedores"("codfor") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_pagar" ADD CONSTRAINT "movimentos_pagar_codemp_codfil_numtit_codtpt_codfor_fkey" FOREIGN KEY ("codemp","codfil","numtit","codtpt","codfor") REFERENCES "titulos_pagar"("codemp","codfil","numtit","codtpt","codfor") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_pagar" ADD CONSTRAINT "movimentos_pagar_codemp_codtns_fkey" FOREIGN KEY ("codemp","codtns") REFERENCES "transacoes"("codemp","codtns") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rateios_pagar" ADD CONSTRAINT "rateios_pagar_codemp_codfil_numtit_codtpt_codfor_fkey" FOREIGN KEY ("codemp","codfil","numtit","codtpt","codfor") REFERENCES "titulos_pagar"("codemp","codfil","numtit","codtpt","codfor") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domínio LSitTit (prisma/constraints/titulos_pagar.sql)
ALTER TABLE "titulos_pagar" ADD CONSTRAINT "chk_titulos_pagar_sittit" CHECK ("sittit" IN ('AO', 'AN', 'AA', 'AB', 'AC', 'AE', 'AI', 'AJ', 'AP', 'AR', 'AS', 'AV', 'AX', 'CA', 'CE', 'CO', 'LQ', 'LC', 'LI', 'LM', 'LO', 'LP', 'LS', 'LV', 'LX', 'PE'));

-- Detecção de exclusão das 3 tabelas de pagar nasce em "simular" (decisão de 24/09/2026).
-- Vai por migration porque o deploy não roda seed. Fornecedor segue o padrão ("desligada").
INSERT INTO "configuracoes_varredura" ("job_name", "modo", "atualizado_em")
VALUES ('titulos_pagar-sync', 'simular', now()),
       ('movimentos_pagar-sync', 'simular', now()),
       ('rateios_pagar-sync', 'simular', now())
ON CONFLICT ("job_name") DO NOTHING;
