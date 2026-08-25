-- USU_TMetaAnual (tabela customizada, "Meta da Empresa/Filial por Ano") — pedido do Vitor em
-- 24/08/2026. Query original tinha uma coluna computada "Data_Referencia" (01/01/<ano>), que
-- não entrou como coluna — derivável de `anomet` no ponto de uso. Sem CHECK (nenhum campo tem
-- domínio) e sem campo de "alterado desde" no dicionário (só sync completo). Ver
-- ~/.claude/plans/jaunty-crafting-neumann.md.

-- CreateTable
CREATE TABLE "metas_anuais" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "anomet" INTEGER NOT NULL,
    "vlrmet" DECIMAL(10,2) NOT NULL,
    "percre" DECIMAL(6,2) NOT NULL,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "metas_anuais_pkey" PRIMARY KEY ("codemp","codfil","anomet")
);

