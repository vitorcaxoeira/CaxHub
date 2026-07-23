-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "nome" TEXT NOT NULL,
    "fotoUrl" TEXT,
    "roleId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "inviteToken" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "consultorCodemp" INTEGER,
    "consultorCodusu" INTEGER,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferencias_fluxo_caixa" (
    "userId" INTEGER NOT NULL,
    "limiarCaixaMin" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preferencias_fluxo_caixa_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" SERIAL NOT NULL,
    "jobName" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa" (
    "codemp" INTEGER NOT NULL,
    "nomemp" TEXT NOT NULL,
    "sigemp" VARCHAR(30) NOT NULL,

    CONSTRAINT "empresa_pkey" PRIMARY KEY ("codemp")
);

-- CreateTable
CREATE TABLE "filial" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "nomfil" TEXT NOT NULL,
    "sigfil" TEXT NOT NULL,

    CONSTRAINT "filial_pkey" PRIMARY KEY ("codemp","codfil")
);

-- CreateTable
CREATE TABLE "clientes" (
    "codcli" INTEGER NOT NULL,
    "nomcli" TEXT NOT NULL,
    "apecli" TEXT NOT NULL,
    "sencli" TEXT NOT NULL,
    "tipcli" TEXT NOT NULL,
    "tipmer" TEXT NOT NULL,
    "tipemc" INTEGER NOT NULL,
    "codram" TEXT NOT NULL,
    "insest" TEXT NOT NULL,
    "cgccpf" BIGINT NOT NULL,
    "endcli" TEXT NOT NULL,
    "cplend" TEXT NOT NULL,
    "cepcli" INTEGER NOT NULL,
    "baicli" TEXT NOT NULL,
    "cidcli" TEXT NOT NULL,
    "sigufs" TEXT NOT NULL,
    "codpai" TEXT NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("codcli")
);

-- CreateTable
CREATE TABLE "tipos_titulo" (
    "codtpt" VARCHAR(3) NOT NULL,
    "destpt" VARCHAR(40) NOT NULL,
    "abrtpt" VARCHAR(5) NOT NULL,
    "recsom" VARCHAR(1) NOT NULL,
    "pagsom" VARCHAR(1) NOT NULL,
    "apltpt" VARCHAR(1),
    "sittpt" VARCHAR(1),

    CONSTRAINT "tipos_titulo_pkey" PRIMARY KEY ("codtpt")
);

-- CreateTable
CREATE TABLE "titulos_receber" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numtit" VARCHAR(15) NOT NULL,
    "codtpt" VARCHAR(3) NOT NULL,
    "codcli" INTEGER NOT NULL,
    "sittit" VARCHAR(2) NOT NULL,
    "datemi" DATE NOT NULL,
    "vctori" DATE NOT NULL,
    "vctpro" DATE NOT NULL,
    "vlrori" DECIMAL(15,2) NOT NULL,
    "vlrabe" DECIMAL(15,2),
    "codpor" VARCHAR(4),

    CONSTRAINT "titulos_receber_pkey" PRIMARY KEY ("codemp","codfil","numtit","codtpt")
);

-- CreateTable
CREATE TABLE "movimentos_receber" (
    "codemp" INTEGER NOT NULL,
    "codfil" INTEGER NOT NULL,
    "numtit" VARCHAR(15) NOT NULL,
    "codtpt" VARCHAR(3) NOT NULL,
    "seqmov" INTEGER NOT NULL,
    "codtns" VARCHAR(5) NOT NULL,
    "datmov" DATE NOT NULL,
    "datpgt" DATE,
    "codfpg" INTEGER,
    "vlrmov" DECIMAL(15,2) NOT NULL,
    "vlrliq" DECIMAL(15,2),
    "vlrjrs" DECIMAL(15,2),
    "vlrmul" DECIMAL(15,2),
    "vlrdsc" DECIMAL(15,2),
    "diaatr" INTEGER,
    "codpor" VARCHAR(4),
    "codcrt" VARCHAR(2),
    "codccu" VARCHAR(9),
    "numcco" VARCHAR(14),

    CONSTRAINT "movimentos_receber_pkey" PRIMARY KEY ("codemp","codfil","numtit","codtpt","seqmov")
);

