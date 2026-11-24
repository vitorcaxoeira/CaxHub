-- Mensalidade da Gestão de Metas do Comercial passa a vir da carteira de contratos do Senior (relatório RVTR101: contratos ativos,
-- número 1 a 1999, motivo 500 "Contratos Vendas Mensalidade"; valor do item = PreUni / DiaPar × QtdCvs).
-- 1) Espelhos de E160CTR (contratos) e E160CVS (itens de serviço dos contratos), sync completa diária.
-- 2) metas_comercial_carteira: foto mensal da carteira (a última do mês é o realizado daquele mês).
-- 3) Indicador MENSALIDADE muda para a origem CARTEIRA_SENIOR e perde o realizado digitado (o 948.672,34 importado da planilha).

-- CreateTable
CREATE TABLE "metas_comercial_carteira" (
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "valor" DECIMAL(16,2) NOT NULL,
    "contratos" INTEGER NOT NULL,
    "itens" INTEGER NOT NULL,
    "capturadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metas_comercial_carteira_pkey" PRIMARY KEY ("ano","mes")
);

-- CreateTable
CREATE TABLE "contratos_venda" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numctr" INTEGER NOT NULL,
    "codcli" INTEGER NOT NULL,
    "clifat" INTEGER NOT NULL,
    "codrep" INTEGER,
    "sitctr" VARCHAR(1) NOT NULL,
    "codmot" INTEGER,
    "diapar" INTEGER NOT NULL,
    "datemi" DATE NOT NULL,
    "inivig" DATE,
    "fimvig" DATE,
    "ultrea" DATE,
    "datger" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "contratos_venda_pkey" PRIMARY KEY ("codemp","codfil","numctr")
);

-- CreateTable
CREATE TABLE "contratos_venda_servicos" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numctr" INTEGER NOT NULL,
    "datcpt" DATE NOT NULL,
    "seqcvs" INTEGER NOT NULL,
    "codser" VARCHAR(14),
    "cplcvs" VARCHAR(250) NOT NULL,
    "qtdcvs" DECIMAL(14,5) NOT NULL,
    "preuni" DECIMAL(21,10) NOT NULL,
    "sitcvs" VARCHAR(1) NOT NULL,
    "inirea" DATE,
    "ultrea" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "contratos_venda_servicos_pkey" PRIMARY KEY ("codemp","codfil","numctr","datcpt","seqcvs")
);

-- Domínio LSitReg (A/I), conferido no dado real de produção em 19/10/2026.
ALTER TABLE "contratos_venda" ADD CONSTRAINT "chk_contratos_venda_sitctr" CHECK ("sitctr" IN ('A', 'I'));
ALTER TABLE "contratos_venda_servicos" ADD CONSTRAINT "chk_contratos_venda_servicos_sitcvs" CHECK ("sitcvs" IN ('A', 'I'));
ALTER TABLE "metas_comercial_carteira" ADD CONSTRAINT "metas_comercial_carteira_mes_check" CHECK ("mes" BETWEEN 1 AND 12);

-- Origem nova do indicador.
ALTER TABLE "metas_comercial_indicadores" DROP CONSTRAINT "metas_comercial_indicadores_origem_check";
ALTER TABLE "metas_comercial_indicadores" ADD CONSTRAINT "metas_comercial_indicadores_origem_check"
  CHECK ("origem" IN ('MANUAL', 'FATURAMENTO_SENIOR', 'CARTEIRA_SENIOR'));

UPDATE "metas_comercial_indicadores" SET "origem" = 'CARTEIRA_SENIOR' WHERE "codigo" = 'MENSALIDADE';

-- O realizado da Mensalidade agora é do Senior: some o digitado; linha que ficar sem meta some inteira.
UPDATE "metas_comercial_lancamentos" SET "realizado" = NULL
 WHERE "indicadorId" = (SELECT "id" FROM "metas_comercial_indicadores" WHERE "codigo" = 'MENSALIDADE');
DELETE FROM "metas_comercial_lancamentos"
 WHERE "indicadorId" = (SELECT "id" FROM "metas_comercial_indicadores" WHERE "codigo" = 'MENSALIDADE')
   AND "meta" IS NULL;
-- A linha "Não atribuído" só existia para guardar o realizado digitado da carteira.
DELETE FROM "metas_comercial_participante_indicadores"
 WHERE "indicadorId" = (SELECT "id" FROM "metas_comercial_indicadores" WHERE "codigo" = 'MENSALIDADE')
   AND "participanteId" IN (SELECT "id" FROM "metas_comercial_participantes" WHERE "naoAtribuido");
