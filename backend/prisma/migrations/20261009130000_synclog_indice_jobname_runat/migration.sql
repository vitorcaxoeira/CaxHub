-- Índice para "última execução de cada job" no SyncLog (tela Importados do Senior/HCM, ultimoSucessoEm,
-- varredura). A tabela ganha um log por job por execução e nunca era podada; sem índice, cada consulta por
-- jobName varria tudo.
CREATE INDEX IF NOT EXISTS "SyncLog_jobName_runAt_idx" ON "SyncLog"("jobName", "runAt" DESC);
