-- Modo Painel/TV — mecanismo GENÉRICO (pensado para portar a outros projetos): uma conta
-- de TV (papel "painel") gira automaticamente por uma lista ordenada de painéis, cada um
-- com sua duração e seu modo de atualização. paineis_tv guarda o contexto/config da conta
-- (departamento, zoom, tema); paineis_tv_itens guarda as linhas da rotação. "painelId" é um
-- id de CATÁLOGO EM CÓDIGO (domain/painelCatalogo.ts), não uma FK — o formato desta tabela
-- não muda entre projetos, só o conteúdo do catálogo.
--
-- Migration gerada sem shadow database (usuário Postgres local sem CREATEDB) via
-- `prisma migrate diff --from-schema-datamodel <schema antigo> --to-schema-datamodel
-- schema.prisma --script` — ver [[prisma-sem-shadow-database]] no segundo cérebro.

-- CreateTable
CREATE TABLE "paineis_tv" (
    "userId" INTEGER NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "depexe" INTEGER,
    "codemp" INTEGER,
    "zoom" DECIMAL(3,2) NOT NULL DEFAULT 1.60,
    "tema" VARCHAR(10) NOT NULL DEFAULT 'dark',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paineis_tv_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "paineis_tv_itens" (
    "id" SERIAL NOT NULL,
    "painelTvUserId" INTEGER NOT NULL,
    "painelId" VARCHAR(60) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "duracaoSegundos" INTEGER NOT NULL DEFAULT 30,
    "modoAtualizacao" VARCHAR(10) NOT NULL DEFAULT 'local',
    "filtros" JSONB,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "paineis_tv_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paineis_tv_itens_painelTvUserId_ordem_idx" ON "paineis_tv_itens"("painelTvUserId", "ordem");

-- AddForeignKey
ALTER TABLE "paineis_tv" ADD CONSTRAINT "paineis_tv_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paineis_tv_itens" ADD CONSTRAINT "paineis_tv_itens_painelTvUserId_fkey" FOREIGN KEY ("painelTvUserId") REFERENCES "paineis_tv"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Papel exclusivo das contas de TV. Vai AQUI, e não só no seed: o deploy roda apenas
-- `prisma migrate deploy`, nunca o seed — foi assim que quadro_colunas.contaComoExecucao
-- ficou 12 dias errado em produção (17/07 a 30/07/2026, ver config-producao-via-migration-
-- nao-seed no segundo cérebro). Idempotente: "Role"."name" é UNIQUE (Role_name_key).
-- Atenção: model Role não tem @@map — a tabela é literalmente "Role", com aspas e R
-- maiúsculo (ver 0_init/migration.sql).
INSERT INTO "Role" ("name") VALUES ('painel') ON CONFLICT ("name") DO NOTHING;
