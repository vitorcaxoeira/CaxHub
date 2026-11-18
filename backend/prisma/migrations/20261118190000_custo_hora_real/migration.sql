-- Custo-hora real do consultor (18/11/2026): classificacao dos eventos da folha, encargos percentuais com vigencia, parametros do calculo,
-- valor-hora manual com vigencia e o resultado mensal do job (consultor_custo_hora). Tudo nasce VAZIO: regra de negocio por tela, nunca no codigo.

-- CreateTable
CREATE TABLE "custo_evento_classes" (
    "tabeve" INTEGER NOT NULL,
    "codeve" INTEGER NOT NULL,
    "classe" VARCHAR(20) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,
    "atualizado_por" INTEGER,

    CONSTRAINT "custo_evento_classes_pkey" PRIMARY KEY ("tabeve","codeve")
);

-- CreateTable
CREATE TABLE "custo_encargos" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "rotulo" VARCHAR(120) NOT NULL,
    "percentual" DECIMAL(9,4) NOT NULL,
    "vigencia_inicio" DATE NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custo_encargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custo_parametros" (
    "chave" VARCHAR(40) NOT NULL,
    "valor" VARCHAR(200) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custo_parametros_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "consultor_valor_hora_manual" (
    "id" SERIAL NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codusu" INTEGER NOT NULL,
    "vigencia_inicio" DATE NOT NULL,
    "valor" DECIMAL(15,4) NOT NULL,
    "observacao" VARCHAR(500),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_por" INTEGER,

    CONSTRAINT "consultor_valor_hora_manual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultor_custo_hora" (
    "codemp" INTEGER NOT NULL,
    "codusu" INTEGER NOT NULL,
    "competencia" DATE NOT NULL,
    "origem" VARCHAR(12) NOT NULL,
    "custo_hora" DECIMAL(15,4) NOT NULL,
    "detalhe" JSONB,
    "calculado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultor_custo_hora_pkey" PRIMARY KEY ("codemp","codusu","competencia")
);

-- CreateIndex
CREATE UNIQUE INDEX "custo_encargos_codigo_vigencia_key" ON "custo_encargos"("codigo", "vigencia_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "consultor_valor_hora_manual_key" ON "consultor_valor_hora_manual"("codemp", "codusu", "vigencia_inicio");

-- CreateIndex
CREATE INDEX "consultor_custo_hora_competencia_idx" ON "consultor_custo_hora"("competencia");

-- AddForeignKey
ALTER TABLE "consultor_valor_hora_manual" ADD CONSTRAINT "consultor_valor_hora_manual_codemp_codusu_fkey" FOREIGN KEY ("codemp", "codusu") REFERENCES "consultores"("codemp", "codusu") ON DELETE CASCADE ON UPDATE CASCADE;
