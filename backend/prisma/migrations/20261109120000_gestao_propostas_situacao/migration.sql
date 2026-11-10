-- Gestão Propostas (09/11/2026): fila de saída das mudanças de SITUAÇÃO de proposta (Finalizar / Em Execução) e o índice que a tela precisa.
--
-- 1) sincronizacao_pendente_proposta: fila IRMÃ de sincronizacao_pendente e sincronizacao_pendente_despesa. A chave é a proposta (codemp+codpro),
--    não uma atividade — uma proposta sem alocação nenhuma ficaria infinalizável com a âncora técnica da outra fila.
-- 2) rats(codemp, codpro): o agregado de RAT por proposta e a lista de RATs de uma proposta filtram por esse par, que não tinha índice
--    (medido 95 ms para 25 linhas no cálculo por linha, em 09/11/2026).

-- CreateTable
CREATE TABLE "sincronizacao_pendente_proposta" (
    "id" SERIAL NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "sitproDe" INTEGER,
    "sitproPara" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "usuarioId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "sincronizacao_pendente_proposta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sincronizacao_pendente_proposta_codemp_codpro_status_idx" ON "sincronizacao_pendente_proposta"("codemp", "codpro", "status");

-- CreateIndex
CREATE INDEX "sincronizacao_pendente_proposta_status_idx" ON "sincronizacao_pendente_proposta"("status");

-- CreateIndex
CREATE INDEX "rats_codemp_codpro_idx" ON "rats"("codemp", "codpro");

-- AddForeignKey
ALTER TABLE "sincronizacao_pendente_proposta" ADD CONSTRAINT "sincronizacao_pendente_proposta_codemp_codpro_fkey" FOREIGN KEY ("codemp", "codpro") REFERENCES "propostas"("codemp", "codpro") ON DELETE RESTRICT ON UPDATE CASCADE;
