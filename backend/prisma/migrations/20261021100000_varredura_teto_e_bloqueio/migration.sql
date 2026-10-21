-- Detecção de exclusão (sync/varrerRemovidos.ts), pedido do Vitor em 21/10/2026, depois do lançamento 1300765961 continuar "vivo"
-- no CaxHub mesmo apagado no Senior:
-- 1) lancamentos_contabeis espelha DatLct: o filtro da sync ("DatLct >= 01/01/2025") vira recorte local e a varredura do
--    cabeçalho volta a rodar (até aqui ela pulava toda execução: "filtro ativo em campo não espelhado").
-- 2) Teto da varredura configurável por tabela, em percentual do que está vivo (NULL = padrão de 2%; o mínimo de 50 linhas é fixo).
-- 3) Resultado da última varredura de cada job, com o motivo quando ela NÃO marcou (teto, filtro, contagem...), para a tela de
--    importação mostrar o bloqueio e permitir liberar uma vez, depois de conferir.

ALTER TABLE "lancamentos_contabeis" ADD COLUMN "datlct" DATE;
CREATE INDEX "lancamentos_contabeis_datlct_idx" ON "lancamentos_contabeis"("datlct");

ALTER TABLE "configuracoes_varredura" ADD COLUMN "teto_pct" DECIMAL(5,2);
ALTER TABLE "configuracoes_varredura" ADD CONSTRAINT "configuracoes_varredura_teto_pct_check" CHECK ("teto_pct" IS NULL OR ("teto_pct" > 0 AND "teto_pct" <= 100));

CREATE TABLE "varredura_resultados" (
    "job_name" TEXT NOT NULL,
    "em" TIMESTAMPTZ(6) NOT NULL,
    "modo" VARCHAR(10) NOT NULL,
    "bloqueio" VARCHAR(12),
    "motivo" TEXT,
    "candidatos" INTEGER NOT NULL DEFAULT 0,
    "limite" INTEGER,
    "total_escopo" INTEGER NOT NULL DEFAULT 0,
    "linhas_origem" INTEGER,
    "marcados" INTEGER NOT NULL DEFAULT 0,
    "liberado_por" INTEGER,

    CONSTRAINT "varredura_resultados_pkey" PRIMARY KEY ("job_name")
);
ALTER TABLE "varredura_resultados" ADD CONSTRAINT "varredura_resultados_bloqueio_check"
  CHECK ("bloqueio" IS NULL OR "bloqueio" IN ('teto', 'filtro', 'contagem', 'puladas', 'falha'));
