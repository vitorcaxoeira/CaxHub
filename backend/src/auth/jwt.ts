import jwt from "jsonwebtoken";

export interface TokenPayload {
  userId: number;
  role: string;
  // Preenchidos automaticamente pelo jsonwebtoken ao verificar (via expiresIn no signToken) —
  // nunca setados por nós ao assinar. Só existem pra decidir renovação por deslizamento (ver
  // talvezRenovar), não fazem parte do payload de negócio.
  iat?: number;
  exp?: number;
}

export function signToken(payload: TokenPayload, expiresIn: string | number = "8h"): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET precisa estar definido no .env");
  // Reconstrói só com userId/role — nunca reaproveita iat/exp de um payload já decodificado
  // (jwt.sign rejeita { expiresIn } se o payload já tiver iat).
  return jwt.sign({ userId: payload.userId, role: payload.role }, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): Required<TokenPayload> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET precisa estar definido no .env");
  return jwt.verify(token, secret) as Required<TokenPayload>;
}

// Renovação por deslizamento (27/08/2026) — se o token já passou da metade da duração ORIGINAL
// (8h de sessão de login, 365d de token de serviço — preserva a duração de origem, nunca
// "rebaixa" um token de longa duração pro default de 8h), emite um novo com a mesma duração,
// contada a partir de agora. null = ainda não precisa renovar. Usado por requireAuth
// (backend/src/auth/middleware.ts), que devolve o token novo num header pro frontend trocar.
const LIMIAR_RENOVACAO = 0.5;

export function talvezRenovar(payload: Required<TokenPayload>): string | null {
  const duracaoTotalMs = (payload.exp - payload.iat) * 1000;
  const restanteMs = payload.exp * 1000 - Date.now();
  if (restanteMs > duracaoTotalMs * LIMIAR_RENOVACAO) return null;
  return signToken(payload, `${payload.exp - payload.iat}s`);
}
