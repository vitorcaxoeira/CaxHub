import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { gestorNomePorDepartamento } from "../domain/contextoProjeto";
import { depexeLabel } from "../domain/propostasDominio";

// Administração > Integração Kyria > Departamento x Time Kyria (rentabilidade, ajuste 02 de
// 17/11/2026). Liga cada departamento aos times do Kyria cujo atendimento ele representa — o
// equivalente, no Kyria, da "Categoria" do antigo 0800 (ERP / HCM / Acesso e Segurança): o time do
// TICKET diz de que departamento são as horas de suporte. Config 100% nativa (tabela
// DepartamentoTimeKyria), mesmo molde de Departamento x Grupo Contábil (routes/contabil.ts).
//
// 18/11/2026 (pedido do Vitor): a mesma tela ganhou as ETIQUETAS que cada departamento usa para filtrar os tickets da análise (tabela
// DepartamentoLabelKyria). Só são oferecidas as etiquetas dos grupos de etiqueta com `fitro_dep_time = true`.
//
// Montado em server.ts ANTES de "/sync-kyria" (mesmo motivo de "/sync-kyria/mapping" e
// "/sync-kyria/dados").
export const syncKyriaDepartamentosRouter = Router();
syncKyriaDepartamentosRouter.use(requireAuth, requireRole("admin"));

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sync-kyria-departamentos:${label}]`, message);
  res.status(500).json({ error: message });
}

interface EtiquetaLinha {
  id: string;
  name: string;
  status: string;
  grupo: string | null;
}

// Nome da etiqueta, com "(inativa)" quando o Kyria a marcou como inativa. O grupo vai em campo à parte (`grupo`): a tela agrupa a lista por ele e
// o mostra no cabeçalho do grupo, então o rótulo não repete o nome do grupo.
function rotuloDaEtiqueta(l: EtiquetaLinha): string {
  return `${l.name}${l.status === "inactive" ? " (inativa)" : ""}`;
}

/** Etiquetas dos grupos de etiqueta marcados com `fitro_dep_time = true`: todas as do grupo, na ordem grupo → ordem da etiqueta → nome. */
function etiquetasParaFiltro(): Promise<EtiquetaLinha[]> {
  return prisma.$queryRaw<EtiquetaLinha[]>`
    SELECT l.id, l.name, l.status::text AS status, g.name AS grupo
    FROM kyria_labels l
    JOIN kyria_label_groups g ON g.id = l.group_id
    WHERE g.fitro_dep_time = true
    ORDER BY g.name, l.sort_order NULLS LAST, l.name`;
}

function etiquetasPorId(ids: string[]): Promise<EtiquetaLinha[]> {
  return prisma.$queryRaw<EtiquetaLinha[]>`
    SELECT l.id, l.name, l.status::text AS status, g.name AS grupo
    FROM kyria_labels l
    LEFT JOIN kyria_label_groups g ON g.id = l.group_id
    WHERE l.id = ANY(${ids}::text[])
    ORDER BY g.name NULLS LAST, l.name`;
}

syncKyriaDepartamentosRouter.get("/", async (_req, res) => {
  try {
    const [gestores, ligacoes, ligacoesLabels, times, horasPorTime, labelsHabilitadas, gruposHabilitados] = await Promise.all([
      prisma.departamentoGestor.findMany({ where: { removidoEmSenior: null }, select: { codemp: true, depexe: true } }),
      prisma.departamentoTimeKyria.findMany(),
      prisma.departamentoLabelKyria.findMany(),
      prisma.kyriaTeam.findMany({ select: { id: true, key: true, name: true, status: true }, orderBy: { name: "asc" } }),
      // Horas apontadas nos tickets de cada time nos últimos 12 meses — só pra quem for decidir o
      // mapeamento ver o peso de cada time. O time é o do TICKET: o `team_id` do próprio
      // apontamento vem nulo/divergente em boa parte das linhas.
      prisma.$queryRaw<{ id: string | null; horas: number }[]>`
        SELECT t.team_id AS id, (SUM(e.minutes) / 60)::float8 AS horas
        FROM kyria_time_entries e
        JOIN kyria_tickets t ON t.id = e.ticket_id
        WHERE e.started_at >= now() - interval '12 months'
        GROUP BY t.team_id
      `,
      // Todas as etiquetas (ativas e inativas) dos grupos marcados com fitro_dep_time = true.
      etiquetasParaFiltro(),
      prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM kyria_label_groups WHERE fitro_dep_time = true`,
    ]);

    const timesPorDepartamento = new Map<string, string[]>();
    for (const l of ligacoes) {
      const chave = `${l.codemp}-${l.depexe}`;
      timesPorDepartamento.set(chave, [...(timesPorDepartamento.get(chave) ?? []), l.kyriaTeamId]);
    }
    const labelsPorDepartamento = new Map<string, string[]>();
    for (const l of ligacoesLabels) {
      const chave = `${l.codemp}-${l.depexe}`;
      labelsPorDepartamento.set(chave, [...(labelsPorDepartamento.get(chave) ?? []), l.kyriaLabelId]);
    }
    // Etiqueta já escolhida por algum departamento cujo grupo deixou de ser marcado: continua na lista (marcada), senão a escolha sumiria da tela.
    const habilitadas = new Set(labelsHabilitadas.map((l) => l.id));
    const foraDoFiltro = [...new Set(ligacoesLabels.map((l) => l.kyriaLabelId))].filter((id) => !habilitadas.has(id));
    const etiquetasSemGrupoMarcado = foraDoFiltro.length ? await etiquetasPorId(foraDoFiltro) : [];
    const nomes = await gestorNomePorDepartamento(gestores);
    const horasDoTime = new Map(horasPorTime.filter((h) => h.id).map((h) => [h.id as string, Math.round(h.horas)]));

    res.json({
      departamentos: gestores
        .map((g) => ({
          codemp: g.codemp,
          depexe: g.depexe,
          depexeLabel: depexeLabel(g.depexe),
          gestorNome: nomes.get(`${g.codemp}-${g.depexe}`) ?? null,
          times: timesPorDepartamento.get(`${g.codemp}-${g.depexe}`) ?? [],
          labels: labelsPorDepartamento.get(`${g.codemp}-${g.depexe}`) ?? [],
        }))
        .sort((a, b) => a.depexe - b.depexe),
      timesDisponiveis: times.map((t) => ({
        value: t.id,
        label: `${t.name}${t.status === "inactive" ? " (inativo)" : ""} · ${(horasDoTime.get(t.id) ?? 0).toLocaleString("pt-BR")} h/12m`,
      })),
      gruposHabilitados: gruposHabilitados[0]?.n ?? 0,
      labelsDisponiveis: [
        ...labelsHabilitadas.map((l) => ({ value: l.id, label: rotuloDaEtiqueta(l), grupo: l.grupo ?? "Sem grupo" })),
        // Escolha antiga cujo grupo deixou de ser marcado: continua visível, num grupo à parte.
        ...etiquetasSemGrupoMarcado.map((l) => ({ value: l.id, label: rotuloDaEtiqueta(l), grupo: `${l.grupo ?? "Sem grupo"} (sem filtro)` })),
      ],
    });
  } catch (error) {
    handleError(res, error, "get");
  }
});

