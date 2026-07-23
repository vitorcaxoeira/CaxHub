import { randomUUID } from "crypto";
import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "../auth/middleware";

// Gera um correlation_id por requisição HTTP, reaproveitado por todos os eventos de
// auditoria daquela requisição (ex.: mover um card pode gerar KANBAN_RAIA_ALTERADA +
// ATIVIDADE_INICIADA/PARADA juntos — mesma ação do usuário, mesmo correlationId).
// Registrado globalmente em server.ts, antes de qualquer requireAuth, então roda pra
// toda rota (autenticada ou não).
export function attachCorrelationId(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  req.correlationId = randomUUID();
  next();
}
