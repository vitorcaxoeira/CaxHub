-- Controle de férias dos consultores PJ e calendário de trabalho (13/11/2026): períodos aquisitivos (o direito), gozos (as férias) e ausências lançadas
-- pelo consultor no calendário (dia inteiro ou parcial). Ver comentários dos models em schema.prisma.

CREATE TABLE "ferias_periodos_aquisitivos" (
    "id" SERIAL NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "dias_direito" INTEGER NOT NULL,
    "observacao" VARCHAR(300),
    "criado_por" INTEGER,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ferias_periodos_aquisitivos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ferias_gozos" (
    "id" SERIAL NOT NULL,
    "aquisitivo_id" INTEGER NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "dias_corridos" INTEGER NOT NULL,
    "situacao" VARCHAR(12) NOT NULL DEFAULT 'programada',
    "observacao" VARCHAR(300),
    "competencia_pagamento" DATE,
    "dias_uteis" INTEGER,
    "horas_dia" DECIMAL(5,2),
    "media_pct" DECIMAL(8,4),
    "valor_hora" DECIMAL(15,5),
    "horas_ferias" DECIMAL(9,2),
    "valor_ferias" DECIMAL(15,2),
    "calculado_em" TIMESTAMPTZ(6),
    "criado_por" INTEGER,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ferias_gozos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendario_ausencias" (
    "id" SERIAL NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "dia_inteiro" BOOLEAN NOT NULL DEFAULT true,
    "inicio_min" INTEGER,
    "fim_min" INTEGER,
    "motivo" VARCHAR(200),
    "desconta_ferias" BOOLEAN NOT NULL DEFAULT false,
    "aquisitivo_id" INTEGER,
    "criado_por" INTEGER,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluida_em" TIMESTAMPTZ(6),

    CONSTRAINT "calendario_ausencias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ferias_periodos_aquisitivos_codemp_codfor_idx" ON "ferias_periodos_aquisitivos"("codemp", "codfor");
CREATE INDEX "ferias_gozos_aquisitivo_id_idx" ON "ferias_gozos"("aquisitivo_id");
CREATE INDEX "ferias_gozos_inicio_fim_idx" ON "ferias_gozos"("inicio", "fim");
CREATE INDEX "calendario_ausencias_codemp_codfor_data_idx" ON "calendario_ausencias"("codemp", "codfor", "data");

ALTER TABLE "ferias_gozos" ADD CONSTRAINT "ferias_gozos_aquisitivo_id_fkey" FOREIGN KEY ("aquisitivo_id") REFERENCES "ferias_periodos_aquisitivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendario_ausencias" ADD CONSTRAINT "calendario_ausencias_aquisitivo_id_fkey" FOREIGN KEY ("aquisitivo_id") REFERENCES "ferias_periodos_aquisitivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
