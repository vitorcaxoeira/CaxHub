import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { KYRIA_SYNC_JOBS } from "../kyria/registry";
import { listarDados, listarTodosDados, editarCampoInterno, buscarRegistrosRelacionados, ErroValidacao } from "../kyria/dadosSincronizados";

// Consulta/edição dos dados JÁ SINCRONIZADOS (Administração > Integração Kyria > "Ver dados") —
// arquivo separado de sync-kyria.ts (status/disparo de job) e sync-kyria/mapping (spec, nunca
// grava dado real). Montado em server.ts ANTES de "/sync-kyria" (mesmo cuidado de ordem já
// aplicado a "/sync-kyria/mapping" — evita qualquer risco de rota genérica engolir esta).
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

// Todas as linhas da tabela do job, sem paginação — pro filtro de coluna no cliente (ver
// DadosKyria.tsx). Registrada antes de "/:jobName" por hábito, embora não colidam (esta tem 2
// segmentos depois de /dados, aquela só 1).
syncKyriaDadosRouter.get("/:jobName/indice", async (req, res) => {
  try {
    const job = KYRIA_SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    res.json(await listarTodosDados(job));
  } catch (error) {
    handleError(res, error, "indice");
  }
});

syncKyriaDadosRouter.get("/:jobName", async (req, res) => {
  try {
    const job = KYRIA_SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const resultado = await listarDados(job, req.query.page, req.query.pageSize);
    res.json(resultado);
  } catch (error) {
    handleError(res, error, "listar");
  }
});

syncKyriaDadosRouter.patch("/:jobName/:id", async (req, res) => {
  try {
    const job = KYRIA_SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
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
