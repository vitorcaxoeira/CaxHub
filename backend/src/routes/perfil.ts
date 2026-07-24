import { Router } from "express";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { AVATARS_DIR } from "../config/uploads";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdUsuario } from "../audit/identidadeEntidade";

export const perfilRouter = Router();
perfilRouter.use(requireAuth);

// Assinatura de magic bytes — validação server-side além do fileFilter (que só olha o
// mimetype declarado pelo cliente, fácil de forjar). Cliente já reencoda pra webp via
// canvas antes de enviar, mas aceitamos jpg/png/webp aqui pra não travar num upload
// legítimo que o crop-modal não conseguiu reencodar (ex.: navegador sem suporte a webp).
const ASSINATURAS: { formato: string; bytes: number[] }[] = [
  { formato: "png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { formato: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { formato: "webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" (WEBP confirmado nos bytes 8-11, checado à parte)
];

function assinaturaValida(buffer: Buffer): boolean {
  return ASSINATURAS.some((a) => a.bytes.every((byte, i) => buffer[i] === byte)) && !(
    buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") !== "WEBP"
  );
}

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(new Error("Formato de imagem não suportado (use jpg, png ou webp)"));
      return;
    }
    cb(null, true);
  },
});

function avatarPath(userId: number): string {
  return path.join(AVATARS_DIR, `${userId}.webp`);
}

// GET /api/perfil — dados do usuário logado.
perfilRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json({ nome: user.nome, email: user.email, fotoUrl: user.fotoUrl });
});

// PUT /api/perfil — troca nome de exibição.
perfilRouter.put("/", async (req: AuthenticatedRequest, res) => {
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  if (!nome || nome.length > 150) {
    res.status(400).json({ error: "Nome inválido" });
    return;
  }

  const antes = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!antes) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  const atualizado = await prisma.user.update({ where: { id: antes.id }, data: { nome } });

  if (antes.nome !== atualizado.nome) {
    await criarEventoAuditoria({
      origem: "tela",
      usuarioId: req.user!.userId,
      entidadeTipo: ENTIDADES_AUDITORIA.USUARIO,
      entidadeId: entidadeIdUsuario(atualizado.id),
      entidadeRotulo: atualizado.nome,
      eventoTipo: EVENTOS_AUDITORIA.USUARIO_PERFIL_ALTERADO,
      alteracoes: { nome: { de: antes.nome, para: atualizado.nome, rotulo: "Nome de exibição" } },
      correlationId: req.correlationId!,
    });
  }

  res.json({ nome: atualizado.nome, email: atualizado.email, fotoUrl: atualizado.fotoUrl });
});

// POST /api/perfil/avatar — troca a foto (sobrescreve a anterior).
perfilRouter.post("/avatar", uploadAvatar.single("avatar"), async (req: AuthenticatedRequest, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Arquivo de imagem obrigatório" });
    return;
  }
  if (!assinaturaValida(file.buffer)) {
    res.status(400).json({ error: "Arquivo não parece ser uma imagem válida" });
    return;
  }

  const userId = req.user!.userId;
  fs.writeFileSync(avatarPath(userId), file.buffer);

  // Prefixo /api obrigatório: é só o que o proxy reconhece e encaminha pro backend
  // (nginx em produção, Vite em dev — ambos removem o prefixo antes de repassar; ver
  // deploy/nginx.conf e vite.config.ts). Sem ele, o <img src> bate direto no servidor de
  // frontend (SPA fallback ou 404), não no backend.
  const fotoUrl = `/api/uploads/avatars/${userId}.webp?v=${Date.now()}`;
  const atualizado = await prisma.user.update({ where: { id: userId }, data: { fotoUrl } });

  await criarEventoAuditoria({
    origem: "tela",
    usuarioId: userId,
    entidadeTipo: ENTIDADES_AUDITORIA.USUARIO,
    entidadeId: entidadeIdUsuario(userId),
    entidadeRotulo: atualizado.nome,
    eventoTipo: EVENTOS_AUDITORIA.USUARIO_AVATAR_ALTERADO,
    correlationId: req.correlationId!,
  });

  res.json({ fotoUrl: atualizado.fotoUrl });
});

// DELETE /api/perfil/avatar — remove a foto atual.
perfilRouter.delete("/avatar", async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  try {
    fs.unlinkSync(avatarPath(userId));
  } catch {
    // sem arquivo pra remover — segue normal (idempotente)
  }

  const atualizado = await prisma.user.update({ where: { id: userId }, data: { fotoUrl: null } });

  await criarEventoAuditoria({
    origem: "tela",
    usuarioId: userId,
    entidadeTipo: ENTIDADES_AUDITORIA.USUARIO,
    entidadeId: entidadeIdUsuario(userId),
    entidadeRotulo: atualizado.nome,
    eventoTipo: EVENTOS_AUDITORIA.USUARIO_AVATAR_REMOVIDO,
    correlationId: req.correlationId!,
  });

  res.json({ ok: true });
});

// Limite de tentativas de troca de senha — por usuário autenticado, não por IP (várias
// contas atrás do mesmo IP em rede corporativa/VPN não podem se travar mutuamente).
const senhaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // perfilRouter.use(requireAuth) já roda antes de qualquer rota deste router — req.user
  // sempre existe aqui (nunca cai num fallback por IP, então não precisa do helper
  // ipKeyGenerator do express-rate-limit).
  keyGenerator: (req: AuthenticatedRequest) => String(req.user!.userId),
  message: { error: "Muitas tentativas — aguarde um minuto antes de tentar novamente" },
});

function senhaForte(senha: string): boolean {
  return senha.length >= 8 && /[A-Za-z]/.test(senha) && /[0-9]/.test(senha);
}

// POST /api/perfil/senha — troca de senha (exige a senha atual).
perfilRouter.post("/senha", senhaLimiter, async (req: AuthenticatedRequest, res) => {
  const { senhaAtual, novaSenha } = req.body ?? {};
  if (typeof senhaAtual !== "string" || typeof novaSenha !== "string") {
    res.status(400).json({ error: "Dados inválidos" });
    return;
  }
  if (!senhaForte(novaSenha)) {
    res.status(400).json({ error: "A nova senha precisa ter pelo menos 8 caracteres, com letras e números" });
    return;
  }
  if (novaSenha === senhaAtual) {
    res.status(400).json({ error: "A nova senha precisa ser diferente da senha atual" });
    return;
  }

  const userId = req.user!.userId;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.passwordHash) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  const senhaCorreta = await bcrypt.compare(senhaAtual, user.passwordHash);
  if (!senhaCorreta) {
    res.status(401).json({ error: "Senha atual incorreta" });
    return;
  }

  const passwordHash = await bcrypt.hash(novaSenha, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  await criarEventoAuditoria({
    origem: "tela",
    usuarioId: userId,
    entidadeTipo: ENTIDADES_AUDITORIA.USUARIO,
    entidadeId: entidadeIdUsuario(userId),
    entidadeRotulo: user.nome,
    eventoTipo: EVENTOS_AUDITORIA.USUARIO_SENHA_ALTERADA,
    correlationId: req.correlationId!,
  });

  res.json({ ok: true });
});
