import { Router } from "express";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { Prisma } from "@prisma/client";
import { type LayoutColunas, tabelaValida, validarLayoutColunas } from "./layoutColunas";
import { MAX_CALCULADAS_POR_LISTA, validarColunaCalculada } from "./colunasCalculadas";
import { campoFiltroValido, validarValorFiltro } from "./preferenciasFiltros";
import { AVATARS_DIR } from "../config/uploads";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdUsuario } from "../audit/identidadeEntidade";
import { preferenciasPublicas, validarPreferencias } from "../domain/preferenciasTela";

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

// PUT /api/perfil/preferencias — preferências de tela do próprio usuário (ex.: visão em que Atividades abre). Devolve todas,
// para o AuthContext atualizar o usuário em memória.
perfilRouter.put("/preferencias", async (req: AuthenticatedRequest, res) => {
  const validado = validarPreferencias(req.body);
  if ("erro" in validado) {
    res.status(400).json({ error: validado.erro });
    return;
  }
  try {
    const pref = await prisma.preferenciaTela.upsert({
      where: { userId: req.user!.userId },
      update: validado.dados,
      create: { userId: req.user!.userId, ...validado.dados },
    });
    res.json({ preferencias: preferenciasPublicas(pref) });
  } catch (error) {
    console.error("[perfil:preferencias]", error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Não foi possível salvar a preferência" });
  }
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

// Preferências de lista (colunas, resumo do rodapé, padrão de filtro, colunas calculadas): trazidas do CaxHub_Dash em 03/11/2026.

// ---- Arrumação das colunas das tabelas (26/10/2026) ----------------------------------------------------------------------------
// Ordem, colunas ocultas e larguras de cada tabela da tela, por usuário (`preferencias_colunas`, só por SQL). Sem linha = arrumação padrão da tela.

perfilRouter.get("/colunas/:tabela", async (req: AuthenticatedRequest, res) => {
  const { tabela } = req.params;
  if (!tabelaValida(tabela)) {
    res.status(400).json({ error: "Tabela inválida" });
    return;
  }
  try {
    const [linha] = await prisma.$queryRaw<LayoutColunas[]>(
      Prisma.sql`SELECT ordem, ocultas, larguras, resumos, congelada_ate AS "congeladaAte" FROM preferencias_colunas WHERE user_id = ${req.user!.userId} AND tabela = ${tabela}`,
    );
    res.json(linha ?? { ordem: [], ocultas: [], larguras: {}, resumos: {}, congeladaAte: null });
  } catch (err) {
    console.error("[perfil] colunas-get:", err);
    res.status(500).json({ error: "Falha ao ler a arrumação das colunas" });
  }
});

perfilRouter.put("/colunas/:tabela", async (req: AuthenticatedRequest, res) => {
  const { tabela } = req.params;
  const layout = validarLayoutColunas(req.body);
  if (!tabelaValida(tabela) || !layout) {
    res.status(400).json({ error: "Arrumação de colunas inválida" });
    return;
  }
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO preferencias_colunas (user_id, tabela, ordem, ocultas, larguras, resumos, congelada_ate, atualizado_em)
      VALUES (${req.user!.userId}, ${tabela}, ${layout.ordem}::text[], ${layout.ocultas}::text[], ${JSON.stringify(layout.larguras)}::jsonb,
              ${JSON.stringify(layout.resumos)}::jsonb, ${layout.congeladaAte}, now())
      ON CONFLICT (user_id, tabela) DO UPDATE SET ordem = EXCLUDED.ordem, ocultas = EXCLUDED.ocultas, larguras = EXCLUDED.larguras,
                                                 resumos = EXCLUDED.resumos, congelada_ate = EXCLUDED.congelada_ate, atualizado_em = now()`);
    res.json(layout);
  } catch (err) {
    console.error("[perfil] colunas-put:", err);
    res.status(500).json({ error: "Falha ao gravar a arrumação das colunas" });
  }
});

perfilRouter.delete("/colunas/:tabela", async (req: AuthenticatedRequest, res) => {
  const { tabela } = req.params;
  if (!tabelaValida(tabela)) {
    res.status(400).json({ error: "Tabela inválida" });
    return;
  }
  try {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM preferencias_colunas WHERE user_id = ${req.user!.userId} AND tabela = ${tabela}`);
    res.json({ ordem: [], ocultas: [], larguras: {}, resumos: {} });
  } catch (err) {
    console.error("[perfil] colunas-delete:", err);
    res.status(500).json({ error: "Falha ao restaurar as colunas" });
  }
});

// ---- Padrão de cada filtro de uma tela (03/11/2026, Acompanhamento de Compra) --------------------------------------------------------
// A estrela no canto de um filtro grava SÓ aquele campo, do usuário logado (`preferencias_filtros`). Sem linha = sem padrão; `valor` lista vazia = "Todos" salvo de propósito.

// Todos os padrões do usuário de uma vez ({ [tela]: { [campo]: valor } }): o frontend lê uma vez por sessão e as telas abrem sem esperar.
perfilRouter.get("/filtros", async (req: AuthenticatedRequest, res) => {
  try {
    const linhas = await prisma.$queryRaw<{ tela: string; campo: string; valor: unknown }[]>(
      Prisma.sql`SELECT tela, campo, valor FROM preferencias_filtros WHERE user_id = ${req.user!.userId}`,
    );
    const padroes: Record<string, Record<string, unknown>> = {};
    for (const l of linhas) (padroes[l.tela] ??= {})[l.campo] = l.valor;
    res.json({ padroes });
  } catch (err) {
    console.error("[perfil] filtros-todos:", err);
    res.status(500).json({ error: "Falha ao ler os padrões dos filtros" });
  }
});

perfilRouter.get("/filtros/:tela", async (req: AuthenticatedRequest, res) => {
  const { tela } = req.params;
  if (!tabelaValida(tela)) {
    res.status(400).json({ error: "Tela inválida" });
    return;
  }
  try {
    const linhas = await prisma.$queryRaw<{ campo: string; valor: unknown }[]>(
      Prisma.sql`SELECT campo, valor FROM preferencias_filtros WHERE user_id = ${req.user!.userId} AND tela = ${tela}`,
    );
    res.json({ padroes: Object.fromEntries(linhas.map((l) => [l.campo, l.valor])) });
  } catch (err) {
    console.error("[perfil] filtros-get:", err);
    res.status(500).json({ error: "Falha ao ler os padrões dos filtros" });
  }
});

perfilRouter.put("/filtros/:tela/:campo", async (req: AuthenticatedRequest, res) => {
  const { tela, campo } = req.params;
  const valor = validarValorFiltro((req.body ?? {}).valor);
  if (!tabelaValida(tela) || !campoFiltroValido(campo) || valor === undefined) {
    res.status(400).json({ error: "Padrão de filtro inválido" });
    return;
  }
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO preferencias_filtros (user_id, tela, campo, valor, atualizado_em)
      VALUES (${req.user!.userId}, ${tela}, ${campo}, ${JSON.stringify(valor)}::jsonb, now())
      ON CONFLICT (user_id, tela, campo) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`);
    res.json({ campo, valor });
  } catch (err) {
    console.error("[perfil] filtros-put:", err);
    res.status(500).json({ error: "Falha ao gravar o padrão do filtro" });
  }
});

perfilRouter.delete("/filtros/:tela/:campo", async (req: AuthenticatedRequest, res) => {
  const { tela, campo } = req.params;
  if (!tabelaValida(tela) || !campoFiltroValido(campo)) {
    res.status(400).json({ error: "Padrão de filtro inválido" });
    return;
  }
  try {
    await prisma.$executeRaw(
      Prisma.sql`DELETE FROM preferencias_filtros WHERE user_id = ${req.user!.userId} AND tela = ${tela} AND campo = ${campo}`,
    );
    res.json({ campo });
  } catch (err) {
    console.error("[perfil] filtros-delete:", err);
    res.status(500).json({ error: "Falha ao remover o padrão do filtro" });
  }
});

// ---- Colunas calculadas por fórmula (28/10/2026) --------------------------------------------------------------------------------
// As minhas e as publicadas de uma lista. Publicar (e mexer numa publicada de outra pessoa) é de admin; cada um mexe nas suas.

const podePublicar = (req: AuthenticatedRequest) => req.user?.role === "admin";

const SELECT_CALCULADA = Prisma.sql`SELECT c.id, c.titulo, c.formula, c.arvore, c.formato, c.casas, c.publicada, c.user_id AS "userId",
  u.nome AS autor, c.atualizado_em AS "atualizadoEm" FROM colunas_calculadas c LEFT JOIN "User" u ON u.id = c.user_id`;

perfilRouter.get("/calculadas/:tabela", async (req: AuthenticatedRequest, res) => {
  const { tabela } = req.params;
  if (!tabelaValida(tabela)) {
    res.status(400).json({ error: "Tabela inválida" });
    return;
  }
  try {
    const linhas = await prisma.$queryRaw<{ userId: number }[]>(Prisma.sql`
      ${SELECT_CALCULADA} WHERE c.tabela = ${tabela} AND (c.user_id = ${req.user!.userId} OR c.publicada) ORDER BY c.id`);
    const me = req.user!.userId;
    res.json(linhas.map((l) => ({ ...l, minha: l.userId === me, podeEditar: l.userId === me || podePublicar(req) })));
  } catch (err) {
    console.error("[perfil] calculadas-get:", err);
    res.status(500).json({ error: "Falha ao ler as colunas calculadas" });
  }
});

perfilRouter.post("/calculadas/:tabela", async (req: AuthenticatedRequest, res) => {
  const { tabela } = req.params;
  const r = validarColunaCalculada(req.body);
  if (!tabelaValida(tabela) || !r.ok) {
    res.status(400).json({ error: r.ok ? "Tabela inválida" : r.erro });
    return;
  }
  if (r.valor.publicada && !podePublicar(req)) {
    res.status(403).json({ error: "Só administrador publica coluna calculada para todos" });
    return;
  }
  try {
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*) AS n FROM colunas_calculadas WHERE tabela = ${tabela} AND user_id = ${req.user!.userId}`,
    );
    if (Number(n) >= MAX_CALCULADAS_POR_LISTA) {
      res.status(400).json({ error: `No máximo ${MAX_CALCULADAS_POR_LISTA} colunas calculadas por lista` });
      return;
    }
    const v = r.valor;
    const [criada] = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      INSERT INTO colunas_calculadas (tabela, user_id, publicada, titulo, formula, arvore, formato, casas)
      VALUES (${tabela}, ${req.user!.userId}, ${v.publicada}, ${v.titulo}, ${v.formula}, ${JSON.stringify(v.arvore)}::jsonb, ${v.formato}, ${v.casas})
      RETURNING id`);
    res.status(201).json({ id: criada.id });
  } catch (err) {
    console.error("[perfil] calculadas-post:", err);
    res.status(500).json({ error: "Falha ao gravar a coluna calculada" });
  }
});

/** A coluna da lista e se quem pede pode mexer nela (a sua; ou publicada, sendo admin/master). */
async function calculadaEditavel(req: AuthenticatedRequest): Promise<{ status: number; erro?: string; id?: number }> {
  const { tabela } = req.params;
  const id = Number(req.params.id);
  if (!tabelaValida(tabela) || !Number.isInteger(id) || id <= 0) return { status: 400, erro: "Coluna calculada inválida" };
  const [linha] = await prisma.$queryRaw<{ userId: number; publicada: boolean }[]>(
    Prisma.sql`SELECT user_id AS "userId", publicada FROM colunas_calculadas WHERE id = ${id} AND tabela = ${tabela}`,
  );
  if (!linha) return { status: 404, erro: "Coluna calculada não encontrada" };
  if (linha.userId !== req.user!.userId && !(linha.publicada && podePublicar(req))) return { status: 403, erro: "Esta coluna calculada é de outra pessoa" };
  return { status: 200, id };
}

perfilRouter.put("/calculadas/:tabela/:id", async (req: AuthenticatedRequest, res) => {
  const r = validarColunaCalculada(req.body);
  if (!r.ok) {
    res.status(400).json({ error: r.erro });
    return;
  }
  if (r.valor.publicada && !podePublicar(req)) {
    res.status(403).json({ error: "Só administrador publica coluna calculada para todos" });
    return;
  }
  try {
    const alvo = await calculadaEditavel(req);
    if (!alvo.id) {
      res.status(alvo.status).json({ error: alvo.erro });
      return;
    }
    const v = r.valor;
    await prisma.$executeRaw(Prisma.sql`
      UPDATE colunas_calculadas SET titulo = ${v.titulo}, formula = ${v.formula}, arvore = ${JSON.stringify(v.arvore)}::jsonb, formato = ${v.formato},
             casas = ${v.casas}, publicada = ${v.publicada}, atualizado_em = now()
       WHERE id = ${alvo.id}`);
    res.json({ id: alvo.id });
  } catch (err) {
    console.error("[perfil] calculadas-put:", err);
    res.status(500).json({ error: "Falha ao gravar a coluna calculada" });
  }
});

perfilRouter.delete("/calculadas/:tabela/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const alvo = await calculadaEditavel(req);
    if (!alvo.id) {
      res.status(alvo.status).json({ error: alvo.erro });
      return;
    }
    await prisma.$executeRaw(Prisma.sql`DELETE FROM colunas_calculadas WHERE id = ${alvo.id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[perfil] calculadas-delete:", err);
    res.status(500).json({ error: "Falha ao excluir a coluna calculada" });
  }
});
