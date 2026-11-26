-- Gestão de Bonificação (25/11/2026): processos, indicadores, regras/faixas por vigência, enquadramento de consultores, fechamento mensal e resultados; + foto semanal da fila do Kyria.

-- CreateTable
CREATE TABLE "bonificacao_processos" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "vigencia_inicio" DATE NOT NULL,
    "vigencia_fim" DATE,
    "criado_por_id" INTEGER,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bonificacao_processos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonificacao_indicadores" (
    "id" SERIAL NOT NULL,
    "processo_id" INTEGER NOT NULL,
    "chave" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" VARCHAR(500),
    "fonte" VARCHAR(30) NOT NULL,
    "unidade" VARCHAR(15) NOT NULL,
    "sentido" VARCHAR(15) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bonificacao_indicadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonificacao_regras" (
    "id" SERIAL NOT NULL,
    "indicador_id" INTEGER NOT NULL,
    "vigencia_inicio" DATE NOT NULL,
    "vigencia_fim" DATE,
    "valor_base" DECIMAL(15,2) NOT NULL,
    "idade_meses" INTEGER,
    "observacao" VARCHAR(500),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonificacao_regras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonificacao_faixas" (
    "id" SERIAL NOT NULL,
    "regra_id" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "limite" DECIMAL(15,4),
    "pontos" DECIMAL(6,3) NOT NULL,

    CONSTRAINT "bonificacao_faixas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonificacao_enquadramentos" (
    "id" SERIAL NOT NULL,
    "processo_id" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "vigencia_inicio" DATE NOT NULL,
    "vigencia_fim" DATE,
    "observacao" VARCHAR(500),
    "criado_por_id" INTEGER,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bonificacao_enquadramentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonificacao_enquadramento_times" (
    "enquadramento_id" INTEGER NOT NULL,
    "kyria_team_id" VARCHAR(64) NOT NULL,

    CONSTRAINT "bonificacao_enquadramento_times_pkey" PRIMARY KEY ("enquadramento_id","kyria_team_id")
);

