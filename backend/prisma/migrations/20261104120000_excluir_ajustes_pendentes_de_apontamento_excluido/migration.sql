-- Limpeza única (04/11/2026, pedido do Vitor): pedidos de ajuste de horário ainda "pendente" de apontamentos que já foram excluídos.
-- Até esta data, excluir o apontamento (exclusão lógica, atividade_sessoes_execucao."excluidaEm") deixava o pedido pendente na fila de
-- Aprovações do gestor, apontando para um apontamento que não existe mais. Daqui pra frente DELETE /apontamentos/:id exclui o pedido
-- pendente junto, depois de avisar (ver backend/src/domain/exclusaoApontamento.ts). Pedidos aprovados/reprovados ficam como histórico.
-- Só dados, sem mudança de schema.
DELETE FROM "solicitacoes_ajuste_apontamento" sa
USING "atividade_sessoes_execucao" s
WHERE s."id" = sa."sessaoId"
  AND s."excluidaEm" IS NOT NULL
  AND sa."status" = 'pendente';
