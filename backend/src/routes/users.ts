import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { requireAuth, requireRole, AuthenticatedRequest } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import { prisma } from "../db/prisma";
import { papelSugeridoPorTipusurat } from "../domain/usuariosDominio";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("admin"));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONVITE_VALIDADE_DIAS = 7;

function toPublicUser(user: {
  id: number;
  email: string;
  nome: string;
  fotoUrl: string | null;
  roleId: number;
  status: string;
  role: { id: number; name: string };
}) {
  return {
    id: user.id,
    email: user.email,
    nome: user.nome,
    fotoUrl: user.fotoUrl,
    roleId: user.roleId,
    roleName: user.role.name,
    status: user.status,
  };
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[users:${label}]`, message);
  res.status(500).json({ error: message });
}

// ---------- Papéis disponíveis (para o select do formulário) ----------
usersRouter.get("/roles", async (_req, res) => {
  try {
    const roles = await prisma.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    res.json({ roles });
  } catch (error) {
    handleError(res, error, "roles");
  }
});

// ---------- Sugestão de nome/papel a partir do Consultor (pra pré-preencher o convite) ----------
usersRouter.get("/convites/sugestao", async (req, res) => {
  try {
    const email = String(req.query.email ?? "").trim();
    if (!email) {
      res.status(400).json({ error: "email é obrigatório" });
      return;
    }

    const consultor = await prisma.consultor.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (!consultor) {
      res.json({ encontrado: false });
      return;
    }

    const roleNome = papelSugeridoPorTipusurat(consultor.tipusurat);
    const role = roleNome ? await prisma.role.findUnique({ where: { name: roleNome } }) : null;

    res.json({
      encontrado: true,
      nome: consultor.nomcom ?? consultor.nomfor ?? "",
      roleId: role?.id ?? null,
      roleName: role?.name ?? null,
    });
  } catch (error) {
    handleError(res, error, "convites-sugestao");
  }
});

// ---------- Criar convite ----------
usersRouter.post("/convites", async (req, res) => {
  try {
    const { email, nome, roleId } = req.body ?? {};

    if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: "E-mail inválido" });
      return;
    }
    if (typeof nome !== "string" || nome.trim() === "") {
      res.status(400).json({ error: "Nome é obrigatório" });
      return;
    }
    const roleIdNum = Number(roleId);
    if (!Number.isFinite(roleIdNum)) {
      res.status(400).json({ error: "Papel (role) é obrigatório" });
      return;
    }

    const role = await prisma.role.findUnique({ where: { id: roleIdNum } });
    if (!role) {
      res.status(400).json({ error: "Papel (role) não encontrado" });
      return;
    }

    const consultor = await prisma.consultor.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });

    const inviteToken = crypto.randomBytes(32).toString("hex");
    const inviteExpiresAt = new Date(Date.now() + CONVITE_VALIDADE_DIAS * 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        email,
        nome,
        roleId: roleIdNum,
        status: "pendente",
        passwordHash: null,
        inviteToken,
        inviteExpiresAt,
        consultorCodemp: consultor?.codemp,
        consultorCodusu: consultor?.codusu,
      },
      include: { role: true },
    });

    res.status(201).json({ user: toPublicUser(user), inviteLink: `/aceitar-convite?token=${inviteToken}` });
  } catch (error: any) {
    if (error?.code === "P2002") {
      res.status(409).json({ error: "Já existe um usuário com esse e-mail" });
      return;
    }
    handleError(res, error, "convites-criar");
  }
});

// ---------- Reenviar convite (gera novo token/validade) ----------
usersRouter.post("/:id/convites/reenviar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (existing.status !== "pendente") {
      res.status(400).json({ error: "Esse usuário já aceitou o convite" });
      return;
    }

    const inviteToken = crypto.randomBytes(32).toString("hex");
    const inviteExpiresAt = new Date(Date.now() + CONVITE_VALIDADE_DIAS * 24 * 60 * 60 * 1000);
    await prisma.user.update({ where: { id }, data: { inviteToken, inviteExpiresAt } });

    res.json({ inviteLink: `/aceitar-convite?token=${inviteToken}` });
  } catch (error) {
    handleError(res, error, "convites-reenviar");
  }
});

// ---------- Gerar token de API de longa duração pra conta de serviço (papel "system") ----------
usersRouter.post("/:id/token-servico", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (user.role.name !== "system") {
      res.status(400).json({ error: "Só é possível gerar token de serviço para usuários com papel \"system\"" });
      return;
    }

    const token = signToken({ userId: user.id, role: user.role.name }, "365d");
    res.json({ token });
  } catch (error) {
    handleError(res, error, "token-servico");
  }
});

// ---------- Listagem ----------
usersRouter.get("/", async (_req, res) => {
  try {
    const users = await prisma.user.findMany({ include: { role: true }, orderBy: { nome: "asc" } });
    res.json({ users: users.map(toPublicUser) });
  } catch (error) {
    handleError(res, error, "list");
  }
});

// ---------- Criação ----------
usersRouter.post("/", async (req, res) => {
  try {
    const { email, password, nome, roleId, fotoUrl } = req.body ?? {};

    if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: "E-mail inválido" });
      return;
    }
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Senha precisa ter pelo menos 6 caracteres" });
      return;
    }
    if (typeof nome !== "string" || nome.trim() === "") {
      res.status(400).json({ error: "Nome é obrigatório" });
      return;
    }
    const roleIdNum = Number(roleId);
    if (!Number.isFinite(roleIdNum)) {
      res.status(400).json({ error: "Papel (role) é obrigatório" });
      return;
    }

    const role = await prisma.role.findUnique({ where: { id: roleIdNum } });
    if (!role) {
      res.status(400).json({ error: "Papel (role) não encontrado" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, nome, roleId: roleIdNum, fotoUrl: fotoUrl || null },
      include: { role: true },
    });

    res.status(201).json({ user: toPublicUser(user) });
  } catch (error: any) {
    if (error?.code === "P2002") {
      res.status(409).json({ error: "Já existe um usuário com esse e-mail" });
      return;
    }
    handleError(res, error, "create");
  }
});

// ---------- Atualização ----------
usersRouter.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!existing) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const { email, password, nome, roleId, fotoUrl } = req.body ?? {};

    if (email !== undefined && (typeof email !== "string" || !EMAIL_REGEX.test(email))) {
      res.status(400).json({ error: "E-mail inválido" });
      return;
    }
    if (password !== undefined && (typeof password !== "string" || password.length < 6)) {
      res.status(400).json({ error: "Senha precisa ter pelo menos 6 caracteres" });
      return;
    }
    if (nome !== undefined && (typeof nome !== "string" || nome.trim() === "")) {
      res.status(400).json({ error: "Nome é obrigatório" });
      return;
    }

    let roleIdNum: number | undefined;
    if (roleId !== undefined) {
      roleIdNum = Number(roleId);
      if (!Number.isFinite(roleIdNum)) {
        res.status(400).json({ error: "Papel (role) inválido" });
        return;
      }
      const role = await prisma.role.findUnique({ where: { id: roleIdNum } });
      if (!role) {
        res.status(400).json({ error: "Papel (role) não encontrado" });
        return;
      }
    }

    // Impede remover o papel de admin do último administrador (evitaria bloqueio total do sistema).
    if (existing.role.name === "admin" && roleIdNum !== undefined) {
      const novoRole = await prisma.role.findUnique({ where: { id: roleIdNum } });
      if (novoRole?.name !== "admin") {
        const outrosAdmins = await prisma.user.count({ where: { role: { name: "admin" }, id: { not: id } } });
        if (outrosAdmins === 0) {
          res.status(400).json({ error: "Não é possível remover o papel de administrador do único admin restante" });
          return;
        }
      }
    }

    const data: Record<string, unknown> = {};
    if (email !== undefined) data.email = email;
    if (nome !== undefined) data.nome = nome;
    if (fotoUrl !== undefined) data.fotoUrl = fotoUrl || null;
    if (roleIdNum !== undefined) data.roleId = roleIdNum;
    if (password) data.passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.update({ where: { id }, data, include: { role: true } });
    res.json({ user: toPublicUser(user) });
  } catch (error: any) {
    if (error?.code === "P2002") {
      res.status(409).json({ error: "Já existe um usuário com esse e-mail" });
      return;
    }
    handleError(res, error, "update");
  }
});

// ---------- Exclusão ----------
usersRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    if (id === req.user!.userId) {
      res.status(400).json({ error: "Você não pode excluir seu próprio usuário" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!existing) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    if (existing.role.name === "admin") {
      const outrosAdmins = await prisma.user.count({ where: { role: { name: "admin" }, id: { not: id } } });
      if (outrosAdmins === 0) {
        res.status(400).json({ error: "Não é possível excluir o único administrador restante" });
        return;
      }
    }

    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "delete");
  }
});