syncKyriaDepartamentosRouter.put("/:codemp/:depexe", async (req, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const depexe = Number(req.params.depexe);
    const bruto: unknown = req.body?.timeIds;
    if (!Number.isInteger(codemp) || !Number.isInteger(depexe) || !Array.isArray(bruto) || bruto.some((t) => typeof t !== "string" || !t)) {
      res.status(400).json({ error: "codemp, depexe e timeIds (lista de ids de time do Kyria) são obrigatórios" });
      return;
    }
    const timeIds = [...new Set(bruto as string[])];

    const departamento = await prisma.departamentoGestor.findFirst({ where: { codemp, depexe, removidoEmSenior: null }, select: { depexe: true } });
    if (!departamento) {
      res.status(404).json({ error: "Departamento não encontrado" });
      return;
    }
    const existentes = await prisma.kyriaTeam.count({ where: { id: { in: timeIds } } });
    if (existentes !== timeIds.length) {
      res.status(400).json({ error: "Algum time informado não existe no Kyria sincronizado" });
      return;
    }

    await prisma.$transaction([
      prisma.departamentoTimeKyria.deleteMany({ where: { codemp, depexe } }),
      prisma.departamentoTimeKyria.createMany({ data: timeIds.map((kyriaTeamId) => ({ codemp, depexe, kyriaTeamId })), skipDuplicates: true }),
    ]);
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "put");
  }
});

// Grava (substitui) as etiquetas do departamento. Só aceita etiqueta de grupo marcado com fitro_dep_time = true, ou uma que o próprio departamento
// já tinha (permite mexer nas outras sem perder uma escolha cujo grupo deixou de ser marcado).
syncKyriaDepartamentosRouter.put("/:codemp/:depexe/labels", async (req, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const depexe = Number(req.params.depexe);
    const bruto: unknown = req.body?.labelIds;
    if (!Number.isInteger(codemp) || !Number.isInteger(depexe) || !Array.isArray(bruto) || bruto.some((t) => typeof t !== "string" || !t)) {
      res.status(400).json({ error: "codemp, depexe e labelIds (lista de ids de etiqueta do Kyria) são obrigatórios" });
      return;
    }
    const labelIds = [...new Set(bruto as string[])];

    const departamento = await prisma.departamentoGestor.findFirst({ where: { codemp, depexe, removidoEmSenior: null }, select: { depexe: true } });
    if (!departamento) {
      res.status(404).json({ error: "Departamento não encontrado" });
      return;
    }
    const existentes = await prisma.kyriaLabel.count({ where: { id: { in: labelIds } } });
    if (existentes !== labelIds.length) {
      res.status(400).json({ error: "Alguma etiqueta informada não existe no Kyria sincronizado" });
      return;
    }
    const [habilitadas, jaTinha] = await Promise.all([etiquetasParaFiltro(), prisma.departamentoLabelKyria.findMany({ where: { codemp, depexe }, select: { kyriaLabelId: true } })]);
    const permitidas = new Set([...habilitadas.map((l) => l.id), ...jaTinha.map((l) => l.kyriaLabelId)]);
    const naoPermitidas = labelIds.filter((id) => !permitidas.has(id));
    if (naoPermitidas.length > 0) {
      res.status(400).json({ error: "Só etiquetas de grupos marcados com fitro_dep_time = Sim podem ser escolhidas (marque o grupo em Ver dados dos Grupos de Etiqueta)" });
      return;
    }

    await prisma.$transaction([
      prisma.departamentoLabelKyria.deleteMany({ where: { codemp, depexe } }),
      prisma.departamentoLabelKyria.createMany({ data: labelIds.map((kyriaLabelId) => ({ codemp, depexe, kyriaLabelId })), skipDuplicates: true }),
    ]);
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "put-labels");
  }
});
