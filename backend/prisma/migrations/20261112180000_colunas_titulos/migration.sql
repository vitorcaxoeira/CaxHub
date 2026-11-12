-- Título próprio das colunas de uma lista, por usuário (12/11/2026): { "nome_tecnico": "Título que a pessoa escolheu" }.
-- O nome técnico (filtro, ordem, resumo, fórmula) não muda; só o texto exibido. Vazio = títulos originais da tela.
ALTER TABLE "preferencias_colunas" ADD COLUMN "titulos" JSONB NOT NULL DEFAULT '{}';
