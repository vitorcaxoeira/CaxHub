-- Campos de tabelas relacionadas que o usuário ligou como colunas de uma lista (12/11/2026, ex.: Gestão Propostas -> cliente__cidcli).
-- Tabela à parte da arrumação das colunas: "Restaurar padrão" apaga a linha de preferencias_colunas e não deve desligar os campos.
CREATE TABLE "preferencias_campos_extras" (
    "user_id" INTEGER NOT NULL,
    "tabela" VARCHAR(80) NOT NULL,
    "campos" TEXT[],
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preferencias_campos_extras_pkey" PRIMARY KEY ("user_id","tabela")
);

ALTER TABLE "preferencias_campos_extras" ADD CONSTRAINT "preferencias_campos_extras_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
