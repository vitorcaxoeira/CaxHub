import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

export interface RequestComCorrelationId extends Request {
  correlationId?: string;
}

// Gera um correlation_id por requisição HTTP, reaproveitado por todos os eventos de
// auditoria daquela requisição. Nenhuma rota usa isso ainda na Fase 1 (só o sync é
// instrumentado, e sync gera o próprio UUID por linha — não é uma requisição HTTP) —
// montado já agora pra Fase 2 não precisar mexer em server.ts de novo.
export function attachCorrelationId(req: RequestComCorrelationId, _res: Response, next: NextFunction): void {
  req.correlationId = randomUUID();
  next();
}
