-- Índice do sino de notificações (GET /notificacoes e a contagem de não lidas, a cada 45 s por aba
-- aberta): consulta sempre por usuário e ordena pela data de criação.
--
-- Achado no diagnóstico de CPU da VPS (05/10/2026): a tabela tinha só a PK, então cada consulta era
-- um seq scan — 381 mil varreduras em 3 semanas, 471 milhões de linhas lidas. A tabela é pequena
-- (~1,6 mil linhas), o custo por consulta era baixo, mas o volume somava e o índice é de graça.
CREATE INDEX "notificacoes_userId_criadoEm_idx" ON "notificacoes"("userId", "criadoEm");
