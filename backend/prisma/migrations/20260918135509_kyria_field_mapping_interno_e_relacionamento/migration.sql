-- AlterTable
ALTER TABLE "kyria_field_mappings" ADD COLUMN     "relacionamento_campo" TEXT,
ADD COLUMN     "relacionamento_modelo" TEXT,
ALTER COLUMN "nome_origem" DROP NOT NULL;
