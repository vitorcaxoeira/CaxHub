-- Pedido de apontamento avulso: tempo trabalhado sem mover o card de raia. Enquanto
-- pendente não existe sessão nenhuma, então não conta como realizado — a sessão só nasce
-- na aprovação.
CREATE TABLE "solicitacoes_apontamento" (
    "id" SERIAL NOT NULL,
    "atividadeId" INTEGER NOT NULL,
    "solicitanteId" INTEGER,
    "inicioSolicitado" TIMESTAMP(3) NOT NULL,
    "fimSolicitado" TIMESTAMP(3) NOT NULL,
    "motivo" VARCHAR(1000) NOT NULL,
    "descricao" VARCHAR(1000) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "inicioAprovado" TIMESTAMP(3),
    "fimAprovado" TIMESTAMP(3),
    "descricaoAprovada" VARCHAR(1000),
    "observacaoDecisao" VARCHAR(1000),
    "sessaoId" INTEGER,

    CONSTRAINT "solicitacoes_apontamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "solicitacoes_apontamento_atividadeId_idx" ON "solicitacoes_apontamento"("atividadeId");
CREATE INDEX "solicitacoes_apontamento_status_idx" ON "solicitacoes_apontamento"("status");

ALTER TABLE "solicitacoes_apontamento"
  ADD CONSTRAINT "solicitacoes_apontamento_atividadeId_fkey"
  FOREIGN KEY ("atividadeId") REFERENCES "atividades_consultor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solicitacoes_apontamento"
  ADD CONSTRAINT "solicitacoes_apontamento_solicitanteId_fkey"
  FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "solicitacoes_apontamento"
  ADD CONSTRAINT "solicitacoes_apontamento_decididoPorId_fkey"
  FOREIGN KEY ("decididoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A checagem de conflito de horário filtra rat_itens por data a cada pedido enviado, e a
-- tabela tem ~86 mil linhas (quase todas sincronizadas do Senior, sem sessão local).
CREATE INDEX "rat_itens_datati_idx" ON "rat_itens"("datati");
