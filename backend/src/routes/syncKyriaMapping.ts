import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, requireRole, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { KYRIA_KNOWN_RESOURCES } from "../kyria/knownResources";
import { previewKyriaResource } from "../kyria/fieldPreview";

// Workflow de mapeamento/tipagem de campos (Administração > Integração Kyria > Mapeamento de
// Campos, 18/09/2026, pedido do Vitor) — arquivo separado de sync-kyria.ts de propósito:
// sync-kyria.ts é sobre jobs que já existem em KYRIA_SYNC_JOBS; aqui opera sobre recursos que
// ainda podem nem ter job nenhum (é um passo ANTES disso). Registrar aqui NÃO cria/altera tabela
// nenhuma no Postgres — é uma especificação que o desenvolvedor usa depois pra escrever o model
// Prisma + migração de verdade, à mão, revisada (mesma disciplina de sempre).
export const syncKyriaMappingRouter = Router();
syncKyriaMappingRouter.use(requireAuth, requireRole("admin"));

// Espelha os valores do enum KyriaTipoCampo (schema.prisma) — não dá pra introspectar um enum
// Prisma em runtime sem uma query extra, então mantemos essa lista mínima em sincronia à mão.
const TIPOS_VALIDOS = ["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json"] as const;
type TipoCampoValido = (typeof TIPOS_VALIDOS)[number];

