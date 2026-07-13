import { Router } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../db/prisma";
import { signToken } from "./jwt";

export const authRouter = Router();

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
  res.json({ token });
});
