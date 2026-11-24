-- Modulo RH (Senior HCM): espelho local de 27 tabelas do Vetorh (porte do CaxHub_Dash, 09/10/2026).
-- Gerado sem shadow database: prisma migrate diff --from-schema-datamodel <schema antigo> --to-schema-datamodel schema.prisma --script.
-- Sem papel novo: o menu Pessoas e a tela Importados do HCM sao so do admin.

-- CreateTable
CREATE TABLE "hcm_empresas" (
    "numemp" INTEGER NOT NULL,
    "nomemp" VARCHAR(40),
    "apeemp" VARCHAR(40),
    "sigemp" VARCHAR(5),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_empresas_pkey" PRIMARY KEY ("numemp")
);

-- CreateTable
CREATE TABLE "hcm_filiais" (
    "numemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "nomfil" VARCHAR(40),
    "razsoc" VARCHAR(40),
    "codest" VARCHAR(4),
    "codcid" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_filiais_pkey" PRIMARY KEY ("numemp","codfil")
);

-- CreateTable
CREATE TABLE "hcm_locais" (
    "taborg" INTEGER NOT NULL,
    "numloc" INTEGER NOT NULL,
    "nomloc" VARCHAR(60),
    "datcri" DATE,
    "datext" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_locais_pkey" PRIMARY KEY ("taborg","numloc")
);

-- CreateTable
CREATE TABLE "hcm_cargos" (
    "estcar" INTEGER NOT NULL,
    "codcar" VARCHAR(24) NOT NULL,
    "titred" VARCHAR(30),
    "titcar" VARCHAR(100),
    "codcbo" VARCHAR(5),
    "datcri" DATE,
    "datext" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_cargos_pkey" PRIMARY KEY ("estcar","codcar")
);

-- CreateTable
CREATE TABLE "hcm_postos" (
    "estpos" INTEGER NOT NULL,
    "postra" VARCHAR(24) NOT NULL,
    "desred" VARCHAR(70),
    "despos" VARCHAR(150),
    "datcri" DATE,
    "datext" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_postos_pkey" PRIMARY KEY ("estpos","postra")
);

-- CreateTable
CREATE TABLE "hcm_centros_custo" (
    "numemp" INTEGER NOT NULL,
    "codccu" VARCHAR(18) NOT NULL,
    "nomccu" VARCHAR(80),
    "codfil" INTEGER,
    "tipcta" VARCHAR(1),
    "posccu" VARCHAR(24),
    "datcri" DATE,
    "datext" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_centros_custo_pkey" PRIMARY KEY ("numemp","codccu")
);

-- CreateTable
CREATE TABLE "hcm_situacoes" (
    "codsit" INTEGER NOT NULL,
    "dessit" VARCHAR(30),
    "desabr" VARCHAR(4),
    "tipsit" INTEGER,
    "incabs" INTEGER,
    "conabs" INTEGER,
    "sitcmp" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_situacoes_pkey" PRIMARY KEY ("codsit")
);

-- CreateTable
CREATE TABLE "hcm_causas_demissao" (
    "caudem" INTEGER NOT NULL,
    "desdem" VARCHAR(30),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_causas_demissao_pkey" PRIMARY KEY ("caudem")
);

-- CreateTable
CREATE TABLE "hcm_motivos_alteracao" (
    "codmot" INTEGER NOT NULL,
    "nommot" VARCHAR(30),
    "tipmot" VARCHAR(1),
    "mtvalt" INTEGER,
    "tpomvt" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_motivos_alteracao_pkey" PRIMARY KEY ("codmot")
);

-- CreateTable
CREATE TABLE "hcm_eventos" (
    "codtab" INTEGER NOT NULL,
    "codeve" INTEGER NOT NULL,
    "deseve" VARCHAR(25),
    "tipeve" INTEGER,
    "codcrt" INTEGER,
    "nateve" INTEGER,
    "rgreve" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_eventos_pkey" PRIMARY KEY ("codtab","codeve")
);

-- CreateTable
CREATE TABLE "hcm_escalas" (
    "codesc" INTEGER NOT NULL,
    "nomesc" VARCHAR(30),
    "tabest" INTEGER,
    "claesc" INTEGER,
    "hordsr" INTEGER,
    "horsem" INTEGER,
    "hormes" INTEGER,
    "tipesc" VARCHAR(1),
    "tipjor" INTEGER,
    "desjor" VARCHAR(100),
    "turesc" INTEGER,
    "escnot" VARCHAR(1),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_escalas_pkey" PRIMARY KEY ("codesc")
);

-- CreateTable
CREATE TABLE "hcm_horarios" (
    "codhor" INTEGER NOT NULL,
    "deshor" VARCHAR(30),
    "tabest" INTEGER,
    "turhor" INTEGER,
    "jorhor" VARCHAR(1),
    "hortrb" INTEGER,
    "horext" INTEGER,
    "hornot" INTEGER,
    "tiphor" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_horarios_pkey" PRIMARY KEY ("codhor")
);