// Nome interno SEMPRE snake_case minúsculo, a partir do camelCase de origem (ex.: "statusKey" ->
// "status_key") — pedido do Vitor (18/09/2026), vira o nome da coluna Postgres de verdade na
// migração. Normalizado aqui no backend (não só no frontend) pra garantir isso mesmo que a
// chamada não venha da tela — mesma função existe no frontend (MapeamentoKyria.tsx) pra dar
// feedback imediato enquanto o admin digita; aplicar de novo aqui é idempotente.
function paraSnakeCase(nome: string): string {
  return nome
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sync-kyria-mapping:${label}]`, message);
  res.status(500).json({ error: message });
}

syncKyriaMappingRouter.get("/known-resources", async (_req, res) => {
  try {
    const registrados = await prisma.kyriaResourceMapping.findMany({
      select: { id: true, resourcePath: true },
    });
    const porPath = new Map(registrados.map((r) => [r.resourcePath, r.id]));

    res.json({
      recursos: KYRIA_KNOWN_RESOURCES.map((recurso) => ({
        ...recurso,
        registrado: porPath.has(recurso.path),
        resourceId: porPath.get(recurso.path) ?? null,
      })),
    });
  } catch (error) {
    handleError(res, error, "known-resources");
  }
});

syncKyriaMappingRouter.post("/preview", async (req, res) => {
  try {
    const path = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!path) {
      res.status(400).json({ error: "Informe o caminho do endpoint (ex.: /teams)" });
      return;
    }

    const conhecido = KYRIA_KNOWN_RESOURCES.find((r) => r.path === path);
    const preview = await previewKyriaResource(path, conhecido?.openApiSchemaName);
    res.json(preview);
  } catch (error) {
    handleError(res, error, "preview");
  }
});

interface CampoRegistro {
  nomeOrigem: string | null;
  ordem: number;
  manter: boolean;
  tipoEscolhido: string;
  nomeInterno: string;
  nullable: boolean;
  tamanho: number | null;
  precisao: number | null;
  escala: number | null;
  tipoInferidoAmostra: string | null;
  valorExemplo: string | null;
  tipoOpenApi: string | null;
  nullableOpenApi: boolean | null;
  enumOpenApi: string[] | null;
  relacionamentoModelo: string | null;
  relacionamentoCampo: string | null;
  relacionamentoCampoDescricao: string | null;
}

syncKyriaMappingRouter.post("/register", async (req: AuthenticatedRequest, res) => {
  try {
    const path = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
    const campos: CampoRegistro[] = Array.isArray(req.body?.campos) ? req.body.campos : [];
    const amostraBruta = req.body?.amostraBruta ?? null;

    if (!path || !displayName) {
      res.status(400).json({ error: "path e displayName são obrigatórios" });
      return;
    }
    if (campos.length === 0) {
      res.status(400).json({ error: "Informe ao menos um campo" });
      return;
    }

    // nomeOrigem vazio/ausente = campo interno (sem amostra real da API por trás) — normaliza
    // pra null antes de qualquer outra validação, pra não confundir "string vazia" com "campo
    // sem nome de origem de propósito".
    for (const campo of campos) {
      campo.nomeOrigem = typeof campo.nomeOrigem === "string" && campo.nomeOrigem.trim() ? campo.nomeOrigem.trim() : null;
    }

    const semNomeInterno = campos.filter((c) => !c.nomeInterno?.trim());
    if (semNomeInterno.length > 0) {
      res.status(400).json({
        error: `Todo campo precisa de um nome interno (faltando em: ${semNomeInterno.map((c) => c.nomeOrigem ?? "(campo interno)").join(", ")})`,
      });
      return;
    }
    // Normaliza ANTES de checar duplicidade — dois nomes que só divergem em maiúscula/minúscula
    // ou convenção (ex.: "statusKey" vindo cru de uma chamada fora da tela) viram a mesma coluna
    // depois da normalização, e o conflito precisa aparecer aqui, não silenciosamente na hora do
    // `createMany`.
    for (const campo of campos) campo.nomeInterno = paraSnakeCase(campo.nomeInterno.trim());
    const nomesInternos = campos.map((c) => c.nomeInterno);
    const duplicados = nomesInternos.filter((nome, i) => nomesInternos.indexOf(nome) !== i);
    if (duplicados.length > 0) {
      res.status(400).json({ error: `Nome interno repetido: ${[...new Set(duplicados)].join(", ")}` });
      return;
    }
    const tipoInvalido = campos.find((c) => !TIPOS_VALIDOS.includes(c.tipoEscolhido as TipoCampoValido));
    if (tipoInvalido) {
      res.status(400).json({ error: `Tipo inválido em "${tipoInvalido.nomeInterno}": ${tipoInvalido.tipoEscolhido}` });
      return;
    }

    // Relacionamento (opcional) — os dois campos vêm juntos ou nenhum, e quando vêm precisam
    // apontar pra um model/campo escalar que existe DE VERDADE no schema.prisma atual (mesma
    // introspecção via dmmf de GET /internal-models, ver ali).
    const camposEscalaresPorModelo = new Map(
      Prisma.dmmf.datamodel.models.map((m) => [m.name, m.fields.filter((f) => f.kind === "scalar").map((f) => f.name)])
    );
    for (const campo of campos) {
      const temModelo = !!campo.relacionamentoModelo;
      const temCampo = !!campo.relacionamentoCampo;
      if (temModelo !== temCampo) {
        res.status(400).json({ error: `Relacionamento incompleto em "${campo.nomeInterno}": informe modelo e campo juntos, ou nenhum dos dois` });
        return;
      }
      if (temModelo) {
        const camposDoModelo = camposEscalaresPorModelo.get(campo.relacionamentoModelo as string);
        if (!camposDoModelo) {
          res.status(400).json({ error: `Modelo Prisma inválido em relacionamento: "${campo.relacionamentoModelo}"` });
          return;
        }
        if (!camposDoModelo.includes(campo.relacionamentoCampo as string)) {
          res.status(400).json({ error: `Campo "${campo.relacionamentoCampo}" não existe em "${campo.relacionamentoModelo}"` });
          return;
        }
      }
      // Campo de descrição (opcional) — só faz sentido junto de um relacionamento, e precisa
      // ser um campo escalar de verdade do mesmo model já validado acima.
      if (campo.relacionamentoCampoDescricao && !temModelo) {
        res.status(400).json({ error: `Campo de descrição em "${campo.nomeInterno}" exige um relacionamento (modelo e campo) definido` });
        return;
      }
      if (campo.relacionamentoCampoDescricao) {
        const camposDoModelo = camposEscalaresPorModelo.get(campo.relacionamentoModelo as string);
        if (!camposDoModelo?.includes(campo.relacionamentoCampoDescricao)) {
          res.status(400).json({ error: `Campo de descrição "${campo.relacionamentoCampoDescricao}" não existe em "${campo.relacionamentoModelo}"` });
          return;
        }
      }
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const recurso = await tx.kyriaResourceMapping.upsert({
        where: { resourcePath: path },
        update: { displayName, amostraBruta: amostraBruta ?? undefined, atualizadoPor: req.user?.userId ?? null },
        create: { resourcePath: path, displayName, amostraBruta: amostraBruta ?? undefined, atualizadoPor: req.user?.userId ?? null },
      });

      await tx.kyriaFieldMapping.deleteMany({ where: { resourceId: recurso.id } });
      await tx.kyriaFieldMapping.createMany({
        data: campos.map((c) => ({
          resourceId: recurso.id,
          nomeOrigem: c.nomeOrigem,
          ordem: c.ordem,
          manter: c.manter,
          tipoEscolhido: c.tipoEscolhido as TipoCampoValido,
          nomeInterno: c.nomeInterno,
          nullable: c.nullable,
          tamanho: c.tamanho ?? null,
          precisao: c.precisao ?? null,
          escala: c.escala ?? null,
          tipoInferidoAmostra: c.tipoInferidoAmostra ?? null,
          valorExemplo: c.valorExemplo ?? null,
          tipoOpenApi: c.tipoOpenApi ?? null,
          nullableOpenApi: c.nullableOpenApi ?? null,
          enumOpenApi: c.enumOpenApi ?? undefined,
          relacionamentoModelo: c.relacionamentoModelo ?? null,
          relacionamentoCampo: c.relacionamentoCampo ?? null,
          relacionamentoCampoDescricao: c.relacionamentoCampoDescricao ?? null,
        })),
      });

      return recurso;
    });

    res.json({ resourceId: resultado.id, resourcePath: resultado.resourcePath });
  } catch (error) {
    handleError(res, error, "register");
  }
});

syncKyriaMappingRouter.get("/", async (_req, res) => {
  try {
    const recursos = await prisma.kyriaResourceMapping.findMany({
      include: { _count: { select: { campos: true } } },
      orderBy: { resourcePath: "asc" },
    });
    res.json({
      recursos: recursos.map((r) => ({
        id: r.id,
        resourcePath: r.resourcePath,
        displayName: r.displayName,
        totalCampos: r._count.campos,
        atualizadoEm: r.atualizadoEm,
      })),
    });
  } catch (error) {
    handleError(res, error, "list");
  }
});

// Lista toda tabela/campo interno disponível como alvo de relacionamento — introspecção do
// PRÓPRIO schema.prisma via Prisma.dmmf (mesmo mecanismo já usado do lado Senior em
// sync/catalogoCampos.ts e sync/recorteRetroativo.ts, nunca antes usado pra listar TODO o
// schema, só pra achar um model específico). Registrado ANTES de "/:resourceId" — senão o
// Express tentaria casar "internal-models" como resourceId.
syncKyriaMappingRouter.get("/internal-models", async (_req, res) => {
  try {
    const modelos = Prisma.dmmf.datamodel.models
      .map((model) => ({
        nome: model.name,
        tabela: model.dbName ?? null,
        campos: model.fields
          .filter((f) => f.kind === "scalar")
          .map((f) => ({
            nome: f.name,
            tipo: f.type,
            ehChavePrimaria: !!model.primaryKey?.fields?.includes(f.name) || f.isId,
          })),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    res.json({ modelos });
  } catch (error) {
    handleError(res, error, "internal-models");
  }
});

syncKyriaMappingRouter.get("/:resourceId", async (req, res) => {
  try {
    const resourceId = Number(req.params.resourceId);
    if (!Number.isInteger(resourceId)) {
      res.status(400).json({ error: "resourceId inválido" });
      return;
    }

    const recurso = await prisma.kyriaResourceMapping.findUnique({
      where: { id: resourceId },
      include: { campos: { orderBy: { ordem: "asc" } } },
    });
    if (!recurso) {
      res.status(404).json({ error: "Recurso não encontrado" });
      return;
    }

    res.json(recurso);
  } catch (error) {
    handleError(res, error, "detail");
  }
});
