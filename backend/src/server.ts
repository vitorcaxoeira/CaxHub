import "dotenv/config";
import express from "express";
import { garantirDiretorioUploads, AVATARS_DIR } from "./config/uploads";
import { authRouter } from "./auth/routes";
import { perfilRouter } from "./routes/perfil";
import { dashboardRouter } from "./routes/dashboard";
import { financeiroRouter } from "./routes/financeiro";
import { recebimentosRouter } from "./routes/recebimentos";
import { inadimplenciaRouter } from "./routes/inadimplencia";
import { clientesFinanceiroRouter } from "./routes/clientesFinanceiro";
import { fluxoCaixaRouter } from "./routes/fluxoCaixa";
import { historicoFinanceiroRouter } from "./routes/historicoFinanceiro";
import { projetosRouter } from "./routes/projetos";
import { atividadesRouter } from "./routes/atividades";
import { apontamentosRouter } from "./routes/apontamentos";
import { ratsRouter } from "./routes/rats";
import { pedidosRouter } from "./routes/pedidos";
import { pedidoVisualizacaoRouter } from "./routes/pedidoVisualizacao";
import { ratVisualizacaoRouter } from "./routes/ratVisualizacao";
import { notificacoesRouter } from "./routes/notificacoes";
import { usersRouter } from "./routes/users";
import { sincronizacaoRouter } from "./routes/sincronizacao";
import { syncErpRouter } from "./routes/syncErp";
import { alocacaoRouter } from "./routes/alocacao";
import { solicitacoesExcedenteRouter } from "./routes/solicitacoesExcedente";
import { solicitacoesApontamentoRouter } from "./routes/solicitacoesApontamento";
import { jornadasRouter } from "./routes/jornadas";
import { propostaVisualizacaoRouter } from "./routes/propostaVisualizacao";
import { auditoriaRouter } from "./routes/auditoria";
import { attachCorrelationId } from "./audit/correlationId";
import { scheduleEmpresaSync } from "./sync/empresaSync";
import { scheduleFilialSync } from "./sync/filialSync";
import { scheduleClienteSync } from "./sync/clienteSync";
import { scheduleTipoTituloSync } from "./sync/tipoTituloSync";
import { scheduleTituloReceberSync } from "./sync/tituloReceberSync";
import { scheduleMovimentoTituloReceberSync } from "./sync/movimentoTituloReceberSync";
import { scheduleRepresentanteSync } from "./sync/representanteSync";
import { scheduleCentroCustoSync } from "./sync/centroCustoSync";
import { scheduleMovimentoContaSync } from "./sync/movimentoContaSync";
import { scheduleNaturezaFinanceiraSync } from "./sync/naturezaFinanceiraSync";
import { schedulePortadorSync } from "./sync/portadorSync";
import { scheduleMoedaSync } from "./sync/moedaSync";
import { scheduleContaCorrenteSync } from "./sync/contaCorrenteSync";
import { scheduleTransacaoSync } from "./sync/transacaoSync";
import { schedulePropostaSync } from "./sync/propostaSync";
import { schedulePropostaItemSync } from "./sync/propostaItemSync";
import { scheduleConsultorSync } from "./sync/consultorSync";
import { scheduleDepartamentoGestorSync } from "./sync/departamentoGestorSync";
import { scheduleDepartamentoTimeSync } from "./sync/departamentoTimeSync";
import { scheduleAtividadeConsultorSync } from "./sync/atividadeConsultorSync";
import { scheduleFasePropostaSync } from "./sync/fasePropostaSync";
import { scheduleRatSync } from "./sync/ratSync";
import { scheduleRatItemSync } from "./sync/ratItemSync";
import { schedulePedidoSync } from "./sync/pedidoSync";
import { scheduleFormaPagamentoSync } from "./sync/formaPagamentoSync";
import { scheduleCondicaoPagamentoSync } from "./sync/condicaoPagamentoSync";
import { scheduleOutboxSeniorSync } from "./sync/outboxSenior";
import { agendarParadaAutomatica } from "./sync/pararExecucoesAutomaticamente";

garantirDiretorioUploads();

const app = express();
app.use(express.json());
app.use(attachCorrelationId);

// Única pasta de upload servida como estático — sem requireAuth de propósito, avatar
// precisa carregar via <img src> puro (sem header Authorization). Cache-busting vem da
// query string `?v=timestamp` gravada em User.fotoUrl a cada troca, não de headers HTTP.
app.use("/uploads/avatars", express.static(AVATARS_DIR));

app.use("/auth", authRouter);
app.use("/perfil", perfilRouter);
app.use("/dashboard", dashboardRouter);
app.use("/financeiro", financeiroRouter);
app.use("/financeiro/recebimentos", recebimentosRouter);
app.use("/financeiro/inadimplencia", inadimplenciaRouter);
app.use("/financeiro/clientes", clientesFinanceiroRouter);
app.use("/financeiro/fluxo-caixa", fluxoCaixaRouter);
app.use("/financeiro/historico", historicoFinanceiroRouter);
app.use("/projetos", projetosRouter);
app.use("/atividades", atividadesRouter);
app.use("/apontamentos", apontamentosRouter);
app.use("/rats", ratsRouter);
app.use("/pedidos", pedidosRouter);
app.use("/pedido-visualizacao", pedidoVisualizacaoRouter);
app.use("/rat-visualizacao", ratVisualizacaoRouter);
app.use("/notificacoes", notificacoesRouter);
app.use("/users", usersRouter);
app.use("/sincronizacao", sincronizacaoRouter);
app.use("/sync-erp", syncErpRouter);
app.use("/alocacao", alocacaoRouter);
app.use("/solicitacoes-excedente", solicitacoesExcedenteRouter);
app.use("/solicitacoes-apontamento", solicitacoesApontamentoRouter);
app.use("/jornadas", jornadasRouter);
app.use("/proposta-visualizacao", propostaVisualizacaoRouter);
app.use("/auditoria", auditoriaRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

app.listen(port, () => {
  console.log(`CaxHub backend rodando na porta ${port}`);
  // Mesma ordem de dependência do registry (sync/registry.ts) — ver lá o porquê de
  // Portador e Transação virem antes dos Títulos.
  scheduleEmpresaSync();
  scheduleFilialSync();
  scheduleClienteSync();
  scheduleTipoTituloSync();
  schedulePortadorSync();
  scheduleTransacaoSync();
  scheduleTituloReceberSync();
  scheduleMovimentoTituloReceberSync();
  scheduleRepresentanteSync();
  scheduleCentroCustoSync();
  scheduleMovimentoContaSync();
  scheduleNaturezaFinanceiraSync();
  scheduleMoedaSync();
  scheduleContaCorrenteSync();
  schedulePropostaSync();
  schedulePropostaItemSync();
  scheduleConsultorSync();
  scheduleDepartamentoGestorSync();
  scheduleDepartamentoTimeSync();
  scheduleFasePropostaSync();
  scheduleAtividadeConsultorSync();
  scheduleRatSync();
  scheduleRatItemSync();
  schedulePedidoSync();
  scheduleFormaPagamentoSync();
  scheduleCondicaoPagamentoSync();
  scheduleOutboxSeniorSync();
  // Não é sync com o Senior: fecha sessão de execução que passou do teto de horas.
  agendarParadaAutomatica();
});
