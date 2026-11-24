-- Evidência do gatilho do `pagehide` (ver POST /atividades/:id/agendar-parada e
-- sync/pararSessoesAoFecharPagina.ts): navegador, visibilidade da aba, se a página ia pro
-- cache e a rota. Copiada pro metadata do ATIVIDADE_PARADA quando o job fecha a sessão.
-- Puramente aditiva, nulável.
ALTER TABLE "atividade_sessoes_execucao"
  ADD COLUMN "fechamentoDetalhe" JSONB;