-- CreateTable
CREATE TABLE "representantes" (
    "codrep" INTEGER NOT NULL,
    "nomrep" VARCHAR(100) NOT NULL,
    "aperep" VARCHAR(50) NOT NULL,
    "tiprep" VARCHAR(1) NOT NULL,
    "cgccpf" BIGINT,
    "sitrep" VARCHAR(1) NOT NULL,
    "cidrep" VARCHAR(60),
    "sigufs" VARCHAR(2),

    CONSTRAINT "representantes_pkey" PRIMARY KEY ("codrep")
);

-- CreateTable
CREATE TABLE "centros_custo" (
    "codemp" INTEGER NOT NULL,
    "codccu" VARCHAR(9) NOT NULL,
    "desccu" VARCHAR(80) NOT NULL,
    "abrccu" VARCHAR(20) NOT NULL,
    "tipccu" INTEGER NOT NULL,
    "ccupai" VARCHAR(9),
    "anasin" VARCHAR(1),

    CONSTRAINT "centros_custo_pkey" PRIMARY KEY ("codemp","codccu")
);

-- CreateTable
CREATE TABLE "movimentos_conta" (
    "codemp" INTEGER NOT NULL,
    "numcco" VARCHAR(14) NOT NULL,
    "datmov" DATE NOT NULL,
    "seqmov" INTEGER NOT NULL,
    "codfil" INTEGER,
    "vlrmov" DECIMAL(15,2) NOT NULL,
    "debcre" VARCHAR(1) NOT NULL,
    "hismov" VARCHAR(100),
    "sitmcc" VARCHAR(1),
    "filmcr" INTEGER,
    "nummcr" VARCHAR(15),
    "tptmcr" VARCHAR(3),
    "seqmcr" INTEGER,
    "codpor" VARCHAR(4),

    CONSTRAINT "movimentos_conta_pkey" PRIMARY KEY ("codemp","numcco","datmov","seqmov")
);

-- CreateTable
CREATE TABLE "naturezas_financeiras" (
    "codemp" INTEGER NOT NULL,
    "ctafin" INTEGER NOT NULL,
    "descta" VARCHAR(80) NOT NULL,
    "abrcta" VARCHAR(20) NOT NULL,
    "defgru" VARCHAR(1) NOT NULL,
    "anasin" VARCHAR(1) NOT NULL,
    "natfin" VARCHAR(1) NOT NULL,
    "sitfin" VARCHAR(1) NOT NULL,

    CONSTRAINT "naturezas_financeiras_pkey" PRIMARY KEY ("codemp","ctafin")
);

-- CreateTable
CREATE TABLE "portadores" (
    "codemp" INTEGER NOT NULL,
    "codpor" VARCHAR(4) NOT NULL,
    "despor" VARCHAR(30) NOT NULL,
    "abrpor" VARCHAR(10) NOT NULL,
    "codban" VARCHAR(3),
    "codage" VARCHAR(7),
    "numcco" VARCHAR(14),

    CONSTRAINT "portadores_pkey" PRIMARY KEY ("codemp","codpor")
);

-- CreateTable
CREATE TABLE "moedas" (
    "codmoe" VARCHAR(3) NOT NULL,
    "desmoe" VARCHAR(30) NOT NULL,
    "sigmoe" VARCHAR(5) NOT NULL,
    "tipmoe" VARCHAR(1) NOT NULL,

    CONSTRAINT "moedas_pkey" PRIMARY KEY ("codmoe")
);

-- CreateTable
CREATE TABLE "transacoes" (
    "codemp" INTEGER NOT NULL,
    "codtns" VARCHAR(5) NOT NULL,
    "destns" VARCHAR(60) NOT NULL,
    "rectpb" VARCHAR(2),

    CONSTRAINT "transacoes_pkey" PRIMARY KEY ("codemp","codtns")
);

