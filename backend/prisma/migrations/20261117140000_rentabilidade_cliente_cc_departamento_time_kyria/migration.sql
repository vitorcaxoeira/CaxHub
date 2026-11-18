-- Rentabilidade (17/11/2026), ajustes 01 e 02.
--
-- 01) clientes.codccu — centro de custo do cliente, derivado do maior codccu de E085RAT (rateio
--     previsto do cliente) pela clienteSync. Coluna só adicionada: nasce NULL e é preenchida na
--     próxima sincronização de clientes.
-- 02) departamento_time_kyria — liga departamento (depexe) a time do Kyria (a "Categoria" do antigo
--     0800). Config nativa do CaxHub, nasce vazia; o admin preenche pela tela.

ALTER TABLE "clientes" ADD COLUMN "codccu" VARCHAR(9);

CREATE TABLE "departamento_time_kyria" (
    "codemp" INTEGER NOT NULL,
    "depexe" INTEGER NOT NULL,
    "kyria_team_id" TEXT NOT NULL,

    CONSTRAINT "departamento_time_kyria_pkey" PRIMARY KEY ("codemp","depexe","kyria_team_id")
);

CREATE INDEX "departamento_time_kyria_kyria_team_id_idx" ON "departamento_time_kyria"("kyria_team_id");

ALTER TABLE "departamento_time_kyria" ADD CONSTRAINT "departamento_time_kyria_kyria_team_id_fkey" FOREIGN KEY ("kyria_team_id") REFERENCES "kyria_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
