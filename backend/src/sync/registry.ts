// Catálogo central dos jobs de sincronização Senior -> CaxHub. Cada job já tem seu
// próprio agendamento (scheduleXSync) registrado em server.ts, inalterado — este
// registry existe só pra alimentar a tela de administração (Administração >
// Sincronização ERP): nome de exibição, horário (mesma constante usada no
// cron.schedule de cada arquivo, sem duplicar o valor) e se aceita sincronizar só os
// alterados (campo de data de geração/alteração existe no dicionário do Senior).
import { JOB_NAME as ATIVIDADE_CONSULTOR_JOB, CRON_EXPR as ATIVIDADE_CONSULTOR_CRON, CAMPO_DATA as ATIVIDADE_CONSULTOR_DATA, BASE_QUERY as ATIVIDADE_CONSULTOR_QUERY, runAtividadeConsultorSync } from "./atividadeConsultorSync";
import { JOB_NAME as CENTRO_CUSTO_JOB, CRON_EXPR as CENTRO_CUSTO_CRON, CAMPO_DATA as CENTRO_CUSTO_DATA, BASE_QUERY as CENTRO_CUSTO_QUERY, runCentroCustoSync } from "./centroCustoSync";
import { JOB_NAME as CLIENTE_JOB, CRON_EXPR as CLIENTE_CRON, CAMPO_DATA as CLIENTE_DATA, BASE_QUERY as CLIENTE_QUERY, runClienteSync } from "./clienteSync";
import { JOB_NAME as CONSULTOR_JOB, CRON_EXPR as CONSULTOR_CRON, CAMPO_DATA as CONSULTOR_DATA, QUERY as CONSULTOR_QUERY, runConsultorSync } from "./consultorSync";
import { JOB_NAME as CONTRATO_CONSULTOR_JOB, CRON_EXPR as CONTRATO_CONSULTOR_CRON, CAMPO_DATA as CONTRATO_CONSULTOR_DATA, QUERY as CONTRATO_CONSULTOR_QUERY, runContratoConsultorSync } from "./contratoConsultorSync";
import { JOB_NAME as CONDICAO_PAGAMENTO_JOB, CRON_EXPR as CONDICAO_PAGAMENTO_CRON, CAMPO_DATA as CONDICAO_PAGAMENTO_DATA, QUERY as CONDICAO_PAGAMENTO_QUERY, runCondicaoPagamentoSync } from "./condicaoPagamentoSync";
import { JOB_NAME as CONTA_CORRENTE_JOB, CRON_EXPR as CONTA_CORRENTE_CRON, CAMPO_DATA as CONTA_CORRENTE_DATA, BASE_QUERY as CONTA_CORRENTE_QUERY, runContaCorrenteSync } from "./contaCorrenteSync";
import { JOB_NAME as DEPARTAMENTO_GESTOR_JOB, CRON_EXPR as DEPARTAMENTO_GESTOR_CRON, CAMPO_DATA as DEPARTAMENTO_GESTOR_DATA, BASE_QUERY as DEPARTAMENTO_GESTOR_QUERY, runDepartamentoGestorSync } from "./departamentoGestorSync";
import { JOB_NAME as DEPARTAMENTO_TIME_JOB, CRON_EXPR as DEPARTAMENTO_TIME_CRON, CAMPO_DATA as DEPARTAMENTO_TIME_DATA, BASE_QUERY as DEPARTAMENTO_TIME_QUERY, runDepartamentoTimeSync } from "./departamentoTimeSync";
import { JOB_NAME as EMPRESA_JOB, CRON_EXPR as EMPRESA_CRON, CAMPO_DATA as EMPRESA_DATA, QUERY as EMPRESA_QUERY, runEmpresaSync } from "./empresaSync";
import { JOB_NAME as FASE_PROPOSTA_JOB, CRON_EXPR as FASE_PROPOSTA_CRON, CAMPO_DATA as FASE_PROPOSTA_DATA, QUERY as FASE_PROPOSTA_QUERY, runFasePropostaSync } from "./fasePropostaSync";
import { JOB_NAME as FILIAL_JOB, CRON_EXPR as FILIAL_CRON, CAMPO_DATA as FILIAL_DATA, QUERY as FILIAL_QUERY, runFilialSync } from "./filialSync";
import { JOB_NAME as FORMA_PAGAMENTO_JOB, CRON_EXPR as FORMA_PAGAMENTO_CRON, CAMPO_DATA as FORMA_PAGAMENTO_DATA, QUERY as FORMA_PAGAMENTO_QUERY, runFormaPagamentoSync } from "./formaPagamentoSync";
import { JOB_NAME as LANCAMENTO_CONTABIL_JOB, CRON_EXPR as LANCAMENTO_CONTABIL_CRON, CAMPO_DATA as LANCAMENTO_CONTABIL_DATA, QUERY as LANCAMENTO_CONTABIL_QUERY, runLancamentoContabilSync } from "./lancamentoContabilSync";
import { JOB_NAME as MOEDA_JOB, CRON_EXPR as MOEDA_CRON, CAMPO_DATA as MOEDA_DATA, QUERY as MOEDA_QUERY, runMoedaSync } from "./moedaSync";
import { JOB_NAME as MOVIMENTO_CONTA_JOB, CRON_EXPR as MOVIMENTO_CONTA_CRON, CAMPO_DATA as MOVIMENTO_CONTA_DATA, BASE_QUERY as MOVIMENTO_CONTA_QUERY, runMovimentoContaSync } from "./movimentoContaSync";
import { JOB_NAME as MOVIMENTO_TITULO_JOB, CRON_EXPR as MOVIMENTO_TITULO_CRON, CAMPO_DATA as MOVIMENTO_TITULO_DATA, BASE_QUERY as MOVIMENTO_TITULO_QUERY, runMovimentoTituloReceberSync } from "./movimentoTituloReceberSync";
import { JOB_NAME as NATUREZA_FINANCEIRA_JOB, CRON_EXPR as NATUREZA_FINANCEIRA_CRON, CAMPO_DATA as NATUREZA_FINANCEIRA_DATA, QUERY as NATUREZA_FINANCEIRA_QUERY, runNaturezaFinanceiraSync } from "./naturezaFinanceiraSync";
import { JOB_NAME as ORCAMENTO_CONTABIL_JOB, CRON_EXPR as ORCAMENTO_CONTABIL_CRON, CAMPO_DATA as ORCAMENTO_CONTABIL_DATA, QUERY as ORCAMENTO_CONTABIL_QUERY, runOrcamentoContabilSync } from "./orcamentoContabilSync";
import { JOB_NAME as PEDIDO_JOB, CRON_EXPR as PEDIDO_CRON, CAMPO_DATA as PEDIDO_DATA, BASE_QUERY as PEDIDO_QUERY, runPedidoSync } from "./pedidoSync";
import { JOB_NAME as REGISTRO_DESPESA_VIAGEM_JOB, CRON_EXPR as REGISTRO_DESPESA_VIAGEM_CRON, CAMPO_DATA as REGISTRO_DESPESA_VIAGEM_DATA, BASE_QUERY as REGISTRO_DESPESA_VIAGEM_QUERY, runRegistroDespesaViagemSync } from "./registroDespesaViagemSync";
import { JOB_NAME as ROTA_VIAGEM_JOB, CRON_EXPR as ROTA_VIAGEM_CRON, CAMPO_DATA as ROTA_VIAGEM_DATA, QUERY as ROTA_VIAGEM_QUERY, runRotaViagemSync } from "./rotaViagemSync";
import { JOB_NAME as PERCURSO_VIAGEM_JOB, CRON_EXPR as PERCURSO_VIAGEM_CRON, CAMPO_DATA as PERCURSO_VIAGEM_DATA, QUERY as PERCURSO_VIAGEM_QUERY, runPercursoViagemSync } from "./percursoViagemSync";
import { JOB_NAME as ROTA_PERCURSO_JOB, CRON_EXPR as ROTA_PERCURSO_CRON, CAMPO_DATA as ROTA_PERCURSO_DATA, QUERY as ROTA_PERCURSO_QUERY, runRotaPercursoSync } from "./rotaPercursoSync";
import { JOB_NAME as PLANO_CONTABIL_JOB, CRON_EXPR as PLANO_CONTABIL_CRON, CAMPO_DATA as PLANO_CONTABIL_DATA, BASE_QUERY as PLANO_CONTABIL_QUERY, runPlanoContabilSync } from "./planoContabilSync";
import { JOB_NAME as PORTADOR_JOB, CRON_EXPR as PORTADOR_CRON, CAMPO_DATA as PORTADOR_DATA, QUERY as PORTADOR_QUERY, runPortadorSync } from "./portadorSync";
import { JOB_NAME as PROPOSTA_ITEM_JOB, CRON_EXPR as PROPOSTA_ITEM_CRON, CAMPO_DATA as PROPOSTA_ITEM_DATA, QUERY as PROPOSTA_ITEM_QUERY, runPropostaItemSync } from "./propostaItemSync";
import { JOB_NAME as PROPOSTA_JOB, CRON_EXPR as PROPOSTA_CRON, CAMPO_DATA as PROPOSTA_DATA, QUERY as PROPOSTA_QUERY, runPropostaSync } from "./propostaSync";
import { JOB_NAME as RAT_JOB, CRON_EXPR as RAT_CRON, CAMPO_DATA as RAT_DATA, BASE_QUERY as RAT_QUERY, runRatSync } from "./ratSync";
import { JOB_NAME as RAT_ITEM_JOB, CRON_EXPR as RAT_ITEM_CRON, CAMPO_DATA as RAT_ITEM_DATA, BASE_QUERY as RAT_ITEM_QUERY, runRatItemSync } from "./ratItemSync";
import { JOB_NAME as RATEIO_LANCAMENTO_JOB, CRON_EXPR as RATEIO_LANCAMENTO_CRON, CAMPO_DATA as RATEIO_LANCAMENTO_DATA, QUERY as RATEIO_LANCAMENTO_QUERY, runRateioLancamentoSync } from "./rateioLancamentoSync";
import { JOB_NAME as REPRESENTANTE_JOB, CRON_EXPR as REPRESENTANTE_CRON, CAMPO_DATA as REPRESENTANTE_DATA, BASE_QUERY as REPRESENTANTE_QUERY, runRepresentanteSync } from "./representanteSync";
import { JOB_NAME as TIPO_TITULO_JOB, CRON_EXPR as TIPO_TITULO_CRON, CAMPO_DATA as TIPO_TITULO_DATA, QUERY as TIPO_TITULO_QUERY, runTipoTituloSync } from "./tipoTituloSync";
import { JOB_NAME as TITULO_RECEBER_JOB, CRON_EXPR as TITULO_RECEBER_CRON, CAMPO_DATA as TITULO_RECEBER_DATA, BASE_QUERY as TITULO_RECEBER_QUERY, runTituloReceberSync } from "./tituloReceberSync";
import { JOB_NAME as TRANSACAO_JOB, CRON_EXPR as TRANSACAO_CRON, CAMPO_DATA as TRANSACAO_DATA, BASE_QUERY as TRANSACAO_QUERY, runTransacaoSync } from "./transacaoSync";
import { prisma } from "../db/prisma";
import { extrairTabela, extrairColunas, ColunaQuery } from "./consultaSenior";