-- CreateTable
CREATE TABLE "propostas" (
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "codcli" INTEGER NOT NULL,
    "qtdhor" INTEGER,
    "datpro" DATE,
    "usuger" INTEGER,
    "forate" VARCHAR(1),
    "sitpro" INTEGER,
    "horpro" INTEGER,
    "tippro" INTEGER,
    "dessol" VARCHAR(200),
    "consol" VARCHAR(400),
    "prarea" VARCHAR(100),
    "datenv" DATE,
    "datret" DATE,
    "numprj" INTEGER NOT NULL,
    "datval" DATE,
    "codfpj" INTEGER NOT NULL,
    "sispro" INTEGER,
    "despro" VARCHAR(100),
    "numero" BIGINT,
    "obrfas" VARCHAR(1),
    "executor" INTEGER,
    "obssit" VARCHAR(200),
    "liqbru" VARCHAR(1),
    "codccu" VARCHAR(9),
    "ctafin" INTEGER,
    "clapro" INTEGER,
    "areexe" INTEGER,
    "idcom" INTEGER NOT NULL,
    "codrep" INTEGER NOT NULL,
    "forfat" INTEGER,
    "dscfpg" VARCHAR(200),
    "hispro" VARCHAR(999),
    "obspro" VARCHAR(999),
    "preent" DATE,
    "pripro" INTEGER,
    "stapro" INTEGER,
    "tipven" INTEGER,
    "ordemcns" INTEGER,
    "sitmot" INTEGER,
    "tipprj" INTEGER,
    "frmprj" INTEGER,
    "codlev2" INTEGER,
    "clifat" INTEGER,
    "exipedcli" VARCHAR(1),
    "pedcli" VARCHAR(40),
    "forfatrdv" INTEGER,
    "modpro" INTEGER,
    "forfatlev" INTEGER,
    "numped" INTEGER NOT NULL,
    "idbpm" INTEGER,
    "depexe" INTEGER,
    "fathrsdes" VARCHAR(1),

    CONSTRAINT "propostas_pkey" PRIMARY KEY ("codemp","codpro")
);

-- CreateTable
CREATE TABLE "propostas_itens" (
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "seqite" INTEGER NOT NULL,
    "numprj" INTEGER NOT NULL,
    "codser" VARCHAR(14) NOT NULL,
    "qtdhor" INTEGER,
    "valhor" DECIMAL(11,2),
    "despro" VARCHAR(2000),
    "entpro" VARCHAR(2000),
    "codfpj" INTEGER NOT NULL,
    "fatser" VARCHAR(1),
    "sitmot" INTEGER,
    "forfat" INTEGER,
    "tipprj" INTEGER,
    "frmprj" INTEGER,
    "sitprz" INTEGER,
    "atvpso" BIGINT,
    "depexe" INTEGER,

    CONSTRAINT "propostas_itens_pkey" PRIMARY KEY ("codemp","codpro","seqite")
);

-- CreateTable
CREATE TABLE "consultores" (
    "codemp" INTEGER NOT NULL,
    "codusu" INTEGER NOT NULL,
    "codfor" INTEGER,
    "nomfor" VARCHAR(100),
    "sitfor" VARCHAR(1),
    "nomcom" VARCHAR(127),
    "conhab" INTEGER,
    "tipusurat" INTEGER,
    "depexe" INTEGER,
    "depexedes" VARCHAR(250),
    "email" VARCHAR(200),

    CONSTRAINT "consultores_pkey" PRIMARY KEY ("codemp","codusu")
);

-- CreateTable
CREATE TABLE "contas_correntes" (
    "codemp" INTEGER NOT NULL,
    "numcco" VARCHAR(14) NOT NULL,
    "descco" VARCHAR(30) NOT NULL,
    "abrcco" VARCHAR(10) NOT NULL,
    "sitcco" VARCHAR(1) NOT NULL,

    CONSTRAINT "contas_correntes_pkey" PRIMARY KEY ("codemp","numcco")
);

-- CreateTable
CREATE TABLE "departamentos_gestores" (
    "depexe" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "usuges" BIGINT NOT NULL,

    CONSTRAINT "departamentos_gestores_pkey" PRIMARY KEY ("codemp","depexe")
);

