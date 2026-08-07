-- Exclusão lógica do apontamento. Não apaga a linha: a hora trabalhada é registro do que
-- aconteceu, e quem excluiu precisa ficar visível.
ALTER TABLE "atividade_sessoes_execucao"
  ADD COLUMN "excluidaEm" TIMESTAMP(3),
  ADD COLUMN "excluidaPorId" INTEGER;

ALTER TABLE "atividade_sessoes_execucao"
  ADD CONSTRAINT "atividade_sessoes_execucao_excluidaPorId_fkey"
  FOREIGN KEY ("excluidaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pedido de correção de horário de um apontamento já confirmado, e a decisão do gestor.
CREATE TABLE "solicitacoes_ajuste_apontamento" (
    "id" SERIAL NOT NULL,
    "sessaoId" INTEGER NOT NULL,
    "solicitanteId" INTEGER,
    "inicioSolicitado" TIMESTAMP(3) NOT NULL,
    "fimSolicitado" TIMESTAMP(3) NOT NULL,
    "motivo" VARCHAR(1000) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "inicioAprovado" TIMESTAMP(3),
    "fimAprovado" TIMESTAMP(3),
    "observacaoDecisao" VARCHAR(1000),
    "inicioAnterior" TIMESTAMP(3),
    "fimAnterior" TIMESTAMP(3),

    CONSTRAINT "solicitacoes_ajuste_apontamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "solicitacoes_ajuste_apontamento_sessaoId_idx" ON "solicitacoes_ajuste_apontamento"("sessaoId");
CREATE INDEX "solicitacoes_ajuste_apontamento_status_idx" ON "solicitacoes_ajuste_apontamento"("status");

ALTER TABLE "solicitacoes_ajuste_apontamento"
  ADD CONSTRAINT "solicitacoes_ajuste_apontamento_sessaoId_fkey"
  FOREIGN KEY ("sessaoId") REFERENCES "atividade_sessoes_execucao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solicitacoes_ajuste_apontamento"
  ADD CONSTRAINT "solicitacoes_ajuste_apontamento_solicitanteId_fkey"
  FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "solicitacoes_ajuste_apontamento"
  ADD CONSTRAINT "solicitacoes_ajuste_apontamento_decididoPorId_fkey"
  FOREIGN KEY ("decididoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Um pendente por apontamento. Índice PARCIAL, que o Prisma não expressa no schema: é ele
-- que sustenta a retenção do envio ao Senior — dois pedidos abertos no mesmo apontamento
-- deixariam ambíguo qual horário liberar.
CREATE UNIQUE INDEX "ajuste_apontamento_um_pendente_por_sessao"
  ON "solicitacoes_ajuste_apontamento"("sessaoId") WHERE "status" = 'pendente';
