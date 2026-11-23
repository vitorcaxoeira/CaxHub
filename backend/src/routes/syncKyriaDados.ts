import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { KYRIA_SYNC_JOBS } from "../kyria/registry";
import { listarDadosKyria, editarCampoInterno, buscarRegistrosRelacionados, ErroValidacao } from "../kyria/dadosSincronizados";
import { colunasFiltraveis, FUNCOES_RESUMO_DADOS, resumoDosDados, valoresDaColuna } from "../sync/dadosSincronizados";
import { validarFiltrosColuna } from "../sync/filtroColunaLocal";
import { validarOrdem } from "../sync/ordemColuna";
import { validarPedidosResumo } from "../sync/resumoColuna";

// Consulta/edição dos dados JÁ SINCRONIZADOS (Administração > Integração Kyria > "Ver dados") —
// arquivo separado de sync-kyria.ts (status/disparo de job) e sync-kyria/mapping (spec, nunca
// grava dado real). Montado em server.ts ANTES de "/sync-kyria" (mesmo cuidado de ordem já
// aplicado a "/sync-kyria/mapping" — evita qualquer risco de rota genérica engolir esta).
//
// Desde 17/11/2026 a listagem é a mesma do "Ver dados" do ERP (pedido do Vitor): busca, funil por
// coluna, ordem e paginação no SERVIDOR, pelo motor genérico de sync/dadosSincronizados.ts.
export const syncKyriaDadosRouter = Router();
syncKyriaDadosRouter.use(requireAuth, requireRole("admin"));

function handleError(res: import("express").Response, error: unknown, label: string) {
  if (error instanceof ErroValidacao) {
    res.status(400).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sync-kyria-dados:${label}]`, message);
  res.status(500).json({ error: message });
}

function jobOuNulo(nome: string) {
  return KYRIA_SYNC_JOBS.find((j) => j.jobName === nome) ?? null;
}

// Filtros de coluna (JSON em `filtros`) e ordem (`coluna:desc,outra`) da tela, validados contra as
// colunas reais do model — mesmo contrato e mesmos validadores do "Ver dados" do ERP. Entrada
// inválida vira 400 (ErroValidacao), não 500.
function recorteDaTela(job: { tabelaLocal: string }, query: Record<string, unknown>) {
  try {
    const colunas = colunasFiltraveis(job);
    const bruto = typeof query.filtros === "string" && query.filtros.trim() ? JSON.parse(query.filtros) : [];
    return {
      filtros: validarFiltrosColuna(colunas, bruto),
      // json não ordena (nem tem funil).
      ordem: validarOrdem(colunas.filter((c) => c.tipo !== "json").map((c) => c.nome), query.ordem),
      busca: typeof query.busca === "string" ? query.busca : "",
    };
  } catch (error) {
    throw new ErroValidacao(error instanceof SyntaxError ? "Filtros inválidos." : error instanceof Error ? error.message : "Filtros inválidos.");
  }
}

// Registrada antes de "/:jobName" — não colidem por profundidade de path (esta tem 2 segmentos
// depois de /dados, aquela só 1), mas mesma convenção defensiva já usada em outras rotas Kyria.
syncKyriaDadosRouter.get("/relacionados/:modelo", async (req, res) => {
  try {
    const busca = typeof req.query.busca === "string" ? req.query.busca : "";
    const resultado = await buscarRegistrosRelacionados(req.params.modelo, busca, req.query.page, req.query.pageSize);
    res.json(resultado);
  } catch (error) {
    handleError(res, error, "relacionados");
  }
});

// GET /:jobName/resumo?resumo=[{coluna,funcao}] — rodapé de totais sobre TODAS as linhas do recorte
// (busca + filtros), não só a página. Mesmo contrato de /sync-erp/:job/dados/resumo.
syncKyriaDadosRouter.get("/:jobName/resumo", async (req, res) => {
  try {
    const job = jobOuNulo(req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const { filtros, busca } = recorteDaTela(job, req.query);
    let pedidos;
    try {
      const bruto = typeof req.query.resumo === "string" && req.query.resumo.trim() ? JSON.parse(req.query.resumo) : [];
      pedidos = validarPedidosResumo(colunasFiltraveis(job), bruto);
      const indisponivel = pedidos.find((p) => !FUNCOES_RESUMO_DADOS.has(p.funcao));
      if (indisponivel) throw new Error(`Resumo ${indisponivel.funcao} não está disponível nesta tela.`);
    } catch (error) {
      throw new ErroValidacao(error instanceof SyntaxError ? "Resumo inválido." : error instanceof Error ? error.message : "Resumo inválido.");
    }
    res.json(await resumoDosDados(job, pedidos, { busca, filtros }));
  } catch (error) {
    handleError(res, error, "resumo");
  }
});

// GET /:jobName/valores?coluna=&termo= — valores mais frequentes de UMA coluna no recorte atual
// (aba "Valores" do funil). Mesmo recorte da listagem, sem o filtro da própria coluna.
syncKyriaDadosRouter.get("/:jobName/valores", async (req, res) => {
  try {
    const job = jobOuNulo(req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const { filtros, busca } = recorteDaTela(job, req.query);
    const coluna = typeof req.query.coluna === "string" ? req.query.coluna : "";
    if (!colunasFiltraveis(job).some((c) => c.nome === coluna && c.tipo !== "json")) {
      res.status(400).json({ error: `A coluna "${coluna}" não tem filtro.` });
      return;
    }
    res.json(await valoresDaColuna(job, coluna, { busca, termo: typeof req.query.termo === "string" ? req.query.termo : "", filtros }));
  } catch (error) {
    handleError(res, error, "valores");
  }
});

// GET /:jobName — uma página das linhas já sincronizadas (busca, filtro, ordem e paginação no servidor).
syncKyriaDadosRouter.get("/:jobName", async (req, res) => {
  try {
    const job = jobOuNulo(req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const recorte = recorteDaTela(job, req.query);
    const resultado = await listarDadosKyria(job, {
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 30,
      ...recorte,
    });
    res.json({ jobName: job.jobName, displayName: job.displayName, tabelaLocal: job.tabelaLocal, ...resultado });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

syncKyriaDadosRouter.patch("/:jobName/:id", async (req, res) => {
  try {
    const job = jobOuNulo(req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const campo = typeof req.body?.campo === "string" ? req.body.campo : "";
    if (!campo) {
      res.status(400).json({ error: "Informe o campo a editar" });
      return;
    }
    // `valor` precisa vir no corpo, mesmo que `null` (= remover o vínculo). Antes um corpo sem
    // `valor` virava null em silêncio; agora que null desvincula, isso seria um jeito de apagar
    // o vínculo sem querer.
    if (!req.body || !("valor" in req.body)) {
      res.status(400).json({ error: "Informe o valor (use null pra remover o vínculo)" });
      return;
    }
    const linha = await editarCampoInterno(job, req.params.id, campo, req.body.valor ?? null);
    res.json(linha);
  } catch (error) {
    handleError(res, error, "editar");
  }
});
