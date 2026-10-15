-- Plano de Evolução: a meta do apontamento online fica no INDICADOR (plano_ciclo_indicadores.meta), como a da produtividade.
-- A coluna do ciclo era duplicada e nunca foi usada (tabela criada na migration anterior, ainda sem dados).
ALTER TABLE "plano_ciclos" DROP COLUMN "metaApontamentoOnline";
