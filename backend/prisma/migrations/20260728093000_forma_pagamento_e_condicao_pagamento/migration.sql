-- CreateTable
CREATE TABLE "formas_pagamento" (
    "codemp" INTEGER NOT NULL,
    "codfpg" INTEGER NOT NULL,
    "desfpg" VARCHAR(30) NOT NULL,
    "abrfpg" VARCHAR(10) NOT NULL,
    "sitfpg" VARCHAR(1) NOT NULL,

    CONSTRAINT "formas_pagamento_pkey" PRIMARY KEY ("codemp","codfpg")
);

-- CreateTable
CREATE TABLE "condicoes_pagamento" (
    "codemp" INTEGER NOT NULL,
    "codcpg" VARCHAR(6) NOT NULL,
    "descpg" VARCHAR(50) NOT NULL,
    "abrcpg" VARCHAR(10) NOT NULL,
    "aplcpg" VARCHAR(1) NOT NULL,
    "sitcpg" VARCHAR(1) NOT NULL,

    CONSTRAINT "condicoes_pagamento_pkey" PRIMARY KEY ("codemp","codcpg")
);

-- CheckConstraint (gerada por scripts/scaffold-table.ts a partir do dominio Senior)
ALTER TABLE "formas_pagamento" ADD CONSTRAINT "chk_formas_pagamento_sitfpg" CHECK ("sitfpg" IN ('A', 'I'));
ALTER TABLE "condicoes_pagamento" ADD CONSTRAINT "chk_condicoes_pagamento_aplcpg" CHECK ("aplcpg" IN ('V', 'C', 'A'));
ALTER TABLE "condicoes_pagamento" ADD CONSTRAINT "chk_condicoes_pagamento_sitcpg" CHECK ("sitcpg" IN ('A', 'I'));
