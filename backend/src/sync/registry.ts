// Catálogo central dos jobs de sincronização Senior -> CaxHub. Cada job já tem seu
// próprio agendamento (scheduleXSync) registrado em server.ts, inalterado — este
// registry existe só pra alimentar a tela de administração (Administração >
// Sincronização ERP): nome de exibição, horário (mesma constante usada no
// cron.schedule de cada arquivo, sem duplicar o valor) e se aceita sincronizar só os
// alterados (campo de data de geração/alteração existe no dicionário do Senior).
import { JOB_NAME as ATIVIDADE_CONSULTOR_JOB, CRON_EXPR as ATIVIDADE_CONSULTOR_CRON, CAMPO_DATA as ATIVIDADE_CONSULTOR_DATA, runAtividadeConsultorSync } from "./atividadeConsultorSync";
import { JOB_NAME as CENTRO_CUSTO_JOB, CRON_EXPR as CENTRO_CUSTO_CRON, CAMPO_DATA as CENTRO_CUSTO_DATA, runCentroCustoSync } from "./centroCustoSync";
import { JOB_NAME as CLIENTE_JOB, CRON_EXPR as CLIENTE_CRON, CAMPO_DATA as CLIENTE_DATA, runClienteSync } from "./clienteSync";
import { JOB_NAME as CONSULTOR_JOB, CRON_EXPR as CONSULTOR_CRON, CAMPO_DATA as CONSULTOR_DATA, runConsultorSync } from "./consultorSync";
import { JOB_NAME as CONTA_CORRENTE_JOB, CRON_EXPR as CONTA_CORRENTE_CRON, CAMPO_DATA as CONTA_CORRENTE_DATA, runContaCorrenteSync } from "./contaCorrenteSync";
import { JOB_NAME as DEPARTAMENTO_GESTOR_JOB, CRON_EXPR as DEPARTAMENTO_GESTOR_CRON, CAMPO_DATA as DEPARTAMENTO_GESTOR_DATA, runDepartamentoGestorSync } from "./departamentoGestorSync";
import { JOB_NAME as DEPARTAMENTO_TIME_JOB, CRON_EXPR as DEPARTAMENTO_TIME_CRON, CAMPO_DATA as DEPARTAMENTO_TIME_DATA, runDepartamentoTimeSync } from "./departamentoTimeSync";
import { JOB_NAME as EMPRESA_JOB, CRON_EXPR as EMPRESA_CRON, CAMPO_DATA as EMPRESA_DATA, runEmpresaSync } from "./empresaSync";
import { JOB_NAME as FASE_PROPOSTA_JOB, CRON_EXPR as FASE_PROPOSTA_CRON, CAMPO_DATA as FASE_PROPOSTA_DATA, runFasePropostaSync } from "./fasePropostaSync";
import { JOB_NAME as FILIAL_JOB, CRON_EXPR as FILIAL_CRON, CAMPO_DATA as FILIAL_DATA, runFilialSync } from "./filialSync";
import { JOB_NAME as MOEDA_JOB, CRON_EXPR as MOEDA_CRON, CAMPO_DATA as MOEDA_DATA, runMoedaSync } from "./moedaSync";
import { JOB_NAME as MOVIMENTO_CONTA_JOB, CRON_EXPR as MOVIMENTO_CONTA_CRON, CAMPO_DATA as MOVIMENTO_CONTA_DATA, runMovimentoContaSync } from "./movimentoContaSync";
import { JOB_NAME as MOVIMENTO_TITULO_JOB, CRON_EXPR as MOVIMENTO_TITULO_CRON, CAMPO_DATA as MOVIMENTO_TITULO_DATA, runMovimentoTituloReceberSync } from "./movimentoTituloReceberSync";
import { JOB_NAME as NATUREZA_FINANCEIRA_JOB, CRON_EXPR as NATUREZA_FINANCEIRA_CRON, CAMPO_DATA as NATUREZA_FINANCEIRA_DATA, runNaturezaFinanceiraSync } from "./naturezaFinanceiraSync";
import { JOB_NAME as PORTADOR_JOB, CRON_EXPR as PORTADOR_CRON, CAMPO_DATA as PORTADOR_DATA, runPortadorSync } from "./portadorSync";
import { JOB_NAME as PROPOSTA_ITEM_JOB, CRON_EXPR as PROPOSTA_ITEM_CRON, CAMPO_DATA as PROPOSTA_ITEM_DATA, runPropostaItemSync } from "./propostaItemSync";
import { JOB_NAME as PROPOSTA_JOB, CRON_EXPR as PROPOSTA_CRON, CAMPO_DATA as PROPOSTA_DATA, runPropostaSync } from "./propostaSync";
import { JOB_NAME as REPRESENTANTE_JOB, CRON_EXPR as REPRESENTANTE_CRON, CAMPO_DATA as REPRESENTANTE_DATA, runRepresentanteSync } from "./representanteSync";
import { JOB_NAME as TIPO_TITULO_JOB, CRON_EXPR as TIPO_TITULO_CRON, CAMPO_DATA as TIPO_TITULO_DATA, runTipoTituloSync } from "./tipoTituloSync";
import { JOB_NAME as TITULO_RECEBER_JOB, CRON_EXPR as TITULO_RECEBER_CRON, CAMPO_DATA as TITULO_RECEBER_DATA, runTituloReceberSync } from "./tituloReceberSync";
import { JOB_NAME as TRANSACAO_JOB, CRON_EXPR as TRANSACAO_CRON, CAMPO_DATA as TRANSACAO_DATA, runTransacaoSync } from "./transacaoSync";