// USU_VBI00Cons/USU_VBI01CTRCS são views de BI sem registro em r996tbl/r998tbl — o
// dicionário do Senior não as conhece, então getTableInfo (soap/metadata.ts) lança exceção
// nelas. Os dois jobs escritos à mão por causa disso (ver consultorSync.ts/
// contratoConsultorSync.ts) são os únicos com temDicionario: false.
const JOBS_SEM_DICIONARIO = new Set([CONSULTOR_JOB, CONTRATO_CONSULTOR_JOB]);

// Fase 3 nasceu restrita a um piloto só (pedidos-sync); Fase 4 (propagação por dimensão)
// estendeu `filtroDoJob()` pros 35 jobs — cada `montarQuery`/query-building agora lê o
// snapshot de filtros ativos. Mantido como um Set explícito (em vez de "sempre true") de
// propósito: continua sendo o único lugar que precisa mudar se um job novo nascer sem essa
// linha de `montarQuery` (ver checklist em CLAUDE interno da Fase 1) — salvar filtro numa
// tabela fora daqui devolve erro claro em vez de aceitar em silêncio algo que o `run()` dela
// não consome.
const JOBS_COM_FILTRO = new Set([
  ATIVIDADE_CONSULTOR_JOB,
  CENTRO_CUSTO_JOB,
  CLIENTE_JOB,
  CONSULTOR_JOB,
  CONTRATO_CONSULTOR_JOB,
  CONDICAO_PAGAMENTO_JOB,
  CONTA_CORRENTE_JOB,
  DEPARTAMENTO_GESTOR_JOB,
  DEPARTAMENTO_TIME_JOB,
  EMPRESA_JOB,
  FASE_PROPOSTA_JOB,
  FILIAL_JOB,
  FORMA_PAGAMENTO_JOB,
  LANCAMENTO_CONTABIL_JOB,
  MOEDA_JOB,
  MOVIMENTO_CONTA_JOB,
  MOVIMENTO_TITULO_JOB,
  NATUREZA_FINANCEIRA_JOB,
  ORCAMENTO_CONTABIL_JOB,
  PEDIDO_JOB,
  REGISTRO_DESPESA_VIAGEM_JOB,
  ROTA_VIAGEM_JOB,
  PERCURSO_VIAGEM_JOB,
  ROTA_PERCURSO_JOB,
  PLANO_CONTABIL_JOB,
  PORTADOR_JOB,
  PROPOSTA_ITEM_JOB,
  PROPOSTA_JOB,
  RAT_JOB,
  RAT_ITEM_JOB,
  RATEIO_LANCAMENTO_JOB,
  REPRESENTANTE_JOB,
  TIPO_TITULO_JOB,
  TITULO_RECEBER_JOB,
  TRANSACAO_JOB,
]);

