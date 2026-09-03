-- Pedido de mudança nas 3 flags de configuração da proposta (PropostaModoAlocacao) e a
-- decisão de quem tem alçada (admin / gestor do Comercial / gestor da Diretoria). Pedido e
-- decisão em colunas separadas: campo/valorSolicitado/motivo nunca são reescritos, então o
-- que foi pedido continua legível mesmo depois de decidido.
CREATE TABLE "solicitacoes_configuracao_proposta" (
    "id" SERIAL NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "campo" VARCHAR(40) NOT NULL,
    "valorAtual" BOOLEAN NOT NULL,
    "valorSolicitado" BOOLEAN NOT NULL,
    "motivo" VARCHAR(1000) NOT NULL,
    "solicitanteId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "observacaoDecisao" VARCHAR(1000),

    CONSTRAINT "solicitacoes_configuracao_proposta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "solicitacoes_configuracao_proposta_codemp_codpro_idx" ON "solicitacoes_configuracao_proposta"("codemp", "codpro");
CREATE INDEX "solicitacoes_configuracao_proposta_status_idx" ON "solicitacoes_configuracao_proposta"("status");

-- SetNull nos dois: a papelada sobrevive à exclusão de quem pediu ou decidiu. Sem FK pra
-- proposta — a chave lá é composta (codemp, codpro), mesmo arranjo de proposta_modo_alocacao.
ALTER TABLE "solicitacoes_configuracao_proposta"
  ADD CONSTRAINT "solicitacoes_configuracao_proposta_solicitanteId_fkey"
  FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "solicitacoes_configuracao_proposta"
  ADD CONSTRAINT "solicitacoes_configuracao_proposta_decididoPorId_fkey"
  FOREIGN KEY ("decididoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uma pendente por proposta+campo. Índice PARCIAL, que o Prisma não expressa no schema: sem
-- ele, dois cliques abrem dois pedidos pro mesmo campo e aprovar os dois aplicaria a mesma
-- mudança duas vezes. Decididas (aprovada/reprovada) saem do índice, então a mesma proposta
-- pode ter vários pedidos do mesmo campo ao longo do tempo.
CREATE UNIQUE INDEX "solicitacao_config_uma_pendente_por_campo"
  ON "solicitacoes_configuracao_proposta"("codemp", "codpro", "campo") WHERE "status" = 'pendente';
