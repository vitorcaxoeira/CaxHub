-- AlterTable
ALTER TABLE "atividade_sessoes_execucao" ADD COLUMN     "observacao" VARCHAR(1000);

-- CreateIndex
CREATE INDEX "consultores_codfor_idx" ON "consultores"("codfor");

-- CreateIndex
CREATE INDEX "atividade_sessoes_execucao_atividadeId_idx" ON "atividade_sessoes_execucao"("atividadeId");

-- CreateIndex
CREATE INDEX "rat_itens_seqati_idx" ON "rat_itens"("seqati");

-- CreateIndex
CREATE INDEX "atividade_historico_movimentacao_atividadeId_idx" ON "atividade_historico_movimentacao"("atividadeId");
