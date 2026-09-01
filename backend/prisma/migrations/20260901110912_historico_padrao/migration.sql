-- AlterTable
-- codhpd nasce NULL em toda linha pré-existente (nunca sincronizado antes) e só é preenchido
-- pelo próximo sync de lancamentos_contabeis — o helper de formatação de Histórico
-- (domain/historicoPadrao.ts) já trata codhpd null como "sem template, mostra cpllct cru",
-- então não há regressão até o sync rodar de novo.
ALTER TABLE "lancamentos_contabeis" ADD COLUMN     "codhpd" INTEGER;

-- CreateTable
-- SEM codemp: E046HPD é catálogo GLOBAL do Senior (PK só CodHpd, confirmado ao vivo contra o
-- dicionário de dados) — diferente da maioria das tabelas espelhadas neste projeto.
CREATE TABLE "historicos_padrao" (
    "codhpd" INTEGER NOT NULL,
    "tithpd" VARCHAR(80),
    "deshpd" VARCHAR(80) NOT NULL,
    "tiphpd" VARCHAR(1) NOT NULL,
    "intagr" VARCHAR(1),

    CONSTRAINT "historicos_padrao_pkey" PRIMARY KEY ("codhpd")
);