// Catálogo (tabela/colunas) derivado da própria query em vez de mantido à mão — evita a
// tabela e as colunas ficarem desalinhadas da query real de cada job (mesma classe de bug
// já vista neste projeto: coluna existe no schema/SELECT mas o catálogo não sabe dela).
// `tabelaLocal` é a única peça que não dá pra derivar da query do Senior (é o `@@map` do
// model Prisma) — por isso entra como parâmetro explícito em cada chamada, mesmo espírito
// de JOBS_SEM_DICIONARIO: preferir exceção documentada a adivinhar por convenção de nome.
function catalogo(
  jobName: string,
  query: string,
  tabelaLocal: string
): {
  tabelaSenior: string;
  colunas: ColunaQuery[];
  temDicionario: boolean;
  tabelaLocal: string;
  queryBase: string;
  suportaFiltro: boolean;
} {
  return {
    tabelaSenior: extrairTabela(query),
    colunas: extrairColunas(query),
    temDicionario: !JOBS_SEM_DICIONARIO.has(jobName),
    tabelaLocal,
    queryBase: query,
    suportaFiltro: JOBS_COM_FILTRO.has(jobName),
  };
}

export interface SyncJobDescriptor {
  jobName: string;
  displayName: string;
  cronExpr: string;
  suportaAlterados: boolean;
  // Nome de ORIGEM do campo de data usado no corte incremental (ex.: "DatAtu"), ou `null` nos
  // jobs sem `suportaAlterados` — mesma constante `CAMPO_DATA` de cada arquivo de sync,
  // exposta aqui pra tela oferecer a variável "última sincronização" só no campo certo
  // (pedido do Vitor, 21/08/2026: ver o corte de data em Filtro(Alterados)).
  campoData: string | null;
  // Fundação do plano de filtros na importação (Fase 1) — tabela/colunas espelhadas
  // derivadas da própria query do job (ver catalogo() acima), pra alimentar o catálogo de
  // campos filtráveis sem duplicar essa informação à mão. `colunas[].origem` é o nome que
  // o WHERE do Senior precisa usar (não o alias) — 13 dos 35 jobs divergem entre os dois.
  tabelaSenior: string;
  colunas: ColunaQuery[];
  // false só nos 2 jobs cuja tabela de origem é uma view USU_V* sem registro no dicionário
  // do Senior (r996tbl/r998tbl) — getTableInfo lançaria exceção nelas.
  temDicionario: boolean;
  // Tabela LOCAL (Postgres, `@@map` do model Prisma correspondente) — usada pelo catálogo
  // de campos (Fase 2) pra achar o tipo/nulabilidade de cada coluna espelhada sem round-trip
  // SOAP (caminho instantâneo). Sem relação com `tabelaSenior` (a origem, no ERP).
  tabelaLocal: string;
  // Query BASE do job, sem predicado nenhum (byte a byte igual à constante que cada arquivo
  // exporta) — usada pelo preview de filtro (Fase 3, `POST /:jobName/preview`) pra montar a
  // query final sem precisar reconstruí-la a partir de `tabelaSenior`/`colunas`.
  queryBase: string;
  // Fase 3 do plano de filtros — só true nos jobs cujo `run()` já lê `filtroDoJob()`
  // (sync/filtrosAtivos.ts). Piloto restrito de propósito, ver JOBS_COM_FILTRO acima.
  suportaFiltro: boolean;
  run: (desde?: Date) => Promise<void>;
  // Total de linhas já sincronizadas localmente (tabela pequena o bastante — no máximo
  // dezenas de milhares de linhas hoje — pra um COUNT(*) direto não pesar no polling da tela).
  contarRegistros: () => Promise<number>;
  // Detecção de exclusão no Senior (ver sync/varrerRemovidos.ts). Opcionais de propósito:
  // só os jobs já adaptados preenchem, os outros continuam exatamente como estavam. Quando
  // ausentes, a tela não mostra a coluna de removidos pra essa tabela.
  contarRemovidos?: () => Promise<number>;
  // Amostra dos registros marcados, pra conferir no Senior se a detecção está certa —
  // é o que torna a fase de observação verificável.
  //
  // `candidatosDesde` é o instante da última varredura (SyncLog.varreduraInicio): quando
  // informado, a lista inclui também quem AINDA NÃO foi marcado mas seria (carimbo mais
  // antigo que isso). Sem isso, em modo "simular" a lista viria sempre vazia — e é
  // justamente na simulação que a conferência precisa acontecer.
  listarRemovidos?: (limite: number, candidatosDesde: Date | null) => Promise<ItemRemovido[]>;
}

