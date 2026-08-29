import { NextFunction, Request, Response } from "express";
import { verifyToken, talvezRenovar, TokenPayload } from "./jwt";

export interface AuthenticatedRequest extends Request {
  // Sempre Required (iat/exp inclusos) na prática — vem só de verifyToken, que já devolve assim.
  user?: Required<TokenPayload>;
  // Preenchido por attachCorrelationId (backend/src/audit/correlationId.ts), registrado
  // globalmente em server.ts antes de qualquer router — disponível em toda rota.
  correlationId?: string;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    res.status(401).json({ error: "Token ausente" });
    return;
  }

  // Só a verificação do token entra no try (29/08/2026, achado ao investigar o incidente de
  // sessão morrendo em produção): antes, `next()` também estava aqui dentro — qualquer exceção
  // SÍNCRONA de uma rota downstream vinha ser capturada por este catch e virava 401 "Token
  // inválido ou expirado", mascarando um erro real como falha de autenticação.
  try {
    req.user = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado" });
    return;
  }

  // Renovação por deslizamento (27/08/2026): se o token já passou da metade da vida útil,
  // devolve um novo no header — o frontend troca sozinho (ver AuthContext.tsx). Mantém a
  // sessão viva pra quem está de fato usando o app, sem refresh token separado.
  const renovado = talvezRenovar(req.user);
  if (renovado) res.setHeader("X-Renewed-Token", renovado);
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Sem permissão para acessar este recurso" });
      return;
    }
    next();
  };
}
