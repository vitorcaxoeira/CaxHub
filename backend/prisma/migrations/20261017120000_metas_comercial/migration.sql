-- Gestão de Metas do Comercial: indicadores, ano (pesos mensais), meta anual da empresa, participantes e lançamentos mês a mês.
-- Só tabelas novas. As chaves para indicadores são RESTRICT (indicador com uso se desativa, não se apaga); o resto cai em cascata com o ano.

CREATE TABLE "metas_comercial_indicadores" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "unidade" VARCHAR(6) NOT NULL,
    "acumulacao" VARCHAR(5) NOT NULL DEFAULT 'SOMA',
    "origem" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metas_comercial_indicadores_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "metas_comercial_indicadores_unidade_check" CHECK ("unidade" IN ('BRL', 'HORAS', 'QTD')),
    CONSTRAINT "metas_comercial_indicadores_acumulacao_check" CHECK ("acumulacao" IN ('SOMA', 'SALDO')),
    CONSTRAINT "metas_comercial_indicadores_origem_check" CHECK ("origem" IN ('MANUAL', 'FATURAMENTO_SENIOR'))
);
CREATE UNIQUE INDEX "metas_comercial_indicadores_codigo_key" ON "metas_comercial_indicadores"("codigo");

CREATE TABLE "metas_comercial_anos" (
    "ano" INTEGER NOT NULL,
    "pesosMensais" DECIMAL(9,6)[],
    "observacao" VARCHAR(500),
    "criadoPor" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoPor" INTEGER,
    "atualizadoEm" TIMESTAMP(3),

    CONSTRAINT "metas_comercial_anos_pkey" PRIMARY KEY ("ano"),
    CONSTRAINT "metas_comercial_anos_pesos_check" CHECK (cardinality("pesosMensais") = 12)
);

CREATE TABLE "metas_comercial_empresa" (
    "ano" INTEGER NOT NULL,
    "indicadorId" INTEGER NOT NULL,
    "metaAnual" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "metas_comercial_empresa_pkey" PRIMARY KEY ("ano","indicadorId")
);
ALTER TABLE "metas_comercial_empresa" ADD CONSTRAINT "metas_comercial_empresa_ano_fkey" FOREIGN KEY ("ano") REFERENCES "metas_comercial_anos"("ano") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metas_comercial_empresa" ADD CONSTRAINT "metas_comercial_empresa_indicadorId_fkey" FOREIGN KEY ("indicadorId") REFERENCES "metas_comercial_indicadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "metas_comercial_participantes" (
    "id" SERIAL NOT NULL,
    "ano" INTEGER NOT NULL,
    "codfor" INTEGER,
    "nome" VARCHAR(100) NOT NULL,
    "funcao" VARCHAR(60),
    "naoAtribuido" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "metas_comercial_participantes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "metas_comercial_participantes_ano_codfor_key" ON "metas_comercial_participantes"("ano", "codfor");
CREATE INDEX "metas_comercial_participantes_ano_idx" ON "metas_comercial_participantes"("ano");
-- No máximo UMA linha "Não atribuído" por ano (o unique acima não cobre codfor nulo).
CREATE UNIQUE INDEX "metas_comercial_participantes_nao_atribuido_key" ON "metas_comercial_participantes"("ano") WHERE "naoAtribuido";
ALTER TABLE "metas_comercial_participantes" ADD CONSTRAINT "metas_comercial_participantes_ano_fkey" FOREIGN KEY ("ano") REFERENCES "metas_comercial_anos"("ano") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "metas_comercial_participante_indicadores" (
    "participanteId" INTEGER NOT NULL,
    "indicadorId" INTEGER NOT NULL,
    "rotulo" VARCHAR(80),
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "metas_comercial_participante_indicadores_pkey" PRIMARY KEY ("participanteId","indicadorId")
);
ALTER TABLE "metas_comercial_participante_indicadores" ADD CONSTRAINT "metas_comercial_participante_indicadores_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "metas_comercial_participantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metas_comercial_participante_indicadores" ADD CONSTRAINT "metas_comercial_participante_indicadores_indicadorId_fkey" FOREIGN KEY ("indicadorId") REFERENCES "metas_comercial_indicadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "metas_comercial_lancamentos" (
    "id" SERIAL NOT NULL,
    "participanteId" INTEGER NOT NULL,
    "indicadorId" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "meta" DECIMAL(16,2),
    "realizado" DECIMAL(16,2),
    "observacao" VARCHAR(300),
    "lancadoPor" INTEGER NOT NULL,
    "lancadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metas_comercial_lancamentos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "metas_comercial_lancamentos_mes_check" CHECK ("mes" BETWEEN 1 AND 12)
);
CREATE UNIQUE INDEX "metas_comercial_lancamentos_participanteId_indicadorId_mes_key" ON "metas_comercial_lancamentos"("participanteId", "indicadorId", "mes");
CREATE INDEX "metas_comercial_lancamentos_indicadorId_idx" ON "metas_comercial_lancamentos"("indicadorId");
ALTER TABLE "metas_comercial_lancamentos" ADD CONSTRAINT "metas_comercial_lancamentos_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "metas_comercial_participantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metas_comercial_lancamentos" ADD CONSTRAINT "metas_comercial_lancamentos_indicadorId_fkey" FOREIGN KEY ("indicadorId") REFERENCES "metas_comercial_indicadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indicadores da planilha META 2026 (a gestora inclui outros pela tela).
INSERT INTO "metas_comercial_indicadores" ("codigo", "nome", "unidade", "acumulacao", "origem", "ordem") VALUES
  ('MENSALIDADE',       'Mensalidade',         'BRL',   'SALDO', 'MANUAL',             1),
  ('INCREMENTO_MENSAL', 'Incremento Mensal',   'BRL',   'SOMA',  'MANUAL',             2),
  ('LICENCAS',          'Licenças',            'BRL',   'SOMA',  'MANUAL',             3),
  ('HORAS_SERVICOS',    'Horas de Serviços',   'HORAS', 'SOMA',  'MANUAL',             4),
  ('FATURAMENTO',       'Faturamento',         'BRL',   'SOMA',  'FATURAMENTO_SENIOR', 5),
  ('QUALIFICACOES',     'Novas Qualificações', 'QTD',   'SOMA',  'MANUAL',             6),
  ('REUNIOES',          'Reuniões Agendadas',  'QTD',   'SOMA',  'MANUAL',             7),
  ('OPORTUNIDADES',     'Oportunidades',       'QTD',   'SOMA',  'MANUAL',             8),
  ('NOVOS_CLIENTES',    'Novos Clientes',      'QTD',   'SOMA',  'MANUAL',             9);
