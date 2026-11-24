-- Plano de Evolução Profissional e Eficiência (consultores PJ), Fase 1: ciclos, indicadores, participantes e histórico de Valor Hora Base.
-- Só tabelas novas; nada existente é reescrito. Escrita à mão (o Prisma não tem shadow DB neste ambiente).

CREATE TABLE "plano_ciclos" (
    "id" SERIAL NOT NULL,
    "ano" INTEGER NOT NULL,
    "semestre" INTEGER NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'rascunho',
    "metaEficienciaGlobal" DECIMAL(5,2),
    "metaApontamentoOnline" DECIMAL(5,2),
    "departamentosArea" INTEGER[] DEFAULT ARRAY[8, 9]::INTEGER[],
    "amostraMinimaHoras" INTEGER NOT NULL DEFAULT 10,
    "definicaoOnline" VARCHAR(1) NOT NULL DEFAULT 'A',
    "notaMinimaEficienciaIndividual" INTEGER NOT NULL DEFAULT 100,
    "naoApuradoQuebraSequencia" BOOLEAN NOT NULL DEFAULT false,
    "certificacoesExigidas" VARCHAR(1000),
    "atividadesElegiveisClientes" VARCHAR(1000),
    "corteEvidencias" DATE NOT NULL,
    "apuracaoAte" DATE NOT NULL,
    "devolutivaEm" DATE NOT NULL,
    "contestacaoAte" DATE NOT NULL,
    "publicadoEm" TIMESTAMP(3),
    "publicadoPor" INTEGER,
    "criadoPor" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" INTEGER,

    CONSTRAINT "plano_ciclos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plano_ciclos_ano_semestre_key" ON "plano_ciclos"("ano", "semestre");

CREATE TABLE "plano_ciclo_indicadores" (
    "id" SERIAL NOT NULL,
    "cicloId" INTEGER NOT NULL,
    "chave" VARCHAR(40) NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "peso" INTEGER NOT NULL DEFAULT 0,
    "meta" DECIMAL(5,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plano_ciclo_indicadores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plano_ciclo_indicadores_cicloId_chave_key" ON "plano_ciclo_indicadores"("cicloId", "chave");
ALTER TABLE "plano_ciclo_indicadores" ADD CONSTRAINT "plano_ciclo_indicadores_cicloId_fkey" FOREIGN KEY ("cicloId") REFERENCES "plano_ciclos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "plano_participantes" (
    "id" SERIAL NOT NULL,
    "codfor" INTEGER NOT NULL,
    "dataAdesao" DATE NOT NULL,
    "versaoRegulamento" VARCHAR(10) NOT NULL DEFAULT '3.1',
    "primeiroCicloInicio" DATE NOT NULL,
    "ciclosConsecutivosAntes" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ativo',
    "encerradoEm" TIMESTAMP(3),
    "motivoEncerramento" VARCHAR(300),
    "criadoPor" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plano_participantes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plano_participantes_codfor_key" ON "plano_participantes"("codfor");

CREATE TABLE "plano_valores_base" (
    "id" SERIAL NOT NULL,
    "participanteId" INTEGER NOT NULL,
    "valorHoraBase" DECIMAL(11,2) NOT NULL,
    "desde" DATE NOT NULL,
    "motivo" VARCHAR(12) NOT NULL,
    "observacao" VARCHAR(300),
    "criadoPor" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plano_valores_base_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plano_valores_base_participanteId_desde_idx" ON "plano_valores_base"("participanteId", "desde");
ALTER TABLE "plano_valores_base" ADD CONSTRAINT "plano_valores_base_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "plano_participantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
