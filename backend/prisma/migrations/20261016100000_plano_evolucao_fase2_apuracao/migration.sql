-- Plano de Evolução, Fase 2: índice global fechado por ciclo e apuração (lançamentos, resultado congelado, devolutiva e contestação).
-- Só tabelas novas. As chaves para plano_ciclos e plano_participantes são RESTRICT de propósito: apuração é histórico e não se perde por exclusão em cascata.

CREATE TABLE "plano_ciclo_resultado_global" (
    "id" SERIAL NOT NULL,
    "cicloId" INTEGER NOT NULL,
    "executadoMin" INTEGER NOT NULL,
    "dentroMin" INTEGER NOT NULL,
    "acimaMin" INTEGER NOT NULL,
    "itens" INTEGER NOT NULL,
    "indice" DECIMAL(6,2),
    "meta" DECIMAL(5,2) NOT NULL,
    "atingiu" BOOLEAN,
    "semBase" BOOLEAN NOT NULL DEFAULT false,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculadoPor" INTEGER NOT NULL,

    CONSTRAINT "plano_ciclo_resultado_global_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plano_ciclo_resultado_global_cicloId_key" ON "plano_ciclo_resultado_global"("cicloId");
ALTER TABLE "plano_ciclo_resultado_global" ADD CONSTRAINT "plano_ciclo_resultado_global_cicloId_fkey" FOREIGN KEY ("cicloId") REFERENCES "plano_ciclos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "plano_apuracoes" (
    "id" SERIAL NOT NULL,
    "cicloId" INTEGER NOT NULL,
    "participanteId" INTEGER NOT NULL,
    "ensaio" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(12) NOT NULL DEFAULT 'rascunho',
    "contratoAtivoNoCiclo" BOOLEAN NOT NULL DEFAULT true,
    "cicloCompleto" BOOLEAN NOT NULL DEFAULT true,
    "interrupcaoDias" INTEGER NOT NULL DEFAULT 0,
    "competenciasPct" DECIMAL(5,2),
    "certificacoesCumpriu" BOOLEAN,
    "clientesMedia" DECIMAL(4,2),
    "clientesRespostas" INTEGER,
    "caseCumpriu" BOOLEAN,
    "eficienciaIndividualDecisao" BOOLEAN,
    "manuais" JSONB NOT NULL DEFAULT '[]',
    "observacoes" JSONB NOT NULL DEFAULT '{}',
    "lancadoPor" INTEGER,
    "lancadoEm" TIMESTAMP(3),
    "apuradoEm" TIMESTAMP(3),
    "apuradoPor" INTEGER,
    "snapshot" JSONB,
    "statusCiclo" VARCHAR(12),
    "pontuacaoBp" INTEGER,
    "reforcadorBp" INTEGER,
    "percentualBp" INTEGER,
    "baseCentavos" INTEGER,
    "valorHoraCentavos" INTEGER,
    "consecutivosAntes" INTEGER,
    "consecutivosDepois" INTEGER,
    "efetivou" BOOLEAN NOT NULL DEFAULT false,
    "globalAtingido" BOOLEAN,
    "motivos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revisoes" JSONB NOT NULL DEFAULT '[]',
    "devolutivaEm" DATE,
    "devolutivaPor" INTEGER,
    "devolutivaObs" VARCHAR(1000),
    "contestacaoRecebidaEm" DATE,
    "contestacaoTexto" VARCHAR(2000),
    "contestacaoRegistradaPor" INTEGER,
    "desfecho" VARCHAR(12),
    "desfechoTexto" VARCHAR(1000),
    "desfechoEm" TIMESTAMP(3),
    "desfechoPor" INTEGER,
    "encerradoEm" TIMESTAMP(3),
    "encerradoPor" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plano_apuracoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plano_apuracoes_cicloId_participanteId_key" ON "plano_apuracoes"("cicloId", "participanteId");
CREATE INDEX "plano_apuracoes_status_idx" ON "plano_apuracoes"("status");
ALTER TABLE "plano_apuracoes" ADD CONSTRAINT "plano_apuracoes_cicloId_fkey" FOREIGN KEY ("cicloId") REFERENCES "plano_ciclos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plano_apuracoes" ADD CONSTRAINT "plano_apuracoes_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "plano_participantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
