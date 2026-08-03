-- Pedido de horas excedentes do consultor e a decisão do gestor. Pedido e decisão em
-- colunas separadas: horasSolicitadas/motivo nunca são reescritos.
CREATE TABLE "solicitacoes_horas_excedentes" (
    "id" SERIAL NOT NULL,
    "atividadeId" INTEGER NOT NULL,
    "solicitanteId" INTEGER,
    "horasSolicitadas" INTEGER NOT NULL,
    "motivo" VARCHAR(1000) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "horasAprovadas" INTEGER,
    "observacaoDecisao" VARCHAR(1000),

    CONSTRAINT "solicitacoes_horas_excedentes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "solicitacoes_horas_excedentes_atividadeId_idx" ON "solicitacoes_horas_excedentes"("atividadeId");
CREATE INDEX "solicitacoes_horas_excedentes_status_idx" ON "solicitacoes_horas_excedentes"("status");

ALTER TABLE "solicitacoes_horas_excedentes"
  ADD CONSTRAINT "solicitacoes_horas_excedentes_atividadeId_fkey"
  FOREIGN KEY ("atividadeId") REFERENCES "atividades_consultor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solicitacoes_horas_excedentes"
  ADD CONSTRAINT "solicitacoes_horas_excedentes_solicitanteId_fkey"
  FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "solicitacoes_horas_excedentes"
  ADD CONSTRAINT "solicitacoes_horas_excedentes_decididoPorId_fkey"
  FOREIGN KEY ("decididoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Um pendente por atividade. Índice PARCIAL, que o Prisma não expressa no schema: sem
-- ele, dois cliques no botão abrem dois pedidos e aprovar os dois soma duas vezes ao teto.
-- Aprovados e reprovados não entram no índice, então a mesma atividade pode ter vários ao
-- longo do tempo.
CREATE UNIQUE INDEX "solicitacao_excedente_uma_pendente_por_atividade"
  ON "solicitacoes_horas_excedentes"("atividadeId") WHERE "status" = 'pendente';