export interface ItemRemovido {
  // Chave natural do registro no Senior, pra busca manual lá (ex.: "1/1/12124").
  chave: string;
  rotulo: string;
  // null quando é candidato ainda não marcado (varredura em simulação).
  removidoEmSenior: Date | null;
  marcado: boolean;
}

// A ORDEM É A ORDEM DE DEPENDÊNCIA — é ela que "Sincronizar tudo" segue, e num banco VAZIO
// cada FK precisa do alvo já carregado. As arestas que existem hoje:
//
//   Filial                 -> Empresa
//   TituloReceber          -> Cliente, TipoTitulo, Portador
//   MovimentoTituloReceber -> TituloReceber, Transacao
//   Proposta               -> Cliente
//   PropostaItem           -> Proposta
//   AtividadeConsultor     -> FaseProposta
//   RatItem                -> Rat
//
// Portador e Transação estavam DEPOIS dos títulos e foram movidos pra cá. O defeito era
// invisível nesta base porque as tabelas já estão populadas de cargas antigas — o upsert
// acha o alvo de qualquer jeito. Só aparece em restore pra base limpa, e aí a carga inteira
// de Títulos a Receber morre por FK e derruba os Movimentos junto (medido no CaxHub_Hedel,
// que nasceu vazio: 0 de 23.937 linhas).

// Domínio "LSitLot" (mesmo em LancamentoContabil.sitlct e RateioLancamento.sitrat) — só pra
// tornar o rótulo da conferência manual de removidos legível (ver listarRemovidos dos dois
// jobs abaixo). Não influencia a detecção de exclusão física em si, que é sobre a linha
// desaparecer da consulta ao Senior, não sobre o valor deste campo (ver schema.prisma).
const SITUACAO_LANCAMENTO: Record<number, string> = { 1: "A Contabilizar", 2: "Contabilizado", 3: "Excluído", 4: "Desativado" };

