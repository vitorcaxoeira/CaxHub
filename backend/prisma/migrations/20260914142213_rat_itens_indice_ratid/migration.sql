-- FK "ratId" de rat_itens sem índice de apoio (achado real na investigação de lentidão de
-- /projetos/apontamentos, 14/09/2026): toda busca "itens desta RAT" fazia sequential scan
-- nas ~90 mil linhas da tabela pra achar as poucas que casam com o ratId pedido.
CREATE INDEX "rat_itens_ratId_idx" ON "rat_itens"("ratId");
