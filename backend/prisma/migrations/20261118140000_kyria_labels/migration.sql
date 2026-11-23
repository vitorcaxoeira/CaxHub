-- Espelho de GET /labels do Kyria (mapeamento #16, 18/11/2026). key/name com tamanho maior que o do mapeamento
-- (32): a API já devolve key de 33 e name de 34 caracteres.

-- CreateTable
CREATE TABLE "kyria_labels" (
    "id" VARCHAR(64) NOT NULL,
    "group_id" VARCHAR(64),
    "team_id" VARCHAR(64),
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(24),
    "status" "KyriaStatus" NOT NULL,
    "sort_order" INTEGER,
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_labels_pkey" PRIMARY KEY ("id")
);
