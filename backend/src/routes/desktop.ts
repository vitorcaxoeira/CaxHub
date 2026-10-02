import { createHash, randomBytes } from "crypto";
import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { signToken } from "../auth/jwt";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor } from "../domain/contextoProjeto";
import { periodosDoDia } from "../domain/jornadaConsultor";
import { paraHoraBrasil } from "../domain/fusoBrasil";

// Suporte ao CaxHub Desktop (app Tauri com a janela flutuante). Só quem tem Consultor com
// `codfor` vinculado usa: é o mesmo critério de GET /atividades/minha-sessao-aberta — sem isso
// o usuário não executa atividade nenhuma e a janela não teria o que mostrar.
export const desktopRouter = Router();

const VALIDADE_DISPOSITIVO_MS = 30 * 24 * 60 * 60 * 1000;
const MODOS = ["pilula", "expandida"] as const;
// 0 = não avisar. Entre 5 min (abaixo disso vira incômodo) e 4 h.
const FREQUENCIA_MIN = 5;
const FREQUENCIA_MAX = 240;

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[desktop:${label}]`, message);
  res.status(500).json({ error: message });
}

function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------- Troca do token de dispositivo por um JWT de sessão ----------
// Público de propósito (o app abre sem JWT válido: ele dura 8h). O token de dispositivo é
// aleatório de 256 bits e só existe em hash no banco. NÃO rotaciona a cada uso: se o app
// caísse entre receber o token novo e gravá-lo, o computador ficaria trancado pra fora.
// A validade desliza (30 dias desde o último uso) e o usuário pode revogar pelo Perfil.
desktopRouter.post("/sessao", async (req, res) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!token) {
      res.status(400).json({ error: "token é obrigatório" });
      return;
    }
    const agora = new Date();
    const dispositivo = await prisma.dispositivoDesktop.findUnique({
      where: { tokenHash: hashDoToken(token) },
      include: { user: { include: { role: true } } },
    });
    // Mesma resposta pra todo motivo de recusa: não diz se o token existiu, venceu ou foi revogado.
    if (!dispositivo || dispositivo.revogadoEm || dispositivo.expiraEm <= agora || dispositivo.user.status !== "ativo") {
      res.status(401).json({ error: "Dispositivo não autorizado" });
      return;
    }
    await prisma.dispositivoDesktop.update({
      where: { id: dispositivo.id },
      data: { ultimoUsoEm: agora, expiraEm: new Date(agora.getTime() + VALIDADE_DISPOSITIVO_MS) },
    });
    const { user } = dispositivo;
    res.json({
      token: signToken({ userId: user.id, role: user.role.name }),
      user: { id: user.id, email: user.email, nome: user.nome, fotoUrl: user.fotoUrl, role: user.role.name },
    });
  } catch (error) {
    handleError(res, error, "sessao");
  }
});

desktopRouter.use(requireAuth);

// Consultor vinculado (com codfor) do usuário logado; null = não pode usar o recurso.
async function consultorDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true } });
  if (!user) return null;
  const { consultor } = await resolverContextoConsultor(user.email);
  return consultor && consultor.codfor != null ? { codemp: consultor.codemp, codfor: consultor.codfor } : null;
}

async function exigirConsultor(req: AuthenticatedRequest, res: import("express").Response) {
  const consultor = await consultorDoUsuario(req);
  if (!consultor) {
    res.status(403).json({ error: "Recurso disponível só para usuários com consultor vinculado" });
    return null;
  }
  return consultor;
}

// ---------- Quem sou eu (consultor vinculado) ----------
// A janela flutuante filtra as atividades pelo `codfor` do próprio consultor — não dá pra usar
// o padrão de GET /atividades/opcoes-filtro, que pra gestor devolve o time inteiro. Também é a
// consulta de elegibilidade do frontend: 403 = usuário sem consultor, esconde o recurso.
desktopRouter.get("/eu", async (req: AuthenticatedRequest, res) => {
  try {
    const consultor = await exigirConsultor(req, res);
    if (!consultor) return;
    res.json(consultor);
  } catch (error) {
    handleError(res, error, "eu");
  }
});

// ---------- Preferências ----------
const PADRAO = { abrirAoIniciar: true, sempreNoTopo: true, alertasJornada: true, frequenciaAvisoMin: 15, modoInicial: "expandida" };

function preferenciaPublica(p: {
  abrirAoIniciar: boolean;
  sempreNoTopo: boolean;
  alertasJornada: boolean;
  frequenciaAvisoMin: number;
  modoInicial: string;
}) {
  return {
    abrirAoIniciar: p.abrirAoIniciar,
    sempreNoTopo: p.sempreNoTopo,
    alertasJornada: p.alertasJornada,
    frequenciaAvisoMin: p.frequenciaAvisoMin,
    modoInicial: p.modoInicial,
  };
}

desktopRouter.get("/preferencias", async (req: AuthenticatedRequest, res) => {
  try {
    if (!(await exigirConsultor(req, res))) return;
    const pref = await prisma.preferenciaDesktop.findUnique({ where: { userId: req.user!.userId } });
    res.json(preferenciaPublica(pref ?? PADRAO));
  } catch (error) {
    handleError(res, error, "preferencias-get");
  }
});

desktopRouter.put("/preferencias", async (req: AuthenticatedRequest, res) => {
  try {
    if (!(await exigirConsultor(req, res))) return;
    const body = req.body ?? {};
    const data: {
      abrirAoIniciar?: boolean;
      sempreNoTopo?: boolean;
      alertasJornada?: boolean;
      frequenciaAvisoMin?: number;
      modoInicial?: string;
    } = {};
    for (const campo of ["abrirAoIniciar", "sempreNoTopo", "alertasJornada"] as const) {
      if (body[campo] === undefined) continue;
      if (typeof body[campo] !== "boolean") {
        res.status(400).json({ error: `${campo} precisa ser verdadeiro ou falso` });
        return;
      }
      data[campo] = body[campo];
    }
    if (body.frequenciaAvisoMin !== undefined) {
      const f = body.frequenciaAvisoMin;
      if (!Number.isInteger(f) || (f !== 0 && (f < FREQUENCIA_MIN || f > FREQUENCIA_MAX))) {
        res.status(400).json({ error: `frequenciaAvisoMin precisa ser 0 (desligado) ou de ${FREQUENCIA_MIN} a ${FREQUENCIA_MAX} minutos` });
        return;
      }
      data.frequenciaAvisoMin = f;
    }
    if (body.modoInicial !== undefined) {
      if (!MODOS.includes(body.modoInicial)) {
        res.status(400).json({ error: `modoInicial precisa ser um de: ${MODOS.join(", ")}` });
        return;
      }
      data.modoInicial = body.modoInicial;
    }
    const pref = await prisma.preferenciaDesktop.upsert({
      where: { userId: req.user!.userId },
      update: data,
      create: { userId: req.user!.userId, ...data },
    });
    res.json(preferenciaPublica(pref));
  } catch (error) {
    handleError(res, error, "preferencias-put");
  }
});

// ---------- Jornada de hoje (alerta "expediente começou e nada iniciado") ----------
desktopRouter.get("/jornada-hoje", async (req: AuthenticatedRequest, res) => {
  try {
    const consultor = await exigirConsultor(req, res);
    if (!consultor) return;
    const agora = paraHoraBrasil(new Date());
    const jornada = await prisma.jornadaConsultor.findUnique({
      where: { codemp_codfor_diaSemana: { codemp: consultor.codemp, codfor: consultor.codfor, diaSemana: agora.diaSemana } },
    });
    // Consultor sem jornada cadastrada simplesmente não recebe o lembrete (lista vazia).
    res.json({ periodos: jornada ? periodosDoDia(jornada) : [], minutosAgora: agora.minutosDoDia });
  } catch (error) {
    handleError(res, error, "jornada-hoje");
  }
});

// ---------- Computadores conectados ----------
desktopRouter.get("/dispositivos", async (req: AuthenticatedRequest, res) => {
  try {
    const itens = await prisma.dispositivoDesktop.findMany({
      where: { userId: req.user!.userId, revogadoEm: null, expiraEm: { gt: new Date() } },
      orderBy: { ultimoUsoEm: "desc" },
      select: { id: true, nome: true, criadoEm: true, ultimoUsoEm: true },
    });
    res.json({ dispositivos: itens });
  } catch (error) {
    handleError(res, error, "dispositivos-get");
  }
});

// Devolve o token em claro UMA vez; depois só o hash existe.
desktopRouter.post("/dispositivos", async (req: AuthenticatedRequest, res) => {
  try {
    if (!(await exigirConsultor(req, res))) return;
    const nome = typeof req.body?.nome === "string" ? req.body.nome.trim().slice(0, 120) : "";
    const token = randomBytes(32).toString("hex");
    const dispositivo = await prisma.dispositivoDesktop.create({
      data: {
        userId: req.user!.userId,
        nome: nome || "Computador sem nome",
        tokenHash: hashDoToken(token),
        expiraEm: new Date(Date.now() + VALIDADE_DISPOSITIVO_MS),
      },
    });
    res.status(201).json({ id: dispositivo.id, token });
  } catch (error) {
    handleError(res, error, "dispositivos-post");
  }
});

desktopRouter.delete("/dispositivos/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    // Só revoga o do próprio usuário; id de outro usuário responde igual a inexistente.
    const r = await prisma.dispositivoDesktop.updateMany({
      where: { id, userId: req.user!.userId, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
    if (r.count === 0) {
      res.status(404).json({ error: "Dispositivo não encontrado" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "dispositivos-delete");
  }
});