-- CreateTable
CREATE TABLE "hcm_colaboradores" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "nomfun" VARCHAR(40),
    "apefun" VARCHAR(50),
    "datadm" DATE,
    "tipadm" INTEGER,
    "sitafa" INTEGER,
    "estpos" INTEGER,
    "postra" VARCHAR(24),
    "estcar" INTEGER,
    "codcar" VARCHAR(24),
    "codesc" INTEGER,
    "codtma" INTEGER,
    "turint" INTEGER,
    "codfil" INTEGER,
    "taborg" INTEGER,
    "numloc" INTEGER,
    "codccu" VARCHAR(18),
    "tipcon" INTEGER,
    "tipsex" VARCHAR(1),
    "estciv" INTEGER,
    "grains" INTEGER,
    "datnas" DATE,
    "codnac" INTEGER,
    "datafa" DATE,
    "caudem" INTEGER,
    "codmot" INTEGER,
    "valsal" DECIMAL(13,4),
    "tipsal" INTEGER,
    "datsal" DATE,
    "horbas" INTEGER,
    "horsem" INTEGER,
    "hordsr" INTEGER,
    "horsab" INTEGER,
    "ultcal" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_colaboradores_pkey" PRIMARY KEY ("numemp","tipcol","numcad")
);

-- CreateTable
CREATE TABLE "hcm_afastamentos" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "datafa" DATE NOT NULL,
    "horafa" INTEGER NOT NULL,
    "datter" DATE,
    "horter" INTEGER,
    "prvter" DATE,
    "sitafa" INTEGER,
    "caudem" INTEGER,
    "diajus" INTEGER,
    "qhrafa" INTEGER,
    "oriafa" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_afastamentos_pkey" PRIMARY KEY ("numemp","tipcol","numcad","datafa","horafa")
);

-- CreateTable
CREATE TABLE "hcm_historico_salarial" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "datalt" DATE NOT NULL,
    "seqalt" INTEGER NOT NULL,
    "codmot" INTEGER,
    "valsal" DECIMAL(13,4),
    "tipsal" INTEGER,
    "perdes" DECIMAL(5,2),
    "perrea" DECIMAL(8,5),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_historico_salarial_pkey" PRIMARY KEY ("numemp","tipcol","numcad","datalt","seqalt")
);

-- CreateTable
CREATE TABLE "hcm_historico_local" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "datalt" DATE NOT NULL,
    "taborg" INTEGER,
    "numloc" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_historico_local_pkey" PRIMARY KEY ("numemp","tipcol","numcad","datalt")
);

-- CreateTable
CREATE TABLE "hcm_historico_cargo" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "datalt" DATE NOT NULL,
    "estcar" INTEGER,
    "codcar" VARCHAR(24),
    "codmot" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_historico_cargo_pkey" PRIMARY KEY ("numemp","tipcol","numcad","datalt")
);

-- CreateTable
CREATE TABLE "hcm_calculos_folha" (
    "numemp" INTEGER NOT NULL,
    "codcal" INTEGER NOT NULL,
    "tipcal" INTEGER,
    "sitcal" VARCHAR(1),
    "perref" DATE,
    "datpag" DATE,
    "inicmp" DATE,
    "fimcmp" DATE,
    "grucal" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_calculos_folha_pkey" PRIMARY KEY ("numemp","codcal")
);

-- CreateTable
CREATE TABLE "hcm_verbas_folha" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "codcal" INTEGER NOT NULL,
    "tabeve" INTEGER NOT NULL,
    "codeve" INTEGER NOT NULL,
    "refeve" DECIMAL(11,2),
    "valeve" DECIMAL(11,2),
    "orieve" VARCHAR(1),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_verbas_folha_pkey" PRIMARY KEY ("numemp","tipcol","numcad","codcal","tabeve","codeve")
);

-- CreateTable
CREATE TABLE "hcm_rescisoes" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "datdem" DATE,
    "caudem" INTEGER,
    "datavi" DATE,
    "datpag" DATE,
    "fimctt" DATE,
    "salfav" DECIMAL(13,4),
    "sldfgt" DECIMAL(11,2),
    "totpro" DECIMAL(11,2),
    "totdes" DECIMAL(11,2),
    "basfgt" DECIMAL(11,2),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_rescisoes_pkey" PRIMARY KEY ("numemp","tipcol","numcad")
);

-- CreateTable
CREATE TABLE "hcm_verbas_rescisao" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "datpag" DATE NOT NULL,
    "tclrcs" INTEGER NOT NULL,
    "tabeve" INTEGER NOT NULL,
    "codeve" INTEGER NOT NULL,
    "refeve" DECIMAL(11,2),
    "valeve" DECIMAL(11,2),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_verbas_rescisao_pkey" PRIMARY KEY ("numemp","tipcol","numcad","datpag","tclrcs","tabeve","codeve")
);

