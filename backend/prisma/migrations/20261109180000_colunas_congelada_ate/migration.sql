-- Colunas paradas ao rolar na horizontal, escolhidas pelo usuário (09/11/2026): a última coluna parada ("congelar até aqui").
-- NULL = sem escolha (vale o padrão da tela); vazio = nenhuma parada, de propósito.
ALTER TABLE "preferencias_colunas" ADD COLUMN "congelada_ate" VARCHAR(80);
