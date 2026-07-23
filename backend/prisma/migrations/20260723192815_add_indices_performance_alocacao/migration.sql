-- CreateIndex
CREATE INDEX "atividades_consultor_codemp_codpro_seqite_idx" ON "atividades_consultor"("codemp", "codpro", "seqite");

-- CreateIndex
CREATE INDEX "atividades_consultor_sitreg_idx" ON "atividades_consultor"("sitreg");

-- CreateIndex
CREATE INDEX "propostas_itens_depexe_idx" ON "propostas_itens"("depexe");

