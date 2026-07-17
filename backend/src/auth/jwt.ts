import jwt from "jsonwebtoken";

export interface TokenPayload {
  userId: number;
  role: string;
}

export function signToken(payload: TokenPayload, expiresIn: string = "8h"): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET precisa estar definido no .env");
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET precisa estar definido no .env");
  return jwt.verify(token, secret) as TokenPayload;
}