-- CreateTable
CREATE TABLE "departamento_time" (
    "depexe" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codusu" BIGINT NOT NULL,
    "usuger" BIGINT,
    "datger" DATE,
    "horger" INTEGER,
    "sitreg" VARCHAR(1) NOT NULL,

    CONSTRAINT "departamento_time_pkey" PRIMARY KEY ("codemp","depexe","codusu")
);

-- CreateTable
CREATE TABLE "atividades_consultor" (
    "id" SERIAL NOT NULL,
    "seqati" BIGINT,
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "seqite" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "qtdhor" INTEGER,
    "sitreg" VARCHAR(1),
    "datger" DATE,
    "horger" INTEGER,
    "usuger" INTEGER,
    "perlib" INTEGER,
    "fasid" INTEGER NOT NULL,
    "selsol" VARCHAR(1),
    "dataPrevistaInicio" DATE,
    "dataPrevistaFim" DATE,
    "colunaId" INTEGER,
    "estruturaAtividadeId" INTEGER,

    CONSTRAINT "atividades_consultor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estrutura_atividades" (
    "id" SERIAL NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "seqite" INTEGER,
    "parentId" INTEGER,
    "tipo" VARCHAR(10) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "duracaoHoras" INTEGER,
    "dataPrevistaInicio" DATE,
    "dataPrevistaFim" DATE,
    "predecessoraId" INTEGER,
    "percentualConcluido" INTEGER,
    "responsavelCodfor" INTEGER,
    "status" VARCHAR(20),
    "observacao" VARCHAR(1000),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" INTEGER,

    CONSTRAINT "estrutura_atividades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposta_item_posicao" (
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "seqite" INTEGER NOT NULL,
    "parentId" INTEGER NOT NULL,

    CONSTRAINT "proposta_item_posicao_pkey" PRIMARY KEY ("codemp","codpro","seqite")
);

-- CreateTable
CREATE TABLE "proposta_modo_alocacao" (
    "codemp" INTEGER NOT NULL,
    "codpro" INTEGER NOT NULL,
    "modo" VARCHAR(10) NOT NULL,
    "definidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "definidoPor" INTEGER,

    CONSTRAINT "proposta_modo_alocacao_pkey" PRIMARY KEY ("codemp","codpro")
);

-- CreateTable
CREATE TABLE "sincronizacao_pendente" (
    "id" SERIAL NOT NULL,
    "atividadeId" INTEGER NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "sincronizacao_pendente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quadro_colunas" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "corBadge" VARCHAR(30),
    "ehFinal" BOOLEAN NOT NULL DEFAULT false,
    "notificarGestor" BOOLEAN NOT NULL DEFAULT false,
    "contaComoExecucao" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "quadro_colunas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atividade_sessoes_execucao" (
    "id" SERIAL NOT NULL,
    "atividadeId" INTEGER NOT NULL,
    "colunaId" INTEGER NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "origem" VARCHAR(20) NOT NULL,
    "confirmada" BOOLEAN NOT NULL DEFAULT false,
    "ratItemId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atividade_sessoes_execucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rats" (
    "id" SERIAL NOT NULL,
    "codemp" INTEGER NOT NULL,
    "codfor" INTEGER NOT NULL,
    "numprj" INTEGER,
    "codfpj" INTEGER,
    "numrat" INTEGER,
    "codpro" INTEGER,
    "codcli" INTEGER,
    "datemi" DATE,
    "dataApr" DATE,
    "sitrat" INTEGER,
    "obsrat" VARCHAR(250),
    "usufor" INTEGER,
    "depexe" INTEGER,
    "origemCaxHub" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rat_itens" (
    "id" SERIAL NOT NULL,
    "ratId" INTEGER NOT NULL,
    "codemp" INTEGER NOT NULL,
    "numprj" INTEGER,
    "numrat" INTEGER,
    "seqrat" INTEGER,
    "codser" VARCHAR(14),
    "datati" DATE,
    "horini" INTEGER,
    "horfim" INTEGER,
    "desati" VARCHAR(1000),
    "codpro" INTEGER,
    "seqite" INTEGER,
    "codfas" INTEGER,
    "datreg" DATE,
    "seqati" BIGINT,
    "origemCaxHub" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rat_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atividade_historico_movimentacao" (
    "id" SERIAL NOT NULL,
    "atividadeId" INTEGER NOT NULL,
    "colunaAnteriorId" INTEGER,
    "colunaNovaId" INTEGER NOT NULL,
    "userId" INTEGER,
    "movidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atividade_historico_movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atividade_comentarios" (
    "id" SERIAL NOT NULL,
    "atividadeId" INTEGER NOT NULL,
    "userId" INTEGER,
    "texto" VARCHAR(2000) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atividade_comentarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atividade_checklist_itens" (
    "id" SERIAL NOT NULL,
    "atividadeId" INTEGER NOT NULL,
    "texto" VARCHAR(300) NOT NULL,
    "concluido" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "atividade_checklist_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atividade_anexos" (
    "id" SERIAL NOT NULL,
    "atividadeId" INTEGER NOT NULL,
    "userId" INTEGER,
    "nomeArquivo" VARCHAR(255) NOT NULL,
    "caminhoArquivo" VARCHAR(500) NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atividade_anexos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "mensagem" VARCHAR(500) NOT NULL,
    "atividadeId" INTEGER,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fases_proposta" (
    "fasid" INTEGER NOT NULL,
    "fasdes" VARCHAR(50) NOT NULL,

    CONSTRAINT "fases_proposta_pkey" PRIMARY KEY ("fasid")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteToken_key" ON "User"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE INDEX "propostas_sitpro_idx" ON "propostas"("sitpro");

-- CreateIndex
CREATE INDEX "propostas_datpro_idx" ON "propostas"("datpro");

-- CreateIndex
CREATE INDEX "propostas_codrep_idx" ON "propostas"("codrep");

-- CreateIndex
CREATE INDEX "propostas_datenv_datret_idx" ON "propostas"("datenv", "datret");

-- CreateIndex
CREATE INDEX "propostas_datval_idx" ON "propostas"("datval");

-- CreateIndex
CREATE UNIQUE INDEX "atividades_consultor_seqati_key" ON "atividades_consultor"("seqati");

-- CreateIndex
CREATE INDEX "estrutura_atividades_codemp_codpro_seqite_idx" ON "estrutura_atividades"("codemp", "codpro", "seqite");

-- CreateIndex
CREATE UNIQUE INDEX "rats_codemp_numprj_codfpj_numrat_key" ON "rats"("codemp", "numprj", "codfpj", "numrat");

-- CreateIndex
CREATE UNIQUE INDEX "rat_itens_codemp_numrat_seqrat_key" ON "rat_itens"("codemp", "numrat", "seqrat");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_consultorCodemp_consultorCodusu_fkey" FOREIGN KEY ("consultorCodemp", "consultorCodusu") REFERENCES "consultores"("codemp", "codusu") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferencias_fluxo_caixa" ADD CONSTRAINT "preferencias_fluxo_caixa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filial" ADD CONSTRAINT "filial_codemp_fkey" FOREIGN KEY ("codemp") REFERENCES "empresa"("codemp") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos_receber" ADD CONSTRAINT "titulos_receber_codcli_fkey" FOREIGN KEY ("codcli") REFERENCES "clientes"("codcli") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos_receber" ADD CONSTRAINT "titulos_receber_codtpt_fkey" FOREIGN KEY ("codtpt") REFERENCES "tipos_titulo"("codtpt") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos_receber" ADD CONSTRAINT "titulos_receber_codemp_codpor_fkey" FOREIGN KEY ("codemp", "codpor") REFERENCES "portadores"("codemp", "codpor") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_receber" ADD CONSTRAINT "movimentos_receber_codemp_codfil_numtit_codtpt_fkey" FOREIGN KEY ("codemp", "codfil", "numtit", "codtpt") REFERENCES "titulos_receber"("codemp", "codfil", "numtit", "codtpt") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_receber" ADD CONSTRAINT "movimentos_receber_codemp_codtns_fkey" FOREIGN KEY ("codemp", "codtns") REFERENCES "transacoes"("codemp", "codtns") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_codcli_fkey" FOREIGN KEY ("codcli") REFERENCES "clientes"("codcli") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas_itens" ADD CONSTRAINT "propostas_itens_codemp_codpro_fkey" FOREIGN KEY ("codemp", "codpro") REFERENCES "propostas"("codemp", "codpro") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividades_consultor" ADD CONSTRAINT "atividades_consultor_fasid_fkey" FOREIGN KEY ("fasid") REFERENCES "fases_proposta"("fasid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividades_consultor" ADD CONSTRAINT "atividades_consultor_colunaId_fkey" FOREIGN KEY ("colunaId") REFERENCES "quadro_colunas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividades_consultor" ADD CONSTRAINT "atividades_consultor_estruturaAtividadeId_fkey" FOREIGN KEY ("estruturaAtividadeId") REFERENCES "estrutura_atividades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estrutura_atividades" ADD CONSTRAINT "estrutura_atividades_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "estrutura_atividades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_item_posicao" ADD CONSTRAINT "proposta_item_posicao_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "estrutura_atividades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sincronizacao_pendente" ADD CONSTRAINT "sincronizacao_pendente_atividadeId_fkey" FOREIGN KEY ("atividadeId") REFERENCES "atividades_consultor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_sessoes_execucao" ADD CONSTRAINT "atividade_sessoes_execucao_atividadeId_fkey" FOREIGN KEY ("atividadeId") REFERENCES "atividades_consultor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_sessoes_execucao" ADD CONSTRAINT "atividade_sessoes_execucao_colunaId_fkey" FOREIGN KEY ("colunaId") REFERENCES "quadro_colunas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_sessoes_execucao" ADD CONSTRAINT "atividade_sessoes_execucao_ratItemId_fkey" FOREIGN KEY ("ratItemId") REFERENCES "rat_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rat_itens" ADD CONSTRAINT "rat_itens_ratId_fkey" FOREIGN KEY ("ratId") REFERENCES "rats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_historico_movimentacao" ADD CONSTRAINT "atividade_historico_movimentacao_atividadeId_fkey" FOREIGN KEY ("atividadeId") REFERENCES "atividades_consultor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_historico_movimentacao" ADD CONSTRAINT "atividade_historico_movimentacao_colunaAnteriorId_fkey" FOREIGN KEY ("colunaAnteriorId") REFERENCES "quadro_colunas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_historico_movimentacao" ADD CONSTRAINT "atividade_historico_movimentacao_colunaNovaId_fkey" FOREIGN KEY ("colunaNovaId") REFERENCES "quadro_colunas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_historico_movimentacao" ADD CONSTRAINT "atividade_historico_movimentacao_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_comentarios" ADD CONSTRAINT "atividade_comentarios_atividadeId_fkey" FOREIGN KEY ("atividadeId") REFERENCES "atividades_consultor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_comentarios" ADD CONSTRAINT "atividade_comentarios_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_checklist_itens" ADD CONSTRAINT "atividade_checklist_itens_atividadeId_fkey" FOREIGN KEY ("atividadeId") REFERENCES "atividades_consultor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_anexos" ADD CONSTRAINT "atividade_anexos_atividadeId_fkey" FOREIGN KEY ("atividadeId") REFERENCES "atividades_consultor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade_anexos" ADD CONSTRAINT "atividade_anexos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_atividadeId_fkey" FOREIGN KEY ("atividadeId") REFERENCES "atividades_consultor"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Constraints aplicadas manualmente hoje (fora do fluxo Prisma), incorporadas na
-- baseline para que um ambiente novo via 'migrate deploy' fique completo.

-- origem: prisma/constraints/centros_custo.sql
ALTER TABLE "centros_custo" ADD CONSTRAINT "chk_centros_custo_tipccu" CHECK ("tipccu" IN ('1', '2', '3', '4', '5'));
ALTER TABLE "centros_custo" ADD CONSTRAINT "chk_centros_custo_anasin" CHECK ("anasin" IN ('A', 'S'));

-- origem: prisma/constraints/contas_correntes.sql
ALTER TABLE "contas_correntes" ADD CONSTRAINT "chk_contas_correntes_sitcco" CHECK ("sitcco" IN ('A', 'I'));

-- origem: prisma/constraints/departamento_time.sql
ALTER TABLE "departamento_time" ADD CONSTRAINT "chk_departamento_time_depexe" CHECK ("depexe" IN ('00', '01', '02', '03', '04', '05', '06', '08', '09', '10', '11', '12', '13'));
ALTER TABLE "departamento_time" ADD CONSTRAINT "chk_departamento_time_sitreg" CHECK ("sitreg" IN ('A', 'I'));

-- origem: prisma/constraints/departamentos_gestores.sql
ALTER TABLE "departamentos_gestores" ADD CONSTRAINT "chk_departamentos_gestores_depexe" CHECK ("depexe" IN ('00', '01', '02', '03', '04', '05', '06', '08', '09', '10', '11', '12', '13'));

-- origem: prisma/constraints/moedas.sql
ALTER TABLE "moedas" ADD CONSTRAINT "chk_moedas_tipmoe" CHECK ("tipmoe" IN ('V', 'D', 'P', 'E', 'H'));

-- origem: prisma/constraints/movimentos_conta.sql
ALTER TABLE "movimentos_conta" ADD CONSTRAINT "chk_movimentos_conta_sitmcc" CHECK ("sitmcc" IN ('A', 'I'));

-- origem: prisma/constraints/naturezas_financeiras.sql
ALTER TABLE "naturezas_financeiras" ADD CONSTRAINT "chk_naturezas_financeiras_defgru" CHECK ("defgru" IN ('A', 'P', 'D', 'R', 'X', 'M', 'N', 'U', 'L', 'V', 'C', 'S', 'E', 'O', 'T'));
ALTER TABLE "naturezas_financeiras" ADD CONSTRAINT "chk_naturezas_financeiras_anasin" CHECK ("anasin" IN ('A', 'S'));
ALTER TABLE "naturezas_financeiras" ADD CONSTRAINT "chk_naturezas_financeiras_natfin" CHECK ("natfin" IN ('D', 'C'));
ALTER TABLE "naturezas_financeiras" ADD CONSTRAINT "chk_naturezas_financeiras_sitfin" CHECK ("sitfin" IN ('A', 'I'));

-- origem: prisma/constraints/representantes.sql
ALTER TABLE "representantes" ADD CONSTRAINT "chk_representantes_tiprep" CHECK ("tiprep" IN ('J', 'F'));
ALTER TABLE "representantes" ADD CONSTRAINT "chk_representantes_sitrep" CHECK ("sitrep" IN ('A', 'I'));

-- origem: prisma/constraints/tipos_titulo.sql
ALTER TABLE "tipos_titulo" ADD CONSTRAINT "chk_tipos_titulo_recsom" CHECK ("recsom" IN ('D', 'O', 'C'));
ALTER TABLE "tipos_titulo" ADD CONSTRAINT "chk_tipos_titulo_pagsom" CHECK ("pagsom" IN ('D', 'O', 'C'));
ALTER TABLE "tipos_titulo" ADD CONSTRAINT "chk_tipos_titulo_apltpt" CHECK ("apltpt" IN ('A', 'R', 'P'));
ALTER TABLE "tipos_titulo" ADD CONSTRAINT "chk_tipos_titulo_sittpt" CHECK ("sittpt" IN ('A', 'I'));

-- origem: prisma/constraints/titulos_receber.sql
ALTER TABLE "titulos_receber" ADD CONSTRAINT "chk_titulos_receber_sittit" CHECK ("sittit" IN ('AO', 'AN', 'AA', 'AB', 'AC', 'AE', 'AI', 'AJ', 'AP', 'AR', 'AS', 'AV', 'AX', 'CA', 'CE', 'CO', 'LQ', 'LC', 'LI', 'LM', 'LO', 'LP', 'LS', 'LV', 'LX', 'PE'));

-- origem: prisma/constraints/transacoes.sql
ALTER TABLE "transacoes" ADD CONSTRAINT "chk_transacoes_rectpb" CHECK (rectpb IS NULL OR trim(rectpb) = '' OR rectpb IN ('PG', 'DV', 'AB', 'CA', 'CR', 'CP', 'LP', 'SU', 'NA'));
