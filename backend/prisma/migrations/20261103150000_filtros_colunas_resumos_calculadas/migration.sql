-- Preferências de lista por usuário, trazidas do CaxHub_Dash (03/11/2026): mesmas tabelas e o mesmo SQL das migrations de lá
-- (preferencias_colunas + larguras + resumos, colunas_calculadas, preferencias_filtros), juntas. Só cria.

-- (20261026120000_preferencias_colunas)
CREATE TABLE "preferencias_colunas" (
    "user_id" INTEGER NOT NULL,
    "tabela" VARCHAR(80) NOT NULL,
    "ordem" TEXT[] NOT NULL,
    "ocultas" TEXT[] NOT NULL,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preferencias_colunas_pkey" PRIMARY KEY ("user_id","tabela")
);

ALTER TABLE "preferencias_colunas" ADD CONSTRAINT "preferencias_colunas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- (20261026150000_preferencias_colunas_larguras)
ALTER TABLE "preferencias_colunas" ADD COLUMN "larguras" JSONB NOT NULL DEFAULT '{}';

-- (20261028200000_preferencias_colunas_resumos)
ALTER TABLE "preferencias_colunas" ADD COLUMN "resumos" JSONB NOT NULL DEFAULT '{}';

-- (20261028210000_colunas_calculadas)
CREATE TABLE "colunas_calculadas" (
    "id" SERIAL NOT NULL,
    "tabela" VARCHAR(80) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "publicada" BOOLEAN NOT NULL DEFAULT false,
    "titulo" VARCHAR(60) NOT NULL,
    "formula" VARCHAR(500) NOT NULL,
    "arvore" JSONB NOT NULL,
    "formato" VARCHAR(12) NOT NULL DEFAULT 'numero',
    "casas" SMALLINT NOT NULL DEFAULT 2,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colunas_calculadas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "colunas_calculadas_tabela_idx" ON "colunas_calculadas"("tabela");

ALTER TABLE "colunas_calculadas" ADD CONSTRAINT "colunas_calculadas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- (20261103140000_preferencias_filtros)
CREATE TABLE "preferencias_filtros" (
    "user_id" INTEGER NOT NULL,
    "tela" VARCHAR(80) NOT NULL,
    "campo" VARCHAR(40) NOT NULL,
    "valor" JSONB NOT NULL,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preferencias_filtros_pkey" PRIMARY KEY ("user_id","tela","campo")
);

ALTER TABLE "preferencias_filtros" ADD CONSTRAINT "preferencias_filtros_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
