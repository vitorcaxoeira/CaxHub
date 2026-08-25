-- Configuração 100% nativa do CaxHub (NUNCA sincronizada do Senior) — liga cada departamento
-- (depexe) aos grupos contábeis (plano_contabil.despar) que ele representa, pro RBAC do módulo
-- Contábil por gestor de departamento (routes/contabil.ts). Diferente de departamentos_gestores/
-- departamento_time (espelhos de USU_TDEPEXECFG/USU_TDEPEXETIM), esta tabela é editada só dentro
-- do CaxHub, pela tela Administração > Departamento x Grupo Contábil — nunca pelo sync.
--
-- Migration gerada sem shadow database (usuário Postgres local sem CREATEDB) via
-- `prisma migrate diff --from-schema-datamodel <schema antigo> --to-schema-datamodel
-- schema.prisma --script` — ver [[prisma-sem-shadow-database]] no segundo cérebro.

-- CreateTable
CREATE TABLE "departamento_grupo_contabil" (
    "codemp" INTEGER NOT NULL,
    "depexe" INTEGER NOT NULL,
    "despar" VARCHAR(80) NOT NULL,

    CONSTRAINT "departamento_grupo_contabil_pkey" PRIMARY KEY ("codemp","depexe","despar")
);

-- Seed único, derivado do mapeamento despar -> depexe já confirmado célula a célula contra o
-- Senior em 12/08/2026 (era a constante DESPAR_PARA_DEPEXE em contabilDominio.ts, removida
-- nesta mesma leva). Casado com os (codemp, depexe) que já têm gestor cadastrado em
-- departamentos_gestores, pra nunca semear linha órfã de uma combinação que não existe. Depois
-- deste seed único, a tabela é a única fonte de verdade — editável pela tela de administração.
INSERT INTO "departamento_grupo_contabil" ("codemp", "depexe", "despar")
SELECT DISTINCT dg."codemp", dg."depexe", m.despar
FROM "departamentos_gestores" dg
JOIN (VALUES (1,'ADM'), (2,'COM'), (3,'SERP'), (4,'SHCM'), (8,'CERP'), (9,'CHCM'), (10,'DEV')) AS m(depexe, despar)
  ON m.depexe = dg."depexe"
ON CONFLICT DO NOTHING;
