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

  if (user.status !== "ativo" || !user.passwordHash) {
    res.status(403).json({ error: "Convite pendente — aceite o convite antes de entrar" });
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

// ---------- Aceitar convite (público, sem login) ----------
authRouter.get("/convite/:token", async (req, res) => {
  const { token } = req.params;
  const user = await prisma.user.findUnique({ where: { inviteToken: token } });

  if (!user || user.status !== "pendente" || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
    res.status(404).json({ error: "Convite inválido ou expirado" });
    return;
  }

  res.json({ nome: user.nome, email: user.email });
});

authRouter.post("/convite/:token/aceitar", async (req, res) => {
  const { token } = req.params;
  const { password } = req.body ?? {};

  if (typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Senha precisa ter pelo menos 6 caracteres" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { inviteToken: token }, include: { role: true } });
  if (!user || user.status !== "pendente" || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
    res.status(404).json({ error: "Convite inválido ou expirado" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const atualizado = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, status: "ativo", inviteToken: null, inviteExpiresAt: null },
    include: { role: true },
  });

  const jwtToken = signToken({ userId: atualizado.id, role: atualizado.role.name });
  res.json({ token: jwtToken, user: toPublicUser(atualizado) });
});

authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, include: { role: true } });
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json({ user: toPublicUser(user) });
});
