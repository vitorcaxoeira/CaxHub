-- AlterEnum
ALTER TYPE "KyriaTipoCampo" ADD VALUE 'Decimal';

-- AlterTable
ALTER TABLE "kyria_field_mappings" ADD COLUMN     "escala" INTEGER,
ADD COLUMN     "precisao" INTEGER,
ADD COLUMN     "tamanho" INTEGER;
