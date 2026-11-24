-- Espelho de GET /label-groups do Kyria (mapeamento #20, 18/11/2026). fitro_dep_time é campo INTERNO do CaxHub (não vem da API): o sync nunca
-- o grava nem o apaga.

-- CreateTable
CREATE TABLE "kyria_label_groups" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "KyriaStatus" NOT NULL,
    "fitro_dep_time" BOOLEAN,
    "sincronizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_label_groups_pkey" PRIMARY KEY ("id")
);