-- CreateTable
CREATE TABLE "hcm_apuracao_ponto" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "datapu" DATE NOT NULL,
    "hordat" INTEGER,
    "codesc" INTEGER,
    "codtma" INTEGER,
    "turint" INTEGER,
    "perref" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_apuracao_ponto_pkey" PRIMARY KEY ("numemp","tipcol","numcad","datapu")
);

-- CreateTable
CREATE TABLE "hcm_situacao_ponto" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "datapu" DATE NOT NULL,
    "codsit" INTEGER NOT NULL,
    "codrat" INTEGER NOT NULL,
    "qtdhor" INTEGER,
    "qtdhnc" INTEGER,
    "perref" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_situacao_ponto_pkey" PRIMARY KEY ("numemp","tipcol","numcad","datapu","codsit","codrat")
);

-- CreateTable
CREATE TABLE "hcm_marcacoes" (
    "numcra" BIGINT NOT NULL,
    "datacc" DATE NOT NULL,
    "horacc" INTEGER NOT NULL,
    "seqacc" INTEGER NOT NULL,
    "tipacc" INTEGER,
    "diracc" VARCHAR(1),
    "numemp" INTEGER,
    "tipcol" INTEGER,
    "numcad" INTEGER,
    "datapu" DATE,
    "oriacc" VARCHAR(1),
    "usomar" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_marcacoes_pkey" PRIMARY KEY ("numcra","datacc","horacc","seqacc")
);

-- CreateTable
CREATE TABLE "hcm_lancamentos_bh" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "codbhr" INTEGER NOT NULL,
    "datlan" DATE NOT NULL,
    "codsit" INTEGER NOT NULL,
    "orilan" VARCHAR(1) NOT NULL,
    "sinlan" VARCHAR(1),
    "qtdhor" INTEGER,
    "qtdpag" INTEGER,
    "datcmp" DATE,
    "perref" DATE,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_lancamentos_bh_pkey" PRIMARY KEY ("numemp","tipcol","numcad","codbhr","datlan","codsit","orilan")
);

-- CreateTable
CREATE TABLE "hcm_periodos_ferias" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "iniper" DATE NOT NULL,
    "fimper" DATE,
    "qtddir" DECIMAL(5,2),
    "qtdfal" DECIMAL(6,2),
    "qtdafa" DECIMAL(7,2),
    "qtdsld" DECIMAL(5,2),
    "qtdabo" DECIMAL(5,2),
    "sitper" INTEGER,
    "limcon" DATE,
    "diadev" INTEGER,
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_periodos_ferias_pkey" PRIMARY KEY ("numemp","tipcol","numcad","iniper")
);

-- CreateTable
CREATE TABLE "hcm_programacao_ferias" (
    "numemp" INTEGER NOT NULL,
    "tipcol" INTEGER NOT NULL,
    "numcad" INTEGER NOT NULL,
    "iniper" DATE NOT NULL,
    "inifer" DATE NOT NULL,
    "tipfer" VARCHAR(1),
    "diafer" DECIMAL(4,2),
    "diaabo" DECIMAL(4,2),
    "datpag" DATE,
    "fimfer" DATE,
    "opc13s" VARCHAR(1),
    "visto_em_sync" TIMESTAMPTZ(6),
    "removido_em_senior" TIMESTAMPTZ(6),

    CONSTRAINT "hcm_programacao_ferias_pkey" PRIMARY KEY ("numemp","tipcol","numcad","iniper","inifer")
);

-- Deteccao de exclusao das tabelas de FATOS do HCM nasce em "simular" (decisao de 09/10/2026), nunca
-- direto em "marcar". Vai por migration porque o deploy nao roda seed. Os cadastros de apoio (empresa,
-- filial, local, cargo, posto, centro de custo, situacao, causa, motivo, evento, escala, horario)
-- seguem o padrao ("desligada") e nao detectam exclusao.
INSERT INTO "configuracoes_varredura" ("job_name", "modo", "atualizado_em")
VALUES ('hcm-colaboradores-sync', 'simular', now()),
       ('hcm-afastamentos-sync', 'simular', now()),
       ('hcm-historico-salarial-sync', 'simular', now()),
       ('hcm-historico-local-sync', 'simular', now()),
       ('hcm-historico-cargo-sync', 'simular', now()),
       ('hcm-calculos-folha-sync', 'simular', now()),
       ('hcm-verbas-folha-sync', 'simular', now()),
       ('hcm-rescisoes-sync', 'simular', now()),
       ('hcm-verbas-rescisao-sync', 'simular', now()),
       ('hcm-apuracao-ponto-sync', 'simular', now()),
       ('hcm-situacao-ponto-sync', 'simular', now()),
       ('hcm-marcacoes-sync', 'simular', now()),
       ('hcm-lancamentos-bh-sync', 'simular', now()),
       ('hcm-periodos-ferias-sync', 'simular', now()),
       ('hcm-programacao-ferias-sync', 'simular', now())
ON CONFLICT ("job_name") DO NOTHING;
