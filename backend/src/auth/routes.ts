import { Router } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../db/prisma";
import { signToken } from "./jwt";
import { AuthenticatedRequest, requireAuth } from "./middleware";

export const authRouter = Router();

function toPublicUser(user: { id: number; email: string; nome: string; fotoUrl: string | null; role: { name: string } }) {
  return {
    id: user.id,
    email: user.email,
    nome: user.nome,
    fotoUrl: user.fotoUrl,
    role: user.role.name,
  };
}

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    res.status(400).json({ error: "email e password são obrigatórios" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const token = signToken({ userId: user.id, role: user.role.name });
  res.json({ token, user: toPublicUser(user) });
});

authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, include: { role: true } });
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json({ user: toPublicUser(user) });
});
