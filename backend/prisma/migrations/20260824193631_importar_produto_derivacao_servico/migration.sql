-- Catálogo de Produtos (e075pro), Derivações de Produto (e075der) e Serviços (e080ser) do
-- Senior — pedido do Vitor em 24/08/2026, a partir da mesma família de tabelas do levantamento
-- de Faturamento (NF de venda). Campos mínimos confirmados pela query real da tela de
-- Produtos/Derivações da própria aplicação Senior (fornecida pelo Vitor); Serviço com o piso
-- mínimo já confirmado na query de Faturamento (codemp/codser/desser). Gerada sem dado
-- importado ainda de propósito — as 3 tabelas nascem vazias, o Vitor dispara a sincronização
-- pela tela de Administração quando quiser. Ver ~/.claude/plans/jaunty-crafting-neumann.md.
--
-- Migration gerada sem shadow database (usuário Postgres local sem CREATEDB) via
-- `prisma migrate diff --from-schema-datamodel <schema antigo> --to-schema-datamodel
-- schema.prisma --script`, já aplicada via `prisma db push` antes de existir como arquivo —
-- ver [[prisma-sem-shadow-database]] no segundo cérebro.

-- CreateTable
CREATE TABLE "produtos" (
    "codemp" INTEGER NOT NULL,
    "codpro" VARCHAR(14) NOT NULL,
    "despro" VARCHAR(100) NOT NULL,
    "cplpro" VARCHAR(50),
    "desnfv" VARCHAR(99),
    "codfam" VARCHAR(6) NOT NULL,
    "unimed" VARCHAR(3) NOT NULL,
    "unime2" VARCHAR(3),
    "unime3" VARCHAR(3),
    "tippro" VARCHAR(1) NOT NULL,
    "codori" VARCHAR(3) NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("codemp","codpro")
);

-- CreateTable
CREATE TABLE "derivacoes_produto" (
    "codemp" INTEGER NOT NULL,
    "codpro" VARCHAR(14) NOT NULL,
    "codder" VARCHAR(7) NOT NULL,
    "desder" VARCHAR(50),
    "descpl" VARCHAR(90),
    "codbar" VARCHAR(30),
    "tipcn2" VARCHAR(1),
    "vlrcn2" DECIMAL(13,6),
    "tipcn3" VARCHAR(1),
    "vlrcn3" DECIMAL(13,6),
    "pesbru" DECIMAL(11,5),
    "pesliq" DECIMAL(11,5),
    "tolpes" DECIMAL(5,3),
    "volder" DECIMAL(11,5),
    "codemb" INTEGER,
    "qtdemb" DECIMAL(12,5),
    "codref" VARCHAR(40),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "derivacoes_produto_pkey" PRIMARY KEY ("codemp","codpro","codder")
);

-- CreateTable
CREATE TABLE "servicos" (
    "codemp" INTEGER NOT NULL,
    "codser" VARCHAR(14) NOT NULL,
    "desser" VARCHAR(70) NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "servicos_pkey" PRIMARY KEY ("codemp","codser")
);

-- AddForeignKey
ALTER TABLE "derivacoes_produto" ADD CONSTRAINT "derivacoes_produto_codemp_codpro_fkey" FOREIGN KEY ("codemp", "codpro") REFERENCES "produtos"("codemp", "codpro") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints geradas pelo scaffold-table.ts a partir do domínio real do Senior
-- (prisma/constraints/produtos.sql e prisma/constraints/derivacoes_produto.sql) — coladas
-- aqui em vez de aplicadas via `prisma db execute` separado, mesmo padrão da migration
-- 20260811140717_tabelas_contabeis_orcamento.
ALTER TABLE "produtos" ADD CONSTRAINT "chk_produtos_tippro" CHECK ("tippro" IN ('P', 'C', 'M', 'D', 'S'));

-- tipcn2/tipcn3 vêm em branco (espaço, não NULL) em derivação sem 2ª/3ª unidade de medida —
-- constraint estrita quebrou no primeiro sync real (produto 0001, derivação genérica " ");
-- mesma classe de bug já visto em transacoes.rectpb, ver CaxHub.md no segundo cérebro.
ALTER TABLE "derivacoes_produto" ADD CONSTRAINT "chk_derivacoes_produto_tipcn2" CHECK ("tipcn2" IS NULL OR trim("tipcn2") = '' OR "tipcn2" IN ('*', '/', 'R'));
ALTER TABLE "derivacoes_produto" ADD CONSTRAINT "chk_derivacoes_produto_tipcn3" CHECK ("tipcn3" IS NULL OR trim("tipcn3") = '' OR "tipcn3" IN ('*', '/', 'R'));

