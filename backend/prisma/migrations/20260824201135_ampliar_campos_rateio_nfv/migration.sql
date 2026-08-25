-- Amplia rateios_nfv (e140rat) com o resto dos campos que o Vitor pediu explicitamente
-- (24/08/2026, mesma sessão da migration 20260824200329, que já tinha o piso mínimo da query de
-- Faturamento). Ordem/exclusões seguem o dicionário do Senior: CriRat/SomSub (domínio) e
-- UsuGer/DatGer/HorGer/TipOri (auditoria) ficaram de fora, mesmo corte que o Vitor já tinha
-- feito na lista. Ver ~/.claude/plans/jaunty-crafting-neumann.md.

-- AlterTable
ALTER TABLE "rateios_nfv" ADD COLUMN     "codccu" VARCHAR(9),
ADD COLUMN     "codfpj" INTEGER,
ADD COLUMN     "ctafin" INTEGER,
ADD COLUMN     "ctared" INTEGER,
ADD COLUMN     "datbas" DATE,
ADD COLUMN     "numprj" INTEGER,
ADD COLUMN     "obsrat" VARCHAR(120),
ADD COLUMN     "tnspro" VARCHAR(5),
ADD COLUMN     "tnsser" VARCHAR(5),
ADD COLUMN     "vlrcta" DECIMAL(15,2),
ADD COLUMN     "vlrrat" DECIMAL(15,2);

