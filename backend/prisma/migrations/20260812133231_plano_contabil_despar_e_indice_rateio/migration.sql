-- "Conta Paralela" (E045PLA.DesPar) — agrupamento gerencial que hoje coincide com
-- departamento (ADM/CERP/CHCM/COM/DEV/SERP/SHCM). Validado célula a célula contra o
-- relatório de origem em 12/08/2026 antes de entrar aqui — ver comentário do campo.
ALTER TABLE "plano_contabil" ADD COLUMN "despar" VARCHAR(80);

-- rateios_lancamento (308k+ linhas em produção) só tinha a PK, que começa por numlct —
-- inútil pra agregação por período. O Resultado Analítico agrupa por codemp+sitrat+mês,
-- casando por ctared, e sem este índice faz seq scan na tabela inteira a cada consulta.
CREATE INDEX "rateios_lancamento_codemp_sitrat_datlct_ctared_idx" ON "rateios_lancamento"("codemp", "sitrat", "datlct", "ctared");