export interface SyncJobDescriptor {
  jobName: string;
  displayName: string;
  cronExpr: string;
  suportaAlterados: boolean;
  run: (desde?: Date) => Promise<void>;
}

export const SYNC_JOBS: SyncJobDescriptor[] = [
  { jobName: EMPRESA_JOB, displayName: "Empresas", cronExpr: EMPRESA_CRON, suportaAlterados: EMPRESA_DATA != null, run: runEmpresaSync },
  { jobName: FILIAL_JOB, displayName: "Filiais", cronExpr: FILIAL_CRON, suportaAlterados: FILIAL_DATA != null, run: runFilialSync },
  { jobName: CLIENTE_JOB, displayName: "Clientes", cronExpr: CLIENTE_CRON, suportaAlterados: CLIENTE_DATA != null, run: runClienteSync },
  { jobName: TIPO_TITULO_JOB, displayName: "Tipos de Título", cronExpr: TIPO_TITULO_CRON, suportaAlterados: TIPO_TITULO_DATA != null, run: runTipoTituloSync },
  { jobName: TITULO_RECEBER_JOB, displayName: "Títulos a Receber", cronExpr: TITULO_RECEBER_CRON, suportaAlterados: TITULO_RECEBER_DATA != null, run: runTituloReceberSync },
  { jobName: MOVIMENTO_TITULO_JOB, displayName: "Movimentos de Títulos a Receber", cronExpr: MOVIMENTO_TITULO_CRON, suportaAlterados: MOVIMENTO_TITULO_DATA != null, run: runMovimentoTituloReceberSync },
  { jobName: REPRESENTANTE_JOB, displayName: "Representantes", cronExpr: REPRESENTANTE_CRON, suportaAlterados: REPRESENTANTE_DATA != null, run: runRepresentanteSync },
  { jobName: CENTRO_CUSTO_JOB, displayName: "Centros de Custo", cronExpr: CENTRO_CUSTO_CRON, suportaAlterados: CENTRO_CUSTO_DATA != null, run: runCentroCustoSync },
  { jobName: MOVIMENTO_CONTA_JOB, displayName: "Movimentos de Conta", cronExpr: MOVIMENTO_CONTA_CRON, suportaAlterados: MOVIMENTO_CONTA_DATA != null, run: runMovimentoContaSync },
  { jobName: NATUREZA_FINANCEIRA_JOB, displayName: "Naturezas Financeiras", cronExpr: NATUREZA_FINANCEIRA_CRON, suportaAlterados: NATUREZA_FINANCEIRA_DATA != null, run: runNaturezaFinanceiraSync },
  { jobName: PORTADOR_JOB, displayName: "Portadores", cronExpr: PORTADOR_CRON, suportaAlterados: PORTADOR_DATA != null, run: runPortadorSync },
  { jobName: MOEDA_JOB, displayName: "Moedas", cronExpr: MOEDA_CRON, suportaAlterados: MOEDA_DATA != null, run: runMoedaSync },
  { jobName: CONTA_CORRENTE_JOB, displayName: "Contas Correntes", cronExpr: CONTA_CORRENTE_CRON, suportaAlterados: CONTA_CORRENTE_DATA != null, run: runContaCorrenteSync },
  { jobName: TRANSACAO_JOB, displayName: "Transações", cronExpr: TRANSACAO_CRON, suportaAlterados: TRANSACAO_DATA != null, run: runTransacaoSync },
  { jobName: PROPOSTA_JOB, displayName: "Propostas", cronExpr: PROPOSTA_CRON, suportaAlterados: PROPOSTA_DATA != null, run: runPropostaSync },
  { jobName: PROPOSTA_ITEM_JOB, displayName: "Itens de Proposta", cronExpr: PROPOSTA_ITEM_CRON, suportaAlterados: PROPOSTA_ITEM_DATA != null, run: runPropostaItemSync },
  { jobName: CONSULTOR_JOB, displayName: "Consultores", cronExpr: CONSULTOR_CRON, suportaAlterados: CONSULTOR_DATA != null, run: runConsultorSync },
  { jobName: DEPARTAMENTO_GESTOR_JOB, displayName: "Gestores de Departamento", cronExpr: DEPARTAMENTO_GESTOR_CRON, suportaAlterados: DEPARTAMENTO_GESTOR_DATA != null, run: runDepartamentoGestorSync },
  { jobName: DEPARTAMENTO_TIME_JOB, displayName: "Time por Departamento", cronExpr: DEPARTAMENTO_TIME_CRON, suportaAlterados: DEPARTAMENTO_TIME_DATA != null, run: runDepartamentoTimeSync },
  { jobName: ATIVIDADE_CONSULTOR_JOB, displayName: "Atividades por Consultor", cronExpr: ATIVIDADE_CONSULTOR_CRON, suportaAlterados: ATIVIDADE_CONSULTOR_DATA != null, run: runAtividadeConsultorSync },
  { jobName: FASE_PROPOSTA_JOB, displayName: "Fases de Proposta", cronExpr: FASE_PROPOSTA_CRON, suportaAlterados: FASE_PROPOSTA_DATA != null, run: runFasePropostaSync },
];