-- CreateTable
CREATE TABLE "bonificacao_fechamentos" (
    "id" SERIAL NOT NULL,
    "processo_id" INTEGER NOT NULL,
    "competencia" DATE NOT NULL,
    "situacao" VARCHAR(10) NOT NULL DEFAULT 'aberto',
    "apurado_em" TIMESTAMPTZ(6),
    "fechado_em" TIMESTAMPTZ(6),
    "fechado_por_id" INTEGER,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonificacao_fechamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonificacao_resultados" (
    "id" SERIAL NOT NULL,
    "fechamento_id" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "indicador_id" INTEGER NOT NULL,
    "regra_id" INTEGER,
    "valor_apurado" DECIMAL(15,4),
    "valor_informado" DECIMAL(15,4),
    "pontos" DECIMAL(6,3),
    "valor_base" DECIMAL(15,2),
    "valor" DECIMAL(15,2),
    "detalhe" JSONB,
    "observacao" VARCHAR(500),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bonificacao_resultados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyria_fila_semanal" (
    "data" DATE NOT NULL,
    "team_id" VARCHAR(64) NOT NULL,
    "em_fila" INTEGER NOT NULL,
    "aguardando_retorno" INTEGER NOT NULL,
    "capturado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyria_fila_semanal_pkey" PRIMARY KEY ("data","team_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bonificacao_indicadores_processo_id_chave_key" ON "bonificacao_indicadores"("processo_id", "chave");

-- CreateIndex
CREATE INDEX "bonificacao_regras_indicador_id_vigencia_inicio_idx" ON "bonificacao_regras"("indicador_id", "vigencia_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "bonificacao_faixas_regra_id_ordem_key" ON "bonificacao_faixas"("regra_id", "ordem");

-- CreateIndex
CREATE INDEX "bonificacao_enquadramentos_processo_id_codfor_idx" ON "bonificacao_enquadramentos"("processo_id", "codfor");

-- CreateIndex
CREATE INDEX "bonificacao_enquadramentos_codfor_idx" ON "bonificacao_enquadramentos"("codfor");

-- CreateIndex
CREATE INDEX "bonificacao_enquadramento_times_kyria_team_id_idx" ON "bonificacao_enquadramento_times"("kyria_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "bonificacao_fechamentos_processo_id_competencia_key" ON "bonificacao_fechamentos"("processo_id", "competencia");

-- CreateIndex
CREATE INDEX "bonificacao_resultados_codfor_idx" ON "bonificacao_resultados"("codfor");

-- CreateIndex
CREATE UNIQUE INDEX "bonificacao_resultados_fechamento_id_codfor_indicador_id_key" ON "bonificacao_resultados"("fechamento_id", "codfor", "indicador_id");

-- AddForeignKey
ALTER TABLE "bonificacao_indicadores" ADD CONSTRAINT "bonificacao_indicadores_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "bonificacao_processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacao_regras" ADD CONSTRAINT "bonificacao_regras_indicador_id_fkey" FOREIGN KEY ("indicador_id") REFERENCES "bonificacao_indicadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacao_faixas" ADD CONSTRAINT "bonificacao_faixas_regra_id_fkey" FOREIGN KEY ("regra_id") REFERENCES "bonificacao_regras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacao_enquadramentos" ADD CONSTRAINT "bonificacao_enquadramentos_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "bonificacao_processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacao_enquadramento_times" ADD CONSTRAINT "bonificacao_enquadramento_times_enquadramento_id_fkey" FOREIGN KEY ("enquadramento_id") REFERENCES "bonificacao_enquadramentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacao_enquadramento_times" ADD CONSTRAINT "bonificacao_enquadramento_times_kyria_team_id_fkey" FOREIGN KEY ("kyria_team_id") REFERENCES "kyria_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacao_fechamentos" ADD CONSTRAINT "bonificacao_fechamentos_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "bonificacao_processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacao_resultados" ADD CONSTRAINT "bonificacao_resultados_fechamento_id_fkey" FOREIGN KEY ("fechamento_id") REFERENCES "bonificacao_fechamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacao_resultados" ADD CONSTRAINT "bonificacao_resultados_indicador_id_fkey" FOREIGN KEY ("indicador_id") REFERENCES "bonificacao_indicadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacao_resultados" ADD CONSTRAINT "bonificacao_resultados_regra_id_fkey" FOREIGN KEY ("regra_id") REFERENCES "bonificacao_regras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyria_fila_semanal" ADD CONSTRAINT "kyria_fila_semanal_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "kyria_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Semente dos 2 processos iniciais (o deploy não roda seed: fica na migration, idempotente por nome do processo). Regras conforme os documentos
-- "Bonificação Líderes" e "Bonificação Atendentes" (Soeltech, 2026). Percentual é de 0 a 100; faixa sem limite = "demais casos".
DO $seed$
DECLARE
  pid INTEGER;
  iid INTEGER;
  rid INTEGER;
BEGIN
  -- ---------------------------------------------------------------- Bonificação Líderes Suporte
  IF NOT EXISTS (SELECT 1 FROM bonificacao_processos WHERE nome = 'Bonificação Líderes Suporte') THEN
    INSERT INTO bonificacao_processos (nome, descricao, ativo, vigencia_inicio, atualizado_em)
    VALUES ('Bonificação Líderes Suporte', 'Líderes do Suporte: 5 indicadores de R$ 400, pontos x valor base.', true, DATE '2026-01-01', CURRENT_TIMESTAMP)
    RETURNING id INTO pid;

    -- Capacidade operacional: média das sextas do mês (chamados em fila/aguardando retorno do time).
    INSERT INTO bonificacao_indicadores (processo_id, chave, nome, descricao, fonte, unidade, sentido, ordem)
    VALUES (pid, 'capacidade_operacional', 'Capacidade operacional', 'Chamados aguardando atendimento e retorno do time (média das sextas do mês).', 'kyria_capacidade', 'quantidade', 'menor_melhor', 1)
    RETURNING id INTO iid;
    INSERT INTO bonificacao_regras (indicador_id, vigencia_inicio, valor_base) VALUES (iid, DATE '2026-01-01', 400) RETURNING id INTO rid;
    INSERT INTO bonificacao_faixas (regra_id, ordem, limite, pontos) VALUES (rid, 1, 10, 1), (rid, 2, 13, 0.6), (rid, 3, 15, 0.3), (rid, 4, NULL, 0);

    -- RNC contra a área: a régua muda no 2º semestre.
    INSERT INTO bonificacao_indicadores (processo_id, chave, nome, descricao, fonte, unidade, sentido, ordem)
    VALUES (pid, 'rnc_area', 'RNC contra a área', 'Acionamentos e erros entre setores no mês (lançamento manual).', 'manual', 'quantidade', 'menor_melhor', 2)
    RETURNING id INTO iid;
    INSERT INTO bonificacao_regras (indicador_id, vigencia_inicio, vigencia_fim, valor_base, observacao)
    VALUES (iid, DATE '2026-01-01', DATE '2026-06-30', 400, '1º semestre') RETURNING id INTO rid;
    INSERT INTO bonificacao_faixas (regra_id, ordem, limite, pontos) VALUES (rid, 1, 5, 1), (rid, 2, 7, 0.5), (rid, 3, NULL, 0);
    INSERT INTO bonificacao_regras (indicador_id, vigencia_inicio, valor_base, observacao)
    VALUES (iid, DATE '2026-07-01', 400, '2º semestre') RETURNING id INTO rid;
    INSERT INTO bonificacao_faixas (regra_id, ordem, limite, pontos) VALUES (rid, 1, 3, 1), (rid, 2, 4, 0.5), (rid, 3, NULL, 0);

    -- Cumprimento do planejamento (percentual, lançamento manual).
    INSERT INTO bonificacao_indicadores (processo_id, chave, nome, descricao, fonte, unidade, sentido, ordem)
    VALUES (pid, 'cumprimento_planejamento', 'Cumprimento do planejamento', 'Percentual do planejamento 2026 cumprido no mês (lançamento manual).', 'manual', 'percentual', 'maior_melhor', 3)
    RETURNING id INTO iid;
    INSERT INTO bonificacao_regras (indicador_id, vigencia_inicio, valor_base) VALUES (iid, DATE '2026-01-01', 400) RETURNING id INTO rid;
    INSERT INTO bonificacao_faixas (regra_id, ordem, limite, pontos) VALUES (rid, 1, 95, 1), (rid, 2, 85, 0.5), (rid, 3, NULL, 0);

    -- Eficiência da meta do time: chamados abertos no mês que já estão fechados.
    INSERT INTO bonificacao_indicadores (processo_id, chave, nome, descricao, fonte, unidade, sentido, ordem)
    VALUES (pid, 'eficiencia_time', 'Eficiência da meta do time', 'Percentual dos chamados abertos no mês (times do líder) que estão fechados.', 'kyria_eficiencia', 'percentual', 'maior_melhor', 4)
    RETURNING id INTO iid;
    INSERT INTO bonificacao_regras (indicador_id, vigencia_inicio, valor_base) VALUES (iid, DATE '2026-01-01', 400) RETURNING id INTO rid;
    INSERT INTO bonificacao_faixas (regra_id, ordem, limite, pontos) VALUES (rid, 1, 80, 1), (rid, 2, 50, 0.5), (rid, 3, NULL, 0);

    -- PDI (horas, lançamento manual).
    INSERT INTO bonificacao_indicadores (processo_id, chave, nome, descricao, fonte, unidade, sentido, ordem)
    VALUES (pid, 'pdi', 'PDI', 'Horas de PDI no mês (lançamento manual).', 'manual', 'horas', 'maior_melhor', 5)
    RETURNING id INTO iid;
    INSERT INTO bonificacao_regras (indicador_id, vigencia_inicio, valor_base) VALUES (iid, DATE '2026-01-01', 400) RETURNING id INTO rid;
    INSERT INTO bonificacao_faixas (regra_id, ordem, limite, pontos) VALUES (rid, 1, 8, 1), (rid, 2, NULL, 0);
  END IF;

  -- ---------------------------------------------------------------- Bonificação Atendentes
  IF NOT EXISTS (SELECT 1 FROM bonificacao_processos WHERE nome = 'Bonificação Atendentes') THEN
    INSERT INTO bonificacao_processos (nome, descricao, ativo, vigencia_inicio, atualizado_em)
    VALUES ('Bonificação Atendentes', 'Atendentes do Suporte: ponto apontado em chamado, PDI e chamados antigos da equipe (máx. R$ 400).', true, DATE '2026-01-01', CURRENT_TIMESTAMP)
    RETURNING id INTO pid;

    -- 80% do ponto apontado em chamado: minutos do Kyria / horas trabalhadas do ponto HCM.
    INSERT INTO bonificacao_indicadores (processo_id, chave, nome, descricao, fonte, unidade, sentido, ordem)
    VALUES (pid, 'pct_ponto_apontado', '80% do ponto apontado em chamado', 'Horas apontadas no Kyria ÷ horas trabalhadas do ponto (HCM).', 'kyria_pct_ponto', 'percentual', 'maior_melhor', 1)
    RETURNING id INTO iid;
    INSERT INTO bonificacao_regras (indicador_id, vigencia_inicio, valor_base) VALUES (iid, DATE '2026-01-01', 200) RETURNING id INTO rid;
    INSERT INTO bonificacao_faixas (regra_id, ordem, limite, pontos) VALUES (rid, 1, 80, 1), (rid, 2, NULL, 0);

    -- Cumprimento de horas do PDI (meta 8 h, lançamento manual).
    INSERT INTO bonificacao_indicadores (processo_id, chave, nome, descricao, fonte, unidade, sentido, ordem)
    VALUES (pid, 'pdi', 'Cumprimento de horas do PDI', 'Horas de PDI no mês; 100% da meta de 8 h (lançamento manual).', 'manual', 'horas', 'maior_melhor', 2)
    RETURNING id INTO iid;
    INSERT INTO bonificacao_regras (indicador_id, vigencia_inicio, valor_base) VALUES (iid, DATE '2026-01-01', 100) RETURNING id INTO rid;
    INSERT INTO bonificacao_faixas (regra_id, ordem, limite, pontos) VALUES (rid, 1, 8, 1), (rid, 2, NULL, 0);

    -- Sem chamados com mais de 3 meses (equipe): 1 chamado antigo derruba o item de toda a equipe.
    INSERT INTO bonificacao_indicadores (processo_id, chave, nome, descricao, fonte, unidade, sentido, ordem)
    VALUES (pid, 'chamados_antigos_equipe', 'Não ter chamados com mais de 3 meses (equipe)', 'Chamados em aberto há mais de 3 meses nos times da equipe; com 1 ou mais, toda a equipe perde o item.', 'kyria_chamados_antigos', 'quantidade', 'menor_melhor', 3)
    RETURNING id INTO iid;
    INSERT INTO bonificacao_regras (indicador_id, vigencia_inicio, valor_base, idade_meses) VALUES (iid, DATE '2026-01-01', 100, 3) RETURNING id INTO rid;
    INSERT INTO bonificacao_faixas (regra_id, ordem, limite, pontos) VALUES (rid, 1, 0, 1), (rid, 2, NULL, 0);
  END IF;
END
$seed$;
