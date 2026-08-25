-- Amplia itens_servico_nfv (e140isv) e itens_produto_nfv (e140ipv) com os campos que o Vitor
-- pediu explicitamente (24/08/2026, mesma sessão, "complemente" — aditivo: codser/cplisv/
-- vlrbru e codpro/cplipv/vlrbru, já existentes, foram preservados mesmo não relistados). unimed
-- é NOT NULL no dicionário do Senior nas duas — esta migration assume tabela vazia (nunca foi
-- deployada); localmente precisou do passo extra (nullable -> backfill -> NOT NULL) por já ter
-- dado de teste, não refletido aqui. Sem CHECK constraint (nenhum campo novo tem domínio). Ver
-- ~/.claude/plans/jaunty-crafting-neumann.md.

-- AlterTable
ALTER TABLE "itens_servico_nfv" ADD COLUMN     "codtpr" VARCHAR(4),
ADD COLUMN     "datcpt" DATE,
ADD COLUMN     "filctr" INTEGER,
ADD COLUMN     "filped" INTEGER,
ADD COLUMN     "nopser" VARCHAR(5),
ADD COLUMN     "numctr" INTEGER,
ADD COLUMN     "numped" INTEGER,
ADD COLUMN     "preuni" DECIMAL(21,10),
ADD COLUMN     "qtddev" DECIMAL(14,5),
ADD COLUMN     "qtdfat" DECIMAL(14,5),
ADD COLUMN     "seqcvs" INTEGER,
ADD COLUMN     "seqisp" INTEGER,
ADD COLUMN     "tnsser" VARCHAR(5),
ADD COLUMN     "unimed" VARCHAR(3) NOT NULL;

-- AlterTable
ALTER TABLE "itens_produto_nfv" ADD COLUMN     "codder" VARCHAR(7),
ADD COLUMN     "codtpr" VARCHAR(4),
ADD COLUMN     "datcpt" DATE,
ADD COLUMN     "filctr" INTEGER,
ADD COLUMN     "filped" INTEGER,
ADD COLUMN     "noppro" VARCHAR(5),
ADD COLUMN     "numctr" INTEGER,
ADD COLUMN     "numped" INTEGER,
ADD COLUMN     "perdsc" DECIMAL(5,2),
ADD COLUMN     "perofe" DECIMAL(10,5),
ADD COLUMN     "prebas" DECIMAL(21,10),
ADD COLUMN     "preuni" DECIMAL(21,10),
ADD COLUMN     "preven" DECIMAL(21,10),
ADD COLUMN     "qtddev" DECIMAL(14,5),
ADD COLUMN     "qtdfat" DECIMAL(14,5),
ADD COLUMN     "qtdven" DECIMAL(14,5),
ADD COLUMN     "seqcvp" INTEGER,
ADD COLUMN     "seqipd" INTEGER,
ADD COLUMN     "tnspro" VARCHAR(5),
ADD COLUMN     "uniemi" VARCHAR(3),
ADD COLUMN     "unimed" VARCHAR(3) NOT NULL,
ADD COLUMN     "univen" VARCHAR(3);

