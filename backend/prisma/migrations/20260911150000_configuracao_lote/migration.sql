-- Tamanho do lote de upsert (sync/upsertEmLote.ts), configurável pelo admin, por job — mesmo
-- padrão de configuracoes_varredura. Sem seed: nenhum job customiza tamanho de lote hoje
-- (todos os que já usam lote rodam no default 1000 de upsertEmLote.ts), então nasce vazia.
CREATE TABLE "configuracoes_lote" (
    "job_name" TEXT NOT NULL,
    "tamanho_lote" INTEGER,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "atualizado_por" INTEGER,

    CONSTRAINT "configuracoes_lote_pkey" PRIMARY KEY ("job_name")
);
