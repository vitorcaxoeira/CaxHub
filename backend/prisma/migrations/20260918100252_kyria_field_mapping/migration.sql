-- CreateEnum
CREATE TYPE "KyriaTipoCampo" AS ENUM ('String', 'Int', 'BigInt', 'Float', 'Boolean', 'DateTime', 'Json');

-- CreateTable
CREATE TABLE "kyria_resource_mappings" (
    "id" SERIAL NOT NULL,
    "resource_path" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "amostra_bruta" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "atualizado_por" INTEGER,

    CONSTRAINT "kyria_resource_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyria_field_mappings" (
    "id" SERIAL NOT NULL,
    "resource_id" INTEGER NOT NULL,
    "nome_origem" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "manter" BOOLEAN NOT NULL DEFAULT true,
    "tipo_escolhido" "KyriaTipoCampo" NOT NULL,
    "nome_interno" TEXT NOT NULL,
    "nullable" BOOLEAN NOT NULL DEFAULT true,
    "tipo_inferido_amostra" TEXT,
    "valor_exemplo" TEXT,
    "tipo_openapi" TEXT,
    "nullable_openapi" BOOLEAN,
    "enum_openapi" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyria_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyria_resource_mappings_resource_path_key" ON "kyria_resource_mappings"("resource_path");

-- CreateIndex
CREATE INDEX "kyria_field_mappings_resource_id_idx" ON "kyria_field_mappings"("resource_id");

-- AddForeignKey
ALTER TABLE "kyria_field_mappings" ADD CONSTRAINT "kyria_field_mappings_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "kyria_resource_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
