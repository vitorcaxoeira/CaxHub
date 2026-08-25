-- Amplia notas_fiscais_venda (e140nfv) com os campos que o Vitor pediu explicitamente
-- (24/08/2026, mesma sessão). codrep/codcpg/sitnfv são NOT NULL no dicionário do Senior — esta
-- migration assume tabela vazia (nunca foi deployada em produção ainda); localmente precisou de
-- um passo extra (nullable -> backfill via sync -> NOT NULL) por já ter 21.955 linhas de teste,
-- não refletido aqui porque não se aplica a um ambiente que roda esta migration do zero.
-- Ver ~/.claude/plans/jaunty-crafting-neumann.md.

-- AlterTable
ALTER TABLE "notas_fiscais_venda" ADD COLUMN     "ciffob" VARCHAR(1),
ADD COLUMN     "codcpg" VARCHAR(6) NOT NULL,
ADD COLUMN     "codedc" VARCHAR(3),
ADD COLUMN     "codfpg" INTEGER,
ADD COLUMN     "codmoe" VARCHAR(3),
ADD COLUMN     "codrep" INTEGER NOT NULL,
ADD COLUMN     "codtra" INTEGER,
ADD COLUMN     "noppro" VARCHAR(5),
ADD COLUMN     "nopser" VARCHAR(5),
ADD COLUMN     "sitnfv" VARCHAR(1) NOT NULL,
ADD COLUMN     "tipnfs" INTEGER,
ADD COLUMN     "tnspro" VARCHAR(5),
ADD COLUMN     "tnsser" VARCHAR(5),
ADD COLUMN     "vlrfre" DECIMAL(15,2);

-- CHECK constraints (prisma/constraints/notas_fiscais_venda.sql) — tipnfs usa 0 como sentinela
-- de "não informado" (confirmado contra dado real, mesmo papel que string em branco faz nos
-- outros dois), ciffob/sitnfv aceitam branco pelo mesmo motivo de sempre.
ALTER TABLE "notas_fiscais_venda" ADD CONSTRAINT "chk_notas_fiscais_venda_tipnfs"
  CHECK ("tipnfs" IS NULL OR "tipnfs" = 0 OR "tipnfs" IN (1, 2, 3, 4, 5, 6, 9, 10));
ALTER TABLE "notas_fiscais_venda" ADD CONSTRAINT "chk_notas_fiscais_venda_ciffob"
  CHECK ("ciffob" IS NULL OR trim("ciffob") = '' OR "ciffob" IN ('C', 'F', 'T', 'X'));
ALTER TABLE "notas_fiscais_venda" ADD CONSTRAINT "chk_notas_fiscais_venda_sitnfv"
  CHECK ("sitnfv" IS NULL OR trim("sitnfv") = '' OR "sitnfv" IN ('1', '2', '3', '4', '5', '6', '7', '8'));
