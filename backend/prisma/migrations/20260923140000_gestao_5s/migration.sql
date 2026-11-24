-- Módulo Gestão 5S — áreas/ambientes, perguntas, participantes, avaliações, observações da equipe e imagens.
-- CreateTable
CREATE TABLE "areas_5s" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "setorVinculadoId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_5s_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perguntas_5s" (
    "id" SERIAL NOT NULL,
    "tipoArea" VARCHAR(10) NOT NULL,
    "areaId" INTEGER,
    "senso" VARCHAR(12) NOT NULL,
    "texto" VARCHAR(600) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perguntas_5s_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participantes_5s" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "papel" VARCHAR(15) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participantes_5s_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participantes_5s_areas" (
    "participanteId" INTEGER NOT NULL,
    "areaId" INTEGER NOT NULL,

    CONSTRAINT "participantes_5s_areas_pkey" PRIMARY KEY ("participanteId","areaId")
);

-- CreateTable
CREATE TABLE "avaliacoes_5s" (
    "id" SERIAL NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "areaId" INTEGER NOT NULL,
    "avaliadorId" INTEGER,
    "data" DATE NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'em_andamento',
    "percGeral" DECIMAL(5,2),
    "percSeiri" DECIMAL(5,2),
    "percSeiton" DECIMAL(5,2),
    "percSeiso" DECIMAL(5,2),
    "percSeiketsu" DECIMAL(5,2),
    "percShitsuke" DECIMAL(5,2),
    "finalizadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avaliacoes_5s_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avaliacoes_5s_respostas" (
    "id" SERIAL NOT NULL,
    "avaliacaoId" INTEGER NOT NULL,
    "perguntaId" INTEGER,
    "senso" VARCHAR(12) NOT NULL,
    "perguntaTexto" VARCHAR(600) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "nota" INTEGER,
    "naoSeAplica" BOOLEAN NOT NULL DEFAULT false,
    "inconsistencia" TEXT,
    "complemento" TEXT,

    CONSTRAINT "avaliacoes_5s_respostas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avaliacoes_5s_sensos" (
    "id" SERIAL NOT NULL,
    "avaliacaoId" INTEGER NOT NULL,
    "senso" VARCHAR(12) NOT NULL,
    "observacoes" TEXT,
    "melhorias" TEXT,
    "pontosAtencao" TEXT,
    "informacoes" TEXT,

    CONSTRAINT "avaliacoes_5s_sensos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observacoes_equipe_5s" (
    "id" SERIAL NOT NULL,
    "areaId" INTEGER NOT NULL,
    "autorId" INTEGER,
    "dataOcorrido" DATE NOT NULL,
    "texto" TEXT NOT NULL,
    "avaliacaoId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observacoes_equipe_5s_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imagens_5s" (
    "id" SERIAL NOT NULL,
    "respostaId" INTEGER,
    "avaliacaoSensoId" INTEGER,
    "observacaoId" INTEGER,
    "userId" INTEGER,
    "nomeArquivo" VARCHAR(255) NOT NULL,
    "caminhoArquivo" VARCHAR(500) NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imagens_5s_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "areas_5s_tipo_idx" ON "areas_5s"("tipo");

-- CreateIndex
CREATE INDEX "perguntas_5s_tipoArea_senso_idx" ON "perguntas_5s"("tipoArea", "senso");

-- CreateIndex
CREATE INDEX "perguntas_5s_areaId_idx" ON "perguntas_5s"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "participantes_5s_userId_key" ON "participantes_5s"("userId");

-- CreateIndex
CREATE INDEX "avaliacoes_5s_areaId_data_idx" ON "avaliacoes_5s"("areaId", "data");

-- CreateIndex
CREATE INDEX "avaliacoes_5s_status_idx" ON "avaliacoes_5s"("status");

-- CreateIndex
CREATE INDEX "avaliacoes_5s_respostas_avaliacaoId_idx" ON "avaliacoes_5s_respostas"("avaliacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "avaliacoes_5s_respostas_avaliacaoId_perguntaId_key" ON "avaliacoes_5s_respostas"("avaliacaoId", "perguntaId");

-- CreateIndex
CREATE UNIQUE INDEX "avaliacoes_5s_sensos_avaliacaoId_senso_key" ON "avaliacoes_5s_sensos"("avaliacaoId", "senso");

-- CreateIndex
CREATE INDEX "observacoes_equipe_5s_areaId_dataOcorrido_idx" ON "observacoes_equipe_5s"("areaId", "dataOcorrido");

-- CreateIndex
CREATE INDEX "imagens_5s_respostaId_idx" ON "imagens_5s"("respostaId");

-- CreateIndex
CREATE INDEX "imagens_5s_avaliacaoSensoId_idx" ON "imagens_5s"("avaliacaoSensoId");

-- CreateIndex
CREATE INDEX "imagens_5s_observacaoId_idx" ON "imagens_5s"("observacaoId");

-- AddForeignKey
ALTER TABLE "areas_5s" ADD CONSTRAINT "areas_5s_setorVinculadoId_fkey" FOREIGN KEY ("setorVinculadoId") REFERENCES "areas_5s"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perguntas_5s" ADD CONSTRAINT "perguntas_5s_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas_5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participantes_5s" ADD CONSTRAINT "participantes_5s_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participantes_5s_areas" ADD CONSTRAINT "participantes_5s_areas_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "participantes_5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participantes_5s_areas" ADD CONSTRAINT "participantes_5s_areas_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas_5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_5s" ADD CONSTRAINT "avaliacoes_5s_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas_5s"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_5s" ADD CONSTRAINT "avaliacoes_5s_avaliadorId_fkey" FOREIGN KEY ("avaliadorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_5s_respostas" ADD CONSTRAINT "avaliacoes_5s_respostas_avaliacaoId_fkey" FOREIGN KEY ("avaliacaoId") REFERENCES "avaliacoes_5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_5s_respostas" ADD CONSTRAINT "avaliacoes_5s_respostas_perguntaId_fkey" FOREIGN KEY ("perguntaId") REFERENCES "perguntas_5s"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_5s_sensos" ADD CONSTRAINT "avaliacoes_5s_sensos_avaliacaoId_fkey" FOREIGN KEY ("avaliacaoId") REFERENCES "avaliacoes_5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observacoes_equipe_5s" ADD CONSTRAINT "observacoes_equipe_5s_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas_5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observacoes_equipe_5s" ADD CONSTRAINT "observacoes_equipe_5s_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observacoes_equipe_5s" ADD CONSTRAINT "observacoes_equipe_5s_avaliacaoId_fkey" FOREIGN KEY ("avaliacaoId") REFERENCES "avaliacoes_5s"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imagens_5s" ADD CONSTRAINT "imagens_5s_respostaId_fkey" FOREIGN KEY ("respostaId") REFERENCES "avaliacoes_5s_respostas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imagens_5s" ADD CONSTRAINT "imagens_5s_avaliacaoSensoId_fkey" FOREIGN KEY ("avaliacaoSensoId") REFERENCES "avaliacoes_5s_sensos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imagens_5s" ADD CONSTRAINT "imagens_5s_observacaoId_fkey" FOREIGN KEY ("observacaoId") REFERENCES "observacoes_equipe_5s"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imagens_5s" ADD CONSTRAINT "imagens_5s_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

