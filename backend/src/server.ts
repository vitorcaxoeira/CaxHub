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
import { contabilRouter } from "./routes/contabil";
import { projetosRouter } from "./routes/projetos";
import { atividadesRouter } from "./routes/atividades";
import { apontamentosRouter } from "./routes/apontamentos";
import { ratsRouter } from "./routes/rats";
import { pedidosRouter } from "./routes/pedidos";
import { analiseFaturamentoRouter } from "./routes/analiseFaturamento";
import { pedidoVisualizacaoRouter } from "./routes/pedidoVisualizacao";
import { ratVisualizacaoRouter } from "./routes/ratVisualizacao";
import { notificacoesRouter } from "./routes/notificacoes";
import { usersRouter } from "./routes/users";
import { sincronizacaoRouter } from "./routes/sincronizacao";
import { syncErpRouter } from "./routes/syncErp";
import { alocacaoRouter } from "./routes/alocacao";
import { solicitacoesExcedenteRouter } from "./routes/solicitacoesExcedente";
import { solicitacoesApontamentoRouter } from "./routes/solicitacoesApontamento";
import { solicitacoesAjusteRouter } from "./routes/solicitacoesAjuste";
import { solicitacoesConfigPropostaRouter } from "./routes/solicitacoesConfigProposta";
import { jornadasRouter } from "./routes/jornadas";
import { propostaVisualizacaoRouter } from "./routes/propostaVisualizacao";
import { auditoriaRouter } from "./routes/auditoria";
import { painelTvRouter } from "./routes/painelTv";
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
import { scheduleContratoConsultorSync } from "./sync/contratoConsultorSync";
import { scheduleDepartamentoGestorSync } from "./sync/departamentoGestorSync";
import { scheduleDepartamentoTimeSync } from "./sync/departamentoTimeSync";
import { scheduleAtividadeConsultorSync } from "./sync/atividadeConsultorSync";
import { scheduleFasePropostaSync } from "./sync/fasePropostaSync";
import { scheduleRatSync } from "./sync/ratSync";
import { scheduleRatItemSync } from "./sync/ratItemSync";
import { schedulePedidoSync } from "./sync/pedidoSync";
import { scheduleFormaPagamentoSync } from "./sync/formaPagamentoSync";
import { scheduleCondicaoPagamentoSync } from "./sync/condicaoPagamentoSync";
import { schedulePlanoContabilSync } from "./sync/planoContabilSync";
import { scheduleLancamentoContabilSync } from "./sync/lancamentoContabilSync";
import { scheduleRateioLancamentoSync } from "./sync/rateioLancamentoSync";
import { scheduleHistoricoPadraoSync } from "./sync/historicoPadraoSync";
import { scheduleOrcamentoContabilSync } from "./sync/orcamentoContabilSync";
import { scheduleRegistroDespesaViagemSync } from "./sync/registroDespesaViagemSync";
import { scheduleRotaViagemSync } from "./sync/rotaViagemSync";
import { schedulePercursoViagemSync } from "./sync/percursoViagemSync";
import { scheduleRotaPercursoSync } from "./sync/rotaPercursoSync";
import { scheduleProdutoSync } from "./sync/produtoSync";
import { scheduleDerivacaoProdutoSync } from "./sync/derivacaoProdutoSync";
import { scheduleServicoSync } from "./sync/servicoSync";
import { scheduleNotaFiscalVendaSync } from "./sync/notaFiscalVendaSync";
import { scheduleItemServicoNfVendaSync } from "./sync/itemServicoNfVendaSync";
import { scheduleItemProdutoNfVendaSync } from "./sync/itemProdutoNfVendaSync";
import { scheduleRateioNfVendaSync } from "./sync/rateioNfVendaSync";
import { scheduleMetaAnualSync } from "./sync/metaAnualSync";
import { scheduleOutboxSeniorSync } from "./sync/outboxSenior";
import { agendarParadaAutomatica } from "./sync/pararExecucoesAutomaticamente";
import { agendarParadaPorFechamento } from "./sync/pararSessoesAoFecharPagina";
import { carregarFiltrosAtivos } from "./sync/filtrosAtivos";
import { SYNC_JOBS } from "./sync/registry";

garantirDiretorioUploads();

const app = express();
// Desliga o ETag automático do Express pra API — com ele, o navegador guarda cada resposta
// autenticada e revalida via If-None-Match, e o servidor então responde 304 SEM recalcular
// headers como X-Renewed-Token (29/08/2026, incidente em produção: ver o middleware no-store
// logo abaixo pro porquê disso quebrava sessão de verdade). express.static (avatares) gera o
// próprio ETag por fora, não é afetado.
app.set("etag", false);
app.use(express.json());
app.use(attachCorrelationId);

// Única pasta de upload servida como estático — sem requireAuth de propósito, avatar
// precisa carregar via <img src> puro (sem header Authorization). Cache-busting vem da
// query string `?v=timestamp` gravada em User.fotoUrl a cada troca, não de headers HTTP.
app.use("/uploads/avatars", express.static(AVATARS_DIR));

