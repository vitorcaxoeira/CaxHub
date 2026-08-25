-- Família da NF de venda (e140nfv/e140isv/e140ipv/e140rat) do Senior — completa a query de
-- Faturamento colada no início da sessão de 24/08/2026 (Cliente/Produto/Serviço já entraram na
-- migration 20260824193631). Campos = piso mínimo confirmado nessa mesma query original (não
-- redescoberto do zero pelo dicionário). Sincronizado e verificado com dado real no mesmo dia:
-- 21.955 notas, 105.410 itens de serviço, 146 itens de produto, 106.951 rateios — contagem
-- batendo exato contra SELECT COUNT(*) direto no Senior pras 4 tabelas. FKs (itens ->
-- notas_fiscais_venda, notas_fiscais_venda -> clientes) formalizadas só depois de checar 0
-- órfãos contra esse mesmo dado real. Ver ~/.claude/plans/jaunty-crafting-neumann.md.

-- CreateTable
CREATE TABLE "notas_fiscais_venda" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "codsnf" VARCHAR(3) NOT NULL,
    "numnfv" INTEGER NOT NULL,
    "datemi" DATE NOT NULL,
    "codcli" INTEGER NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "notas_fiscais_venda_pkey" PRIMARY KEY ("codemp","codfil","codsnf","numnfv")
);

-- CreateTable
CREATE TABLE "itens_servico_nfv" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "codsnf" VARCHAR(3) NOT NULL,
    "numnfv" INTEGER NOT NULL,
    "seqisv" INTEGER NOT NULL,
    "codser" VARCHAR(14),
    "cplisv" VARCHAR(250),
    "vlrbru" DECIMAL(15,2),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "itens_servico_nfv_pkey" PRIMARY KEY ("codemp","codfil","codsnf","numnfv","seqisv")
);

-- CreateTable
CREATE TABLE "itens_produto_nfv" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "codsnf" VARCHAR(3) NOT NULL,
    "numnfv" INTEGER NOT NULL,
    "seqipv" INTEGER NOT NULL,
    "codpro" VARCHAR(14),
    "cplipv" VARCHAR(250),
    "vlrbru" DECIMAL(15,2),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "itens_produto_nfv_pkey" PRIMARY KEY ("codemp","codfil","codsnf","numnfv","seqipv")
);

-- CreateTable
CREATE TABLE "rateios_nfv" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "codsnf" VARCHAR(3) NOT NULL,
    "numnfv" INTEGER NOT NULL,
    "seqrat" INTEGER NOT NULL,
    "seqisv" INTEGER,
    "seqipv" INTEGER,
    "percta" DECIMAL(7,4),
    "perrat" DECIMAL(7,4),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "rateios_nfv_pkey" PRIMARY KEY ("codemp","codfil","codsnf","numnfv","seqrat")
);

-- AddForeignKey
ALTER TABLE "notas_fiscais_venda" ADD CONSTRAINT "notas_fiscais_venda_codcli_fkey" FOREIGN KEY ("codcli") REFERENCES "clientes"("codcli") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_servico_nfv" ADD CONSTRAINT "itens_servico_nfv_codemp_codfil_codsnf_numnfv_fkey" FOREIGN KEY ("codemp", "codfil", "codsnf", "numnfv") REFERENCES "notas_fiscais_venda"("codemp", "codfil", "codsnf", "numnfv") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_produto_nfv" ADD CONSTRAINT "itens_produto_nfv_codemp_codfil_codsnf_numnfv_fkey" FOREIGN KEY ("codemp", "codfil", "codsnf", "numnfv") REFERENCES "notas_fiscais_venda"("codemp", "codfil", "codsnf", "numnfv") ON DELETE RESTRICT ON UPDATE CASCADE;

