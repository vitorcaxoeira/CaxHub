-- Módulo Gestão de Solicitações — Solicitações de Viagem (hospedagem, aéreo, carro).
-- AlterTable
ALTER TABLE "notificacoes" ADD COLUMN     "solicitacaoViagemId" INTEGER;

-- CreateTable
CREATE TABLE "solicitacoes_viagem" (
    "id" SERIAL NOT NULL,
    "solicitanteId" INTEGER,
    "finalidade" VARCHAR(20) NOT NULL,
    "motivo" VARCHAR(1000) NOT NULL,
    "codcli" INTEGER,
    "codemp" INTEGER,
    "codpro" INTEGER,
    "qtdPessoas" INTEGER NOT NULL DEFAULT 1,
    "dataInicio" DATE NOT NULL,
    "dataFim" DATE NOT NULL,
    "cidadesDestino" VARCHAR(500) NOT NULL,
    "roteiroObservacao" TEXT,
    "observacoes" TEXT,
    "precisaHospedagem" BOOLEAN NOT NULL DEFAULT false,
    "precisaAereo" BOOLEAN NOT NULL DEFAULT false,
    "precisaCarro" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(30) NOT NULL DEFAULT 'solicitada',
    "responsavelAtendimentoId" INTEGER,
    "aprovacaoCodemp" INTEGER,
    "aprovacaoDepexe" INTEGER,
    "valorAprovado" DECIMAL(12,2),
    "aprovadoPorId" INTEGER,
    "aprovadoEm" TIMESTAMP(3),
    "observacaoDecisao" VARCHAR(1000),
    "motivoCancelamento" VARCHAR(1000),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitacoes_viagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes_viagem_viajantes" (
    "id" SERIAL NOT NULL,
    "solicitacaoId" INTEGER NOT NULL,
    "userId" INTEGER,
    "nome" VARCHAR(150) NOT NULL,
    "cpf" VARCHAR(11) NOT NULL,

    CONSTRAINT "solicitacoes_viagem_viajantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes_viagem_itens" (
    "id" SERIAL NOT NULL,
    "solicitacaoId" INTEGER NOT NULL,
    "tipo" VARCHAR(15) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "cidade" VARCHAR(150),
    "origem" VARCHAR(150),
    "destino" VARCHAR(150),
    "dataInicio" DATE,
    "dataFim" DATE,
    "horaInicio" VARCHAR(5),
    "horaFim" VARCHAR(5),
    "tipoAcomodacao" VARCHAR(15),
    "hotelPreferencia" VARCHAR(200),
    "necessidades" VARCHAR(500),
    "flexibilidadeHorario" VARCHAR(200),
    "bagagem" VARCHAR(200),
    "companhiaPreferencia" VARCHAR(100),
    "localRetirada" VARCHAR(200),
    "localDevolucao" VARCHAR(200),
    "categoriaVeiculo" VARCHAR(100),
    "observacoes" VARCHAR(1000),
    "fornecedor" VARCHAR(150),
    "localizador" VARCHAR(100),
    "valorReservado" DECIMAL(12,2),
    "reservadoEm" TIMESTAMP(3),

    CONSTRAINT "solicitacoes_viagem_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes_viagem_itens_viajantes" (
    "itemId" INTEGER NOT NULL,
    "viajanteId" INTEGER NOT NULL,

    CONSTRAINT "solicitacoes_viagem_itens_viajantes_pkey" PRIMARY KEY ("itemId","viajanteId")
);

-- CreateTable
CREATE TABLE "solicitacoes_viagem_cotacoes" (
    "id" SERIAL NOT NULL,
    "solicitacaoId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "fornecedor" VARCHAR(150) NOT NULL,
    "descricao" VARCHAR(500),
    "valor" DECIMAL(12,2) NOT NULL,
    "validadeAte" DATE,
    "selecionada" BOOLEAN NOT NULL DEFAULT false,
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitacoes_viagem_cotacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes_viagem_anexos" (
    "id" SERIAL NOT NULL,
    "solicitacaoId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "cotacaoId" INTEGER,
    "userId" INTEGER,
    "categoria" VARCHAR(15) NOT NULL DEFAULT 'outro',
    "nomeArquivo" VARCHAR(255) NOT NULL,
    "caminhoArquivo" VARCHAR(500) NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitacoes_viagem_anexos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitacoes_viagem_status_idx" ON "solicitacoes_viagem"("status");

-- CreateIndex
CREATE INDEX "solicitacoes_viagem_solicitanteId_idx" ON "solicitacoes_viagem"("solicitanteId");

-- CreateIndex
CREATE INDEX "solicitacoes_viagem_codemp_codpro_idx" ON "solicitacoes_viagem"("codemp", "codpro");

-- CreateIndex
CREATE INDEX "solicitacoes_viagem_codcli_idx" ON "solicitacoes_viagem"("codcli");

-- CreateIndex
CREATE INDEX "solicitacoes_viagem_viajantes_solicitacaoId_idx" ON "solicitacoes_viagem_viajantes"("solicitacaoId");

-- CreateIndex
CREATE INDEX "solicitacoes_viagem_itens_solicitacaoId_idx" ON "solicitacoes_viagem_itens"("solicitacaoId");

-- CreateIndex
CREATE INDEX "solicitacoes_viagem_cotacoes_solicitacaoId_idx" ON "solicitacoes_viagem_cotacoes"("solicitacaoId");

-- CreateIndex
CREATE INDEX "solicitacoes_viagem_anexos_solicitacaoId_idx" ON "solicitacoes_viagem_anexos"("solicitacaoId");

-- AddForeignKey

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_solicitacaoViagemId_fkey" FOREIGN KEY ("solicitacaoViagemId") REFERENCES "solicitacoes_viagem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem" ADD CONSTRAINT "solicitacoes_viagem_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem" ADD CONSTRAINT "solicitacoes_viagem_responsavelAtendimentoId_fkey" FOREIGN KEY ("responsavelAtendimentoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem" ADD CONSTRAINT "solicitacoes_viagem_aprovadoPorId_fkey" FOREIGN KEY ("aprovadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem" ADD CONSTRAINT "solicitacoes_viagem_codcli_fkey" FOREIGN KEY ("codcli") REFERENCES "clientes"("codcli") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_viajantes" ADD CONSTRAINT "solicitacoes_viagem_viajantes_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacoes_viagem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_viajantes" ADD CONSTRAINT "solicitacoes_viagem_viajantes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_itens" ADD CONSTRAINT "solicitacoes_viagem_itens_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacoes_viagem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_itens_viajantes" ADD CONSTRAINT "solicitacoes_viagem_itens_viajantes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "solicitacoes_viagem_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_itens_viajantes" ADD CONSTRAINT "solicitacoes_viagem_itens_viajantes_viajanteId_fkey" FOREIGN KEY ("viajanteId") REFERENCES "solicitacoes_viagem_viajantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_cotacoes" ADD CONSTRAINT "solicitacoes_viagem_cotacoes_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacoes_viagem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_cotacoes" ADD CONSTRAINT "solicitacoes_viagem_cotacoes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "solicitacoes_viagem_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_cotacoes" ADD CONSTRAINT "solicitacoes_viagem_cotacoes_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_anexos" ADD CONSTRAINT "solicitacoes_viagem_anexos_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacoes_viagem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_anexos" ADD CONSTRAINT "solicitacoes_viagem_anexos_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "solicitacoes_viagem_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_anexos" ADD CONSTRAINT "solicitacoes_viagem_anexos_cotacaoId_fkey" FOREIGN KEY ("cotacaoId") REFERENCES "solicitacoes_viagem_cotacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_viagem_anexos" ADD CONSTRAINT "solicitacoes_viagem_anexos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

