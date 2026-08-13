-- Hierarquia de níveis do plano de contas e do centro de custo, vinda do próprio Senior em
-- vez de deduzida no código (NIVEIS_CLACTA hardcoded, que só valia pro plano da SOELTECH).
-- E045PLA.NivCta/MskGcc/GruCta/SitCta e E044CCU.NivCcu/MskCcu nunca tinham sido
-- sincronizados; conferido em 13/08/2026 que NivCta bate 547/547 contra a derivação por
-- máscara. `pai_ctared` é o único campo derivado (o Senior não tem CtaPai em E045PLA).
-- Todas nullable porque entram em tabelas já populadas — o sync preenche na primeira rodada.
-- AlterTable
ALTER TABLE "centros_custo" ADD COLUMN     "mskccu" VARCHAR(40),
ADD COLUMN     "nivccu" INTEGER;

-- AlterTable
ALTER TABLE "plano_contabil" ADD COLUMN     "gructa" INTEGER,
ADD COLUMN     "mskgcc" VARCHAR(40),
ADD COLUMN     "nivcta" INTEGER,
ADD COLUMN     "pai_ctared" INTEGER,
ADD COLUMN     "sitcta" VARCHAR(1);
