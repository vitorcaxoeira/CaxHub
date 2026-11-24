-- Rentabilidade (17/11/2026): indicadores configuráveis por tela no lugar das listas fixas de contas do BI.
-- Tabelas nativas do CaxHub, nascem VAZIAS de propósito: nenhuma conta, código de evento ou fórmula é
-- semeado por migration (regra do Vitor). A configuração do BI entra pela tela, por "Importar JSON".

-- CreateTable
CREATE TABLE "rentabilidade_indicadores" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "rotulo" VARCHAR(80) NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "base" VARCHAR(10) NOT NULL DEFAULT 'realizado',
    "natureza" VARCHAR(10) NOT NULL DEFAULT 'ambos',
    "formato" VARCHAR(10) NOT NULL DEFAULT 'moeda',
    "formula_texto" VARCHAR(500),
    "formula_arvore" JSONB,
    "fonte" VARCHAR(30),
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "visivel" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rentabilidade_indicadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentabilidade_indicador_contas" (
    "indicador_id" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "ctared" INTEGER NOT NULL,
    "acao" VARCHAR(8) NOT NULL,

    CONSTRAINT "rentabilidade_indicador_contas_pkey" PRIMARY KEY ("indicador_id","codemp","ctared")
);

-- CreateIndex
CREATE UNIQUE INDEX "rentabilidade_indicadores_codigo_key" ON "rentabilidade_indicadores"("codigo");

-- AddForeignKey
ALTER TABLE "rentabilidade_indicador_contas" ADD CONSTRAINT "rentabilidade_indicador_contas_indicador_id_fkey" FOREIGN KEY ("indicador_id") REFERENCES "rentabilidade_indicadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
