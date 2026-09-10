-- Padronização do controle de varredura de removidos (porte do CaxHub_Atlas, 10/09/2026).
--
-- NOTA: `prisma migrate diff` contra o banco local também devolveu 2 DropForeignKey + 2
-- DropTable pra "paineis_tv"/"paineis_tv_itens" — tabelas que existem neste banco mas não têm
-- model correspondente em schema.prisma nem aparecem em nenhuma migration já aplicada (drift
-- pré-existente, sem relação com esta entrega). Deliberadamente OMITIDAS aqui — apagar tabela
-- não é decisão pra tomar de carona numa migration de outra coisa.

-- Tabela de configuração do modo de varredura por job — substitui o Record fixo que vivia em
-- sync/politicaVarredura.ts.
CREATE TABLE "configuracoes_varredura" (
    "job_name" TEXT NOT NULL,
    "modo" TEXT NOT NULL DEFAULT 'desligada',
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "atualizado_por" INTEGER,

    CONSTRAINT "configuracoes_varredura_pkey" PRIMARY KEY ("job_name")
);

-- Semeia os 4 jobName que já rodam em "marcar" hoje via o Record hardcoded — sem isso, o
-- deploy desligaria silenciosamente a varredura que já está em produção nessas 3 tabelas
-- (Pedido tem 2 jobName: o agendado e o sob-demanda por cliente).
INSERT INTO "configuracoes_varredura" ("job_name", "modo", "atualizado_em") VALUES
  ('pedidos-sync', 'marcar', NOW()),
  ('pedidos-sync-cliente', 'marcar', NOW()),
  ('lancamentos_contabeis-sync', 'marcar', NOW()),
  ('rateios_lancamento-sync', 'marcar', NOW());

-- Colunas de controle de exclusão nas 30 tabelas que ainda não tinham (Peça 4 do plano).
ALTER TABLE "atividades_consultor" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "centros_custo" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "clientes" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "condicoes_pagamento" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "consultores" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "contas_correntes" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "departamento_time" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "departamentos_gestores" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "empresa" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "fases_proposta" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "filial" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "formas_pagamento" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "historicos_padrao" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "moedas" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "movimentos_conta" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "movimentos_receber" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "naturezas_financeiras" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "percursos_viagem" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "portadores" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "propostas" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "propostas_itens" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "rat_itens" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "rats" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "registros_despesa_viagem" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "representantes" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "rotas_percursos" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "rotas_viagem" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "tipos_titulo" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "titulos_receber" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
ALTER TABLE "transacoes" ADD COLUMN "removido_em_senior" TIMESTAMPTZ(6), ADD COLUMN "visto_em_sync" TIMESTAMPTZ(6);
