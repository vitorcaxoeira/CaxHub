-- Meses considerados na média do % trabalhado do gozo (13/11/2026): retrato gravado junto com o valor, para o aviso de férias (demonstrativo do cálculo) mostrar
-- exatamente o que foi calculado, mesmo que as horas apontadas mudem depois. Nulo nos gozos lançados antes: o aviso reconstitui a tabela.
ALTER TABLE "ferias_gozos" ADD COLUMN "meses_media" JSONB;