// INCIDENTE EM PRODUÇÃO (29/08/2026): toda resposta JSON da API saía com ETag e sem
// Cache-Control — o Chrome cacheava, e ao revalidar (If-None-Match) o servidor respondia 304
// sem reemitir X-Renewed-Token. O navegador então entregava ao JS a resposta ARMAZENADA,
// headers antigos inclusos — o interceptor de renovação por deslizamento (AuthContext.tsx)
// achava um X-Renewed-Token de HORAS atrás, já expirado (ou de outra sessão, no caso do menu
// vazando pra conta errada), e sobrescrevia o token válido por ele. Próxima /auth/me: 401,
// auto-logout. Reproduzível sempre que /api/atividades/minha-sessao-aberta (corpo estável,
// consultado em toda tela por VigiaFimDeJornada.tsx) batia 304 logo depois do login. Nenhuma
// resposta de API deve ir pro cache do navegador — cada uma é específica da sessão que a pediu.
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use("/auth", authRouter);
app.use("/perfil", perfilRouter);
app.use("/dashboard", dashboardRouter);
app.use("/financeiro", financeiroRouter);
app.use("/financeiro/recebimentos", recebimentosRouter);
app.use("/financeiro/inadimplencia", inadimplenciaRouter);
app.use("/financeiro/clientes", clientesFinanceiroRouter);
app.use("/financeiro/fluxo-caixa", fluxoCaixaRouter);
app.use("/financeiro/historico", historicoFinanceiroRouter);
app.use("/contabil", contabilRouter);
app.use("/projetos", projetosRouter);
app.use("/atividades", atividadesRouter);
app.use("/apontamentos", apontamentosRouter);
app.use("/rats", ratsRouter);
app.use("/pedidos", pedidosRouter);
app.use("/analise-faturamento", analiseFaturamentoRouter);
app.use("/pedido-visualizacao", pedidoVisualizacaoRouter);
app.use("/rat-visualizacao", ratVisualizacaoRouter);
app.use("/notificacoes", notificacoesRouter);
app.use("/users", usersRouter);
app.use("/sincronizacao", sincronizacaoRouter);
app.use("/sync-erp", syncErpRouter);
app.use("/alocacao", alocacaoRouter);
app.use("/solicitacoes-excedente", solicitacoesExcedenteRouter);
app.use("/solicitacoes-apontamento", solicitacoesApontamentoRouter);
app.use("/solicitacoes-ajuste", solicitacoesAjusteRouter);
app.use("/solicitacoes-config-proposta", solicitacoesConfigPropostaRouter);
app.use("/jornadas", jornadasRouter);
app.use("/proposta-visualizacao", propostaVisualizacaoRouter);
app.use("/auditoria", auditoriaRouter);
app.use("/painel-tv", painelTvRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

// Fase 3 do plano de filtros na importação: carrega o snapshot de filtros ativos ANTES de
// aceitar qualquer requisição/agendar qualquer cron — senão a primeira sincronização
// disparada logo após o boot rodaria sem filtro nenhum até o carregamento terminar. Hoje é
// instantâneo (só pedidos-sync pode ter filtro salvo, ver JOBS_COM_FILTRO em registry.ts);
// se falhar, loga bem alto e sobe do mesmo jeito sem filtro nenhum — sem filtro é o estado
// seguro (espelho completo), travar o boot por causa disso seria pior que o problema.
async function iniciar() {
  try {
    await carregarFiltrosAtivos(SYNC_JOBS);
  } catch (error) {
    console.error("[boot] falhou ao carregar filtros ativos — subindo sem filtro nenhum:", error instanceof Error ? error.message : error);
  }

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
    scheduleContratoConsultorSync();
    scheduleDepartamentoGestorSync();
    scheduleDepartamentoTimeSync();
    scheduleFasePropostaSync();
    scheduleAtividadeConsultorSync();
    scheduleRatSync();
    scheduleRatItemSync();
    schedulePedidoSync();
    scheduleFormaPagamentoSync();
    scheduleCondicaoPagamentoSync();
    schedulePlanoContabilSync();
    scheduleLancamentoContabilSync();
    scheduleRateioLancamentoSync();
    scheduleHistoricoPadraoSync();
    scheduleOrcamentoContabilSync();
    scheduleRotaViagemSync();
    schedulePercursoViagemSync();
    scheduleRotaPercursoSync();
    scheduleRegistroDespesaViagemSync();
    // Catálogo de Produtos/Derivações/Serviços (24/08/2026) — Produto antes de Derivação
    // (FK real DerivacaoProduto -> Produto, ver registry.ts); Serviço é independente.
    scheduleProdutoSync();
    scheduleDerivacaoProdutoSync();
    scheduleServicoSync();
    // Família da NF de venda — cabeçalho antes dos itens (FK real), rateio por último.
    scheduleNotaFiscalVendaSync();
    scheduleItemServicoNfVendaSync();
    scheduleItemProdutoNfVendaSync();
    scheduleRateioNfVendaSync();
    scheduleMetaAnualSync();
    scheduleOutboxSeniorSync();
    // Não é sync com o Senior: fecha sessão de execução que passou do teto de horas ou do
    // fim do expediente (5 em 5 min), e a que ficou sem resposta depois de a aba fechar
    // (15 em 15s — cadência bem mais curta, ver o comentário no arquivo).
    agendarParadaAutomatica();
    agendarParadaPorFechamento();
  });
}

iniciar();