export const SYNC_JOBS: SyncJobDescriptor[] = [
  { jobName: EMPRESA_JOB, displayName: "Empresas", cronExpr: EMPRESA_CRON, suportaAlterados: EMPRESA_DATA != null, campoData: EMPRESA_DATA, ...catalogo(EMPRESA_JOB, EMPRESA_QUERY, "empresa"), run: runEmpresaSync, contarRegistros: () => prisma.empresa.count() },
  { jobName: FILIAL_JOB, displayName: "Filiais", cronExpr: FILIAL_CRON, suportaAlterados: FILIAL_DATA != null, campoData: FILIAL_DATA, ...catalogo(FILIAL_JOB, FILIAL_QUERY, "filial"), run: runFilialSync, contarRegistros: () => prisma.filial.count() },
  { jobName: CLIENTE_JOB, displayName: "Clientes", cronExpr: CLIENTE_CRON, suportaAlterados: CLIENTE_DATA != null, campoData: CLIENTE_DATA, ...catalogo(CLIENTE_JOB, CLIENTE_QUERY, "clientes"), run: runClienteSync, contarRegistros: () => prisma.cliente.count() },
  { jobName: TIPO_TITULO_JOB, displayName: "Tipos de Título", cronExpr: TIPO_TITULO_CRON, suportaAlterados: TIPO_TITULO_DATA != null, campoData: TIPO_TITULO_DATA, ...catalogo(TIPO_TITULO_JOB, TIPO_TITULO_QUERY, "tipos_titulo"), run: runTipoTituloSync, contarRegistros: () => prisma.tipoTitulo.count() },
  { jobName: PORTADOR_JOB, displayName: "Portadores", cronExpr: PORTADOR_CRON, suportaAlterados: PORTADOR_DATA != null, campoData: PORTADOR_DATA, ...catalogo(PORTADOR_JOB, PORTADOR_QUERY, "portadores"), run: runPortadorSync, contarRegistros: () => prisma.portador.count() },
  { jobName: TRANSACAO_JOB, displayName: "Transações", cronExpr: TRANSACAO_CRON, suportaAlterados: TRANSACAO_DATA != null, campoData: TRANSACAO_DATA, ...catalogo(TRANSACAO_JOB, TRANSACAO_QUERY, "transacoes"), run: runTransacaoSync, contarRegistros: () => prisma.transacao.count() },
  { jobName: TITULO_RECEBER_JOB, displayName: "Títulos a Receber", cronExpr: TITULO_RECEBER_CRON, suportaAlterados: TITULO_RECEBER_DATA != null, campoData: TITULO_RECEBER_DATA, ...catalogo(TITULO_RECEBER_JOB, TITULO_RECEBER_QUERY, "titulos_receber"), run: runTituloReceberSync, contarRegistros: () => prisma.tituloReceber.count() },
  { jobName: MOVIMENTO_TITULO_JOB, displayName: "Movimentos de Títulos a Receber", cronExpr: MOVIMENTO_TITULO_CRON, suportaAlterados: MOVIMENTO_TITULO_DATA != null, campoData: MOVIMENTO_TITULO_DATA, ...catalogo(MOVIMENTO_TITULO_JOB, MOVIMENTO_TITULO_QUERY, "movimentos_receber"), run: runMovimentoTituloReceberSync, contarRegistros: () => prisma.movimentoTituloReceber.count() },
  { jobName: REPRESENTANTE_JOB, displayName: "Representantes", cronExpr: REPRESENTANTE_CRON, suportaAlterados: REPRESENTANTE_DATA != null, campoData: REPRESENTANTE_DATA, ...catalogo(REPRESENTANTE_JOB, REPRESENTANTE_QUERY, "representantes"), run: runRepresentanteSync, contarRegistros: () => prisma.representante.count() },
  { jobName: CENTRO_CUSTO_JOB, displayName: "Centros de Custo", cronExpr: CENTRO_CUSTO_CRON, suportaAlterados: CENTRO_CUSTO_DATA != null, campoData: CENTRO_CUSTO_DATA, ...catalogo(CENTRO_CUSTO_JOB, CENTRO_CUSTO_QUERY, "centros_custo"), run: runCentroCustoSync, contarRegistros: () => prisma.centroCusto.count() },
  { jobName: MOVIMENTO_CONTA_JOB, displayName: "Movimentos de Conta", cronExpr: MOVIMENTO_CONTA_CRON, suportaAlterados: MOVIMENTO_CONTA_DATA != null, campoData: MOVIMENTO_CONTA_DATA, ...catalogo(MOVIMENTO_CONTA_JOB, MOVIMENTO_CONTA_QUERY, "movimentos_conta"), run: runMovimentoContaSync, contarRegistros: () => prisma.movimentoConta.count() },
  { jobName: NATUREZA_FINANCEIRA_JOB, displayName: "Naturezas Financeiras", cronExpr: NATUREZA_FINANCEIRA_CRON, suportaAlterados: NATUREZA_FINANCEIRA_DATA != null, campoData: NATUREZA_FINANCEIRA_DATA, ...catalogo(NATUREZA_FINANCEIRA_JOB, NATUREZA_FINANCEIRA_QUERY, "naturezas_financeiras"), run: runNaturezaFinanceiraSync, contarRegistros: () => prisma.naturezaFinanceira.count() },
  { jobName: MOEDA_JOB, displayName: "Moedas", cronExpr: MOEDA_CRON, suportaAlterados: MOEDA_DATA != null, campoData: MOEDA_DATA, ...catalogo(MOEDA_JOB, MOEDA_QUERY, "moedas"), run: runMoedaSync, contarRegistros: () => prisma.moeda.count() },
  { jobName: CONTA_CORRENTE_JOB, displayName: "Contas Correntes", cronExpr: CONTA_CORRENTE_CRON, suportaAlterados: CONTA_CORRENTE_DATA != null, campoData: CONTA_CORRENTE_DATA, ...catalogo(CONTA_CORRENTE_JOB, CONTA_CORRENTE_QUERY, "contas_correntes"), run: runContaCorrenteSync, contarRegistros: () => prisma.contaCorrente.count() },
  { jobName: PROPOSTA_JOB, displayName: "Propostas", cronExpr: PROPOSTA_CRON, suportaAlterados: PROPOSTA_DATA != null, campoData: PROPOSTA_DATA, ...catalogo(PROPOSTA_JOB, PROPOSTA_QUERY, "propostas"), run: runPropostaSync, contarRegistros: () => prisma.proposta.count() },
  { jobName: PROPOSTA_ITEM_JOB, displayName: "Itens de Proposta", cronExpr: PROPOSTA_ITEM_CRON, suportaAlterados: PROPOSTA_ITEM_DATA != null, campoData: PROPOSTA_ITEM_DATA, ...catalogo(PROPOSTA_ITEM_JOB, PROPOSTA_ITEM_QUERY, "propostas_itens"), run: runPropostaItemSync, contarRegistros: () => prisma.propostaItem.count() },
  { jobName: CONSULTOR_JOB, displayName: "Consultores", cronExpr: CONSULTOR_CRON, suportaAlterados: CONSULTOR_DATA != null, campoData: CONSULTOR_DATA, ...catalogo(CONSULTOR_JOB, CONSULTOR_QUERY, "consultores"), run: runConsultorSync, contarRegistros: () => prisma.consultor.count() },
  // Contrato/valor-hora do consultor (dashboard inicial, 17/08/2026) — mesma chave de
  // Consultor, sem FK formal (mesmo espírito de casamento por valor do resto do projeto).
  { jobName: CONTRATO_CONSULTOR_JOB, displayName: "Contratos de Consultores (Valor-hora)", cronExpr: CONTRATO_CONSULTOR_CRON, suportaAlterados: CONTRATO_CONSULTOR_DATA != null, campoData: CONTRATO_CONSULTOR_DATA, ...catalogo(CONTRATO_CONSULTOR_JOB, CONTRATO_CONSULTOR_QUERY, "contratos_consultores"), run: runContratoConsultorSync, contarRegistros: () => prisma.contratoConsultor.count() },
  { jobName: DEPARTAMENTO_GESTOR_JOB, displayName: "Gestores de Departamento", cronExpr: DEPARTAMENTO_GESTOR_CRON, suportaAlterados: DEPARTAMENTO_GESTOR_DATA != null, campoData: DEPARTAMENTO_GESTOR_DATA, ...catalogo(DEPARTAMENTO_GESTOR_JOB, DEPARTAMENTO_GESTOR_QUERY, "departamentos_gestores"), run: runDepartamentoGestorSync, contarRegistros: () => prisma.departamentoGestor.count() },
  { jobName: DEPARTAMENTO_TIME_JOB, displayName: "Time por Departamento", cronExpr: DEPARTAMENTO_TIME_CRON, suportaAlterados: DEPARTAMENTO_TIME_DATA != null, campoData: DEPARTAMENTO_TIME_DATA, ...catalogo(DEPARTAMENTO_TIME_JOB, DEPARTAMENTO_TIME_QUERY, "departamento_time"), run: runDepartamentoTimeSync, contarRegistros: () => prisma.departamentoTime.count() },
  // FaseProposta roda antes de AtividadeConsultor: AtividadeConsultor.fasid é FK pra fases_proposta.
  { jobName: FASE_PROPOSTA_JOB, displayName: "Fases de Proposta", cronExpr: FASE_PROPOSTA_CRON, suportaAlterados: FASE_PROPOSTA_DATA != null, campoData: FASE_PROPOSTA_DATA, ...catalogo(FASE_PROPOSTA_JOB, FASE_PROPOSTA_QUERY, "fases_proposta"), run: runFasePropostaSync, contarRegistros: () => prisma.faseProposta.count() },
  { jobName: ATIVIDADE_CONSULTOR_JOB, displayName: "Atividades por Consultor", cronExpr: ATIVIDADE_CONSULTOR_CRON, suportaAlterados: ATIVIDADE_CONSULTOR_DATA != null, campoData: ATIVIDADE_CONSULTOR_DATA, ...catalogo(ATIVIDADE_CONSULTOR_JOB, ATIVIDADE_CONSULTOR_QUERY, "atividades_consultor"), run: runAtividadeConsultorSync, contarRegistros: () => prisma.atividadeConsultor.count() },
  { jobName: RAT_JOB, displayName: "RATs (Cabeçalho)", cronExpr: RAT_CRON, suportaAlterados: RAT_DATA != null, campoData: RAT_DATA, ...catalogo(RAT_JOB, RAT_QUERY, "rats"), run: runRatSync, contarRegistros: () => prisma.rat.count() },
  // RatItem roda depois de Rat: RatItem.ratId é resolvido casando (codemp, numrat, codpro) contra Rat já sincronizado.
  { jobName: RAT_ITEM_JOB, displayName: "Itens de RAT (Apontamentos)", cronExpr: RAT_ITEM_CRON, suportaAlterados: RAT_ITEM_DATA != null, campoData: RAT_ITEM_DATA, ...catalogo(RAT_ITEM_JOB, RAT_ITEM_QUERY, "rat_itens"), run: runRatItemSync, contarRegistros: () => prisma.ratItem.count() },
  // Pedido.numrat é só um valor espelhado (campo customizado do Senior), sem resolução de FK no sync — não depende de nenhum job acima.
  // Piloto da detecção de exclusão no Senior — por enquanto o único job com contarRemovidos/
  // listarRemovidos preenchidos (ver sync/politicaVarredura.ts pro modo atual).
  {
    jobName: PEDIDO_JOB,
    displayName: "Pedidos",
    cronExpr: PEDIDO_CRON,
    suportaAlterados: PEDIDO_DATA != null, campoData: PEDIDO_DATA,
    ...catalogo(PEDIDO_JOB, PEDIDO_QUERY, "pedidos"),
    run: runPedidoSync,
    contarRegistros: () => prisma.pedido.count(),
    contarRemovidos: () => prisma.pedido.count({ where: { removidoEmSenior: { not: null } } }),
    listarRemovidos: async (limite, candidatosDesde) => {
      const pedidos = await prisma.pedido.findMany({
        where: candidatosDesde
          ? // Marcados + os que a varredura marcaria agora (útil em modo "simular", onde
            // os primeiros não existem). O `lt` estrito ignora carimbo NULL, então
            // registro nascido fora do sync nunca entra nesta lista.
            { OR: [{ removidoEmSenior: { not: null } }, { vistoEmSync: { lt: candidatosDesde } }] }
          : { removidoEmSenior: { not: null } },
        orderBy: [{ removidoEmSenior: "desc" }, { numped: "desc" }],
        take: limite,
        select: { codemp: true, codfil: true, numped: true, codcli: true, datemi: true, removidoEmSenior: true },
      });
      return pedidos.map((p) => ({
        chave: `${p.codemp}/${p.codfil}/${p.numped}`,
        rotulo: `Pedido ${p.numped} — cliente ${p.codcli}, emissão ${p.datemi.toISOString().slice(0, 10)}`,
        removidoEmSenior: p.removidoEmSenior,
        marcado: p.removidoEmSenior != null,
      }));
    },
  },
  { jobName: FORMA_PAGAMENTO_JOB, displayName: "Formas de Pagamento", cronExpr: FORMA_PAGAMENTO_CRON, suportaAlterados: FORMA_PAGAMENTO_DATA != null, campoData: FORMA_PAGAMENTO_DATA, ...catalogo(FORMA_PAGAMENTO_JOB, FORMA_PAGAMENTO_QUERY, "formas_pagamento"), run: runFormaPagamentoSync, contarRegistros: () => prisma.formaPagamento.count() },
  { jobName: CONDICAO_PAGAMENTO_JOB, displayName: "Condições de Pagamento", cronExpr: CONDICAO_PAGAMENTO_CRON, suportaAlterados: CONDICAO_PAGAMENTO_DATA != null, campoData: CONDICAO_PAGAMENTO_DATA, ...catalogo(CONDICAO_PAGAMENTO_JOB, CONDICAO_PAGAMENTO_QUERY, "condicoes_pagamento"), run: runCondicaoPagamentoSync, contarRegistros: () => prisma.condicaoPagamento.count() },
  // Tabelas de Contábil/Orçamento (e045pla/e640lct/e640rat/e650rto), identificadas a partir de
  // uma SQL de BI (11/08/2026). Sem dependência das tabelas acima — PlanoContabil não depende
  // de nada novo; RateioLancamento depende de LancamentoContabil já carregado; OrcamentoContabil
  // é independente das demais. (e043pcm/PlanoContabilParalelo foi avaliada e removida em
  // 12/08/2026 — não era necessária.)
  { jobName: PLANO_CONTABIL_JOB, displayName: "Plano Contábil", cronExpr: PLANO_CONTABIL_CRON, suportaAlterados: PLANO_CONTABIL_DATA != null, campoData: PLANO_CONTABIL_DATA, ...catalogo(PLANO_CONTABIL_JOB, PLANO_CONTABIL_QUERY, "plano_contabil"), run: runPlanoContabilSync, contarRegistros: () => prisma.planoContabil.count() },
  // Detecção de exclusão física ligada em 20/08/2026 a pedido do Vitor (rateio/lançamento
  // tem manutenção pesada no Senior, ver lancamentoContabilSync.ts) — rodando em "simular"
  // (politicaVarredura.ts). `contarRemovidos`/`listarRemovidos` (adicionados 22/08/2026, só
  // pra ligar a VISIBILIDADE na tela — o mecanismo em si já rodava) seguem o mesmo padrão de
  // PEDIDO_JOB acima, único outro precedente.
  {
    jobName: LANCAMENTO_CONTABIL_JOB,
    displayName: "Lançamentos Contábeis",
    cronExpr: LANCAMENTO_CONTABIL_CRON,
    suportaAlterados: LANCAMENTO_CONTABIL_DATA != null, campoData: LANCAMENTO_CONTABIL_DATA,
    ...catalogo(LANCAMENTO_CONTABIL_JOB, LANCAMENTO_CONTABIL_QUERY, "lancamentos_contabeis"),
    run: runLancamentoContabilSync,
    contarRegistros: () => prisma.lancamentoContabil.count(),
    contarRemovidos: () => prisma.lancamentoContabil.count({ where: { removidoEmSenior: { not: null } } }),
    listarRemovidos: async (limite, candidatosDesde) => {
      const linhas = await prisma.lancamentoContabil.findMany({
        where: candidatosDesde
          ? { OR: [{ removidoEmSenior: { not: null } }, { vistoEmSync: { lt: candidatosDesde } }] }
          : { removidoEmSenior: { not: null } },
        orderBy: [{ removidoEmSenior: "desc" }, { numlct: "desc" }],
        take: limite,
        select: { codemp: true, numlct: true, sitlct: true, orilct: true, cpllct: true, removidoEmSenior: true },
      });
      return linhas.map((l) => ({
        chave: `${l.codemp}/${l.numlct}`,
        rotulo: `Lançamento ${l.numlct} — ${SITUACAO_LANCAMENTO[l.sitlct] ?? l.sitlct}, origem ${l.orilct}${l.cpllct ? ` (${l.cpllct})` : ""}`,
        removidoEmSenior: l.removidoEmSenior,
        marcado: l.removidoEmSenior != null,
      }));
    },
  },
  // RateioLancamento roda depois de Lançamentos Contábeis: é o detalhe do lançamento. Mesma
  // detecção de exclusão física ligada em 20/08/2026, mesma visibilidade adicionada agora.
  {
    jobName: RATEIO_LANCAMENTO_JOB,
    displayName: "Rateios de Lançamento",
    cronExpr: RATEIO_LANCAMENTO_CRON,
    suportaAlterados: RATEIO_LANCAMENTO_DATA != null, campoData: RATEIO_LANCAMENTO_DATA,
    ...catalogo(RATEIO_LANCAMENTO_JOB, RATEIO_LANCAMENTO_QUERY, "rateios_lancamento"),
    run: runRateioLancamentoSync,
    contarRegistros: () => prisma.rateioLancamento.count(),
    contarRemovidos: () => prisma.rateioLancamento.count({ where: { removidoEmSenior: { not: null } } }),
    listarRemovidos: async (limite, candidatosDesde) => {
      const linhas = await prisma.rateioLancamento.findMany({
        where: candidatosDesde
          ? { OR: [{ removidoEmSenior: { not: null } }, { vistoEmSync: { lt: candidatosDesde } }] }
          : { removidoEmSenior: { not: null } },
        orderBy: [{ removidoEmSenior: "desc" }, { numlct: "desc" }],
        take: limite,
        select: { codemp: true, numlct: true, ctared: true, codccu: true, debcre: true, vlrrat: true, sitrat: true, removidoEmSenior: true },
      });
      return linhas.map((r) => ({
        chave: `${r.codemp}/${r.numlct}/${r.ctared}/${r.codccu}`,
        rotulo: `Rateio do lançamento ${r.numlct} — conta ${r.ctared}, CC ${r.codccu}, ${
          r.debcre === "D" ? "débito" : r.debcre === "C" ? "crédito" : "?"
        } R$ ${Number(r.vlrrat).toFixed(2)} (${SITUACAO_LANCAMENTO[r.sitrat] ?? r.sitrat})`,
        removidoEmSenior: r.removidoEmSenior,
        marcado: r.removidoEmSenior != null,
      }));
    },
  },
  { jobName: ORCAMENTO_CONTABIL_JOB, displayName: "Orçamentos Contábeis", cronExpr: ORCAMENTO_CONTABIL_CRON, suportaAlterados: ORCAMENTO_CONTABIL_DATA != null, campoData: ORCAMENTO_CONTABIL_DATA, ...catalogo(ORCAMENTO_CONTABIL_JOB, ORCAMENTO_CONTABIL_QUERY, "orcamentos_contabeis"), run: runOrcamentoContabilSync, contarRegistros: () => prisma.orcamentoContabil.count() },
  // Despesas de viagem lançadas em RAT (USU_TE777RDV) + catálogo de rotas/percursos,
  // identificadas a pedido do Vitor em 13/08/2026. Sem dependência das tabelas acima — RDV
  // referencia Rat só por valor (codemp+numrat), sem FK formal. Rota/Percurso rodam antes da
  // junção só por organização (RotaPercurso não tem FK formal também, a ordem não é exigida).
  { jobName: ROTA_VIAGEM_JOB, displayName: "Rotas de Viagem", cronExpr: ROTA_VIAGEM_CRON, suportaAlterados: ROTA_VIAGEM_DATA != null, campoData: ROTA_VIAGEM_DATA, ...catalogo(ROTA_VIAGEM_JOB, ROTA_VIAGEM_QUERY, "rotas_viagem"), run: runRotaViagemSync, contarRegistros: () => prisma.rotaViagem.count() },
  { jobName: PERCURSO_VIAGEM_JOB, displayName: "Percursos de Viagem", cronExpr: PERCURSO_VIAGEM_CRON, suportaAlterados: PERCURSO_VIAGEM_DATA != null, campoData: PERCURSO_VIAGEM_DATA, ...catalogo(PERCURSO_VIAGEM_JOB, PERCURSO_VIAGEM_QUERY, "percursos_viagem"), run: runPercursoViagemSync, contarRegistros: () => prisma.percursoViagem.count() },
  { jobName: ROTA_PERCURSO_JOB, displayName: "Rotas x Percursos", cronExpr: ROTA_PERCURSO_CRON, suportaAlterados: ROTA_PERCURSO_DATA != null, campoData: ROTA_PERCURSO_DATA, ...catalogo(ROTA_PERCURSO_JOB, ROTA_PERCURSO_QUERY, "rotas_percursos"), run: runRotaPercursoSync, contarRegistros: () => prisma.rotaPercurso.count() },
  { jobName: REGISTRO_DESPESA_VIAGEM_JOB, displayName: "Despesas de Viagem (RAT)", cronExpr: REGISTRO_DESPESA_VIAGEM_CRON, suportaAlterados: REGISTRO_DESPESA_VIAGEM_DATA != null, campoData: REGISTRO_DESPESA_VIAGEM_DATA, ...catalogo(REGISTRO_DESPESA_VIAGEM_JOB, REGISTRO_DESPESA_VIAGEM_QUERY, "registros_despesa_viagem"), run: runRegistroDespesaViagemSync, contarRegistros: () => prisma.registroDespesaViagem.count() },
];
