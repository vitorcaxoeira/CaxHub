-- Sinal de "a aba pode estar fechando" — ver POST /atividades/:id/agendar-parada e
-- sync/pararSessoesAoFecharPagina.ts. Puramente aditiva, nulável.
ALTER TABLE "atividade_sessoes_execucao"
  ADD COLUMN "fechamentoSolicitadoEm" TIMESTAMP(3);
