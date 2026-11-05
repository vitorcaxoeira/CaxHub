-- Gestão de Descontos (05/11/2026): tipos, processos, parcelas e fechamento mensal dos descontos abatidos da nota dos consultores.

-- CreateTable
CREATE TABLE "descontos_tipos" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "descricao" VARCHAR(250),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "permite_parcelamento" BOOLEAN NOT NULL DEFAULT true,
    "max_parcelas" INTEGER,
    "valor_minimo" DECIMAL(15,2),
    "valor_maximo" DECIMAL(15,2),
    "exige_observacao" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_por_id" INTEGER,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "descontos_tipos_pkey" PRIMARY KEY ("id")
);

-- Nome do tipo único sem distinguir maiúsculas (o Prisma não declara índice por expressão: fica só aqui).
CREATE UNIQUE INDEX "descontos_tipos_nome_lower_key" ON "descontos_tipos" (lower("nome"));

-- CreateTable
CREATE TABLE "descontos_sequencias" (
    "ano" INTEGER NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "descontos_sequencias_pkey" PRIMARY KEY ("ano")
);

-- CreateTable
CREATE TABLE "descontos_processos" (
    "id" SERIAL NOT NULL,
    "ano" INTEGER NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "tipo_id" INTEGER NOT NULL,
    "modo" VARCHAR(20) NOT NULL,
    "valor_total" DECIMAL(15,2) NOT NULL,
    "valor_parcela" DECIMAL(15,2) NOT NULL,
    "qtd_parcelas" INTEGER NOT NULL,
    "vigencia_inicio" DATE NOT NULL,
    "vigencia_fim" DATE NOT NULL,
    "competencia_inicial" DATE NOT NULL,
    "dia_vencimento" INTEGER NOT NULL,
    "observacao" VARCHAR(500),
    "status" VARCHAR(30) NOT NULL DEFAULT 'ativo',
    "criado_por_id" INTEGER,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "descontos_processos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "descontos_parcelas" (
    "id" SERIAL NOT NULL,
    "processo_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "competencia" DATE NOT NULL,
    "vencimento" DATE NOT NULL,
    "valor" DECIMAL(15,2) NOT NULL,
    "valor_descontado" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "situacao" VARCHAR(30) NOT NULL DEFAULT 'pendente',
    "origem_parcela_id" INTEGER,
    "observacao" VARCHAR(500),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "descontos_parcelas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "descontos_fechamentos" (
    "competencia" DATE NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "valor_nota" DECIMAL(15,2) NOT NULL,
    "total_previsto" DECIMAL(15,2) NOT NULL,
    "total_descontado" DECIMAL(15,2) NOT NULL,
    "saldo_transportado" DECIMAL(15,2) NOT NULL,
    "origem" VARCHAR(10) NOT NULL,
    "fechado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechado_por_id" INTEGER,

    CONSTRAINT "descontos_fechamentos_pkey" PRIMARY KEY ("competencia","codemp","codfor")
);

-- CreateIndex
CREATE UNIQUE INDEX "descontos_processos_numero_key" ON "descontos_processos"("ano", "sequencia");

-- CreateIndex
CREATE INDEX "descontos_processos_consultor_idx" ON "descontos_processos"("codemp", "codfor");

-- CreateIndex
CREATE INDEX "descontos_processos_tipo_idx" ON "descontos_processos"("tipo_id");

-- CreateIndex
CREATE INDEX "descontos_processos_status_idx" ON "descontos_processos"("status");

-- CreateIndex
CREATE INDEX "descontos_parcelas_processo_idx" ON "descontos_parcelas"("processo_id", "numero");

-- CreateIndex
CREATE INDEX "descontos_parcelas_competencia_idx" ON "descontos_parcelas"("competencia", "situacao");

-- AddForeignKey
ALTER TABLE "descontos_processos" ADD CONSTRAINT "descontos_processos_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "descontos_tipos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descontos_parcelas" ADD CONSTRAINT "descontos_parcelas_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "descontos_processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
