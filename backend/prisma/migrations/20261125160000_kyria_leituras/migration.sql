-- Registro das leituras do Kyria (25/11/2026): uma linha por execução de job e uma por chamada HTTP à API, com cursor, limite, linhas, KB, tempo e requestId.

-- CreateTable
CREATE TABLE "kyria_leituras" (
    "id" SERIAL NOT NULL,
    "job_name" VARCHAR(80) NOT NULL,
    "recurso" VARCHAR(120) NOT NULL,
    "limite" INTEGER,
    "timeout_ms" INTEGER NOT NULL,
    "iniciada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizada_em" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'em_andamento',
    "paginas" INTEGER NOT NULL DEFAULT 0,
    "linhas" INTEGER NOT NULL DEFAULT 0,
    "ultimo_cursor" TEXT,
    "erro" TEXT,

    CONSTRAINT "kyria_leituras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyria_leituras_paginas" (
    "id" SERIAL NOT NULL,
    "leitura_id" INTEGER NOT NULL,
    "job_name" VARCHAR(80) NOT NULL,
    "disparada_em" TIMESTAMPTZ(6) NOT NULL,
    "cursor" TEXT,
    "proximo_cursor" TEXT,
    "limite" INTEGER,
    "linhas" INTEGER NOT NULL DEFAULT 0,
    "kb" INTEGER NOT NULL DEFAULT 0,
    "ms_kyria" INTEGER NOT NULL,
    "tentativa" INTEGER NOT NULL DEFAULT 1,
    "http_status" INTEGER,
    "espera_s" INTEGER,
    "status" VARCHAR(10) NOT NULL,
    "request_id" VARCHAR(80),
    "erro" TEXT,

    CONSTRAINT "kyria_leituras_paginas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyria_leituras_job_name_iniciada_em_idx" ON "kyria_leituras"("job_name", "iniciada_em");

-- CreateIndex
CREATE INDEX "kyria_leituras_status_idx" ON "kyria_leituras"("status");

-- CreateIndex
CREATE INDEX "kyria_leituras_paginas_job_name_disparada_em_idx" ON "kyria_leituras_paginas"("job_name", "disparada_em");

-- CreateIndex
CREATE INDEX "kyria_leituras_paginas_leitura_id_idx" ON "kyria_leituras_paginas"("leitura_id");

-- AddForeignKey
ALTER TABLE "kyria_leituras_paginas" ADD CONSTRAINT "kyria_leituras_paginas_leitura_id_fkey" FOREIGN KEY ("leitura_id") REFERENCES "kyria_leituras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
