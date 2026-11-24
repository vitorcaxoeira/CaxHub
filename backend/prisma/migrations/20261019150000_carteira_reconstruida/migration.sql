-- Carteira de mensalidades reconstruída para os meses anteriores à primeira foto (Gestão de Metas do Comercial):
-- 1) espelho de E160REA (histórico de reajustes e upgrades USU_VlrUpg dos itens de contrato);
-- 2) datas que dizem quando contrato e item existiam (último faturamento e início de vigência);
-- 3) fonte da foto mensal (FOTO = lida no mês; RECONSTRUIDA = recalculada com o histórico, nunca sobrescreve FOTO).

ALTER TABLE "contratos_venda" ADD COLUMN "datuft" DATE;
ALTER TABLE "contratos_venda_servicos" ADD COLUMN "datuft" DATE, ADD COLUMN "inivig" DATE;

ALTER TABLE "metas_comercial_carteira" ADD COLUMN "fonte" VARCHAR(12) NOT NULL DEFAULT 'FOTO';
ALTER TABLE "metas_comercial_carteira" ADD CONSTRAINT "metas_comercial_carteira_fonte_check" CHECK ("fonte" IN ('FOTO', 'RECONSTRUIDA'));

CREATE TABLE "contratos_venda_reajustes" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numctr" INTEGER NOT NULL,
    "datcpt" DATE NOT NULL,
    "seqcvs" INTEGER NOT NULL,
    "seqcvp" INTEGER NOT NULL,
    "ultrea" DATE NOT NULL,
    "vlrrea" DECIMAL(14,5),
    "vlratu" DECIMAL(14,5),
    "perrea" DECIMAL(7,4),
    "tiprea" VARCHAR(1),
    "usu_vlrupg" DECIMAL(14,5),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "contratos_venda_reajustes_pkey" PRIMARY KEY ("codemp","codfil","numctr","datcpt","seqcvs","seqcvp","ultrea")
);
-- Domínio LGerIte (G/I), com o vazio-sentinela que o dado real usa nas linhas de upgrade.
ALTER TABLE "contratos_venda_reajustes" ADD CONSTRAINT "chk_contratos_venda_reajustes_tiprea" CHECK ("tiprea" IS NULL OR trim("tiprea") = '' OR "tiprea" IN ('G', 'I'));
