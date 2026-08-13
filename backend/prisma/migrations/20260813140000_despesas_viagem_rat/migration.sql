-- Despesas de viagem lançadas em RAT (USU_TE777RDV) + catálogo de rotas/percursos
-- (USU_TRDVROTAS/USU_TRDVPER/USU_TRDVROTPER) — investigado a pedido do Vitor em 13/08/2026.
-- 4 tabelas novas, nenhuma ligada a schema pré-existente (sem FK formal pra "rats"; mesmo
-- espírito de AtividadeConsultor.codfor — casamento por valor, não relação rígida).
-- CreateTable
CREATE TABLE "registros_despesa_viagem" (
    "codemp" INTEGER NOT NULL,
    "numrat" INTEGER NOT NULL,
    "seqrdv" INTEGER NOT NULL,
    "datemi" DATE,
    "desrdv" VARCHAR(250),
    "tipdes" INTEGER,
    "moddes" VARCHAR(1),
    "qtdrdv" INTEGER,
    "vlrunt" DECIMAL(9,2),
    "vlrtot" DECIMAL(9,2),
    "fatrdv" VARCHAR(1),
    "reerdv" VARCHAR(1),
    "rotid" INTEGER,
    "hordes" INTEGER,
    "nidpso" INTEGER,

    CONSTRAINT "registros_despesa_viagem_pkey" PRIMARY KEY ("codemp","numrat","seqrdv")
);

-- CreateTable
CREATE TABLE "rotas_viagem" (
    "id" INTEGER NOT NULL,
    "codcli" INTEGER,
    "desrot" VARCHAR(250),
    "kmtrot" DECIMAL(10,2),
    "horrot" INTEGER,
    "sitreg" VARCHAR(1),
    "idagp" INTEGER,
    "tolhrs" DECIMAL(7,2),
    "tolkm" DECIMAL(7,2),

    CONSTRAINT "rotas_viagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "percursos_viagem" (
    "id" INTEGER NOT NULL,
    "perori" VARCHAR(100),
    "perdes" VARCHAR(100),
    "desper" VARCHAR(250),
    "kmtper" DECIMAL(10,2),
    "horper" INTEGER,
    "modtra" VARCHAR(1),
    "horpag" INTEGER,

    CONSTRAINT "percursos_viagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotas_percursos" (
    "id" INTEGER NOT NULL,
    "rotid" INTEGER NOT NULL,
    "perid" INTEGER NOT NULL,
    "ordseq" INTEGER NOT NULL,

    CONSTRAINT "rotas_percursos_pkey" PRIMARY KEY ("id")
);
