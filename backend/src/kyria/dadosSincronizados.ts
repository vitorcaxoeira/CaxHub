import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { pkFieldsDoModel } from "../sync/recorteRetroativo";
import type { KyriaSyncJobDescriptor } from "./registry";

// Consulta/edição dos dados JÁ SINCRONIZADOS (Administração > Integração Kyria > "Ver dados",
// 18/09/2026, pedido do Vitor) — diferente de tudo mais nesta pasta, isto GRAVA em cima de dado
// real, não é mais spec. Por isso o escopo do que pode ser editado é estrito: só campo marcado
// como interno (nomeOrigem null) e mantido (manter true) no KyriaFieldMapping registrado — nunca
// um campo que veio da API, esse só o job de sync escreve.
//
// Resolver local, mais largo que sync/recorteRetroativo.ts:delegatePorTabelaLocal — aquele não
// expõe `skip` nem `update` no tipo de retorno (só precisava de count/updateMany/findMany sem
// paginação pra varredura de removidos). Em vez de alargar um helper de um módulo
// conceitualmente "Fase 5 do plano de filtros do Senior" com capacidade que só a Kyria precisa,
// esta é uma versão própria pequena, mesma técnica de dmmf.
type Model = (typeof Prisma.dmmf.datamodel.models)[number];

function resolverModel(nome: string, porTabela: boolean): Model | null {
  return Prisma.dmmf.datamodel.models.find((m) => (porTabela ? m.dbName : m.name) === nome) ?? null;
}

function resolverDelegate(model: Model) {
  const nomeDelegate = model.name.charAt(0).toLowerCase() + model.name.slice(1);
  return (prisma as unknown as Record<string, any>)[nomeDelegate];
}

// Nome do campo Prisma (camelCase) a partir do nome da coluna Postgres — nomeInterno já é
// snake_case (a própria coluna), mas o `data` de um update do Prisma quer o nome do FIELD, que
// diverge quando há `@map` (ex.: KyriaTeam.parentTeamId tem nomeInterno "parent_team_id"). Mesma
// técnica de sync/catalogoCampos.ts:campoLocal (dbName ?? name).
function campoPrismaPorColuna(model: Model, coluna: string): string | null {
  return model.fields.find((f) => (f.dbName ?? f.name) === coluna)?.name ?? null;
}

function clampPagina(valor: unknown, min: number, max: number, padrao: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export interface ColunaDados {
  nomeInterno: string;
  ehInterno: boolean;
  relacionamentoModelo: string | null;
  relacionamentoCampo: string | null;
  relacionamentoCampoDescricao: string | null;
}

export interface ListaDados {
  total: number;
  page: number;
  pageSize: number;
  colunas: ColunaDados[];
  itens: Record<string, unknown>[];
  // Por coluna com relacionamentoCampoDescricao registrado: mapa "valor bruto da coluna" ->
  // rótulo legível ("123" -> "ACME LTDA"), já resolvido em lote pra tela "Ver dados" não
  // precisar de N+1 consulta por linha.
  descricoes: Record<string, Record<string, string>>;
}

/**
 * Colunas a mostrar pra tabela do job, cruzando com o mapeamento registrado (se existir) pra
 * marcar quais são internas/editáveis. Sem mapeamento registrado pro recurso, devolve as
 * colunas cruas do Prisma, nenhuma marcada como interna — degrada com segurança (mostra o
 * dado, não deixa editar sem saber o que é seguro).
 */
async function resolverColunas(job: KyriaSyncJobDescriptor, model: Model): Promise<ColunaDados[]> {
  const recurso = await prisma.kyriaResourceMapping.findUnique({
    where: { resourcePath: job.path },
    include: { campos: { where: { manter: true }, orderBy: { ordem: "asc" } } },
  });

  return recurso
    ? recurso.campos.map((c) => ({
        nomeInterno: c.nomeInterno,
        ehInterno: c.nomeOrigem === null,
        relacionamentoModelo: c.relacionamentoModelo,
        relacionamentoCampo: c.relacionamentoCampo,
        relacionamentoCampoDescricao: c.relacionamentoCampoDescricao,
      }))
    : model.fields
        .filter((f) => f.kind === "scalar")
        .map((f) => ({
          nomeInterno: f.dbName ?? f.name,
          ehInterno: false,
          relacionamentoModelo: null,
          relacionamentoCampo: null,
          relacionamentoCampoDescricao: null,
        }));
}

/**
 * Resolve em lote o rótulo legível de cada coluna com relacionamento+descrição registrados —
 * uma consulta por coluna (não por linha): junta os valores distintos já carregados em `itens`,
 * busca só `relacionamentoCampo`+`relacionamentoCampoDescricao` da tabela relacionada com um
 * `IN`, monta um mapa "valor -> rótulo". Coluna sem relacionamentoCampoDescricao registrado nem
 * entra no resultado (tela mostra só o valor cru, como já fazia).
 */
async function resolverDescricoes(colunas: ColunaDados[], itens: Record<string, unknown>[]): Promise<Record<string, Record<string, string>>> {
  const resultado: Record<string, Record<string, string>> = {};

  for (const coluna of colunas) {
    if (!coluna.ehInterno || !coluna.relacionamentoModelo || !coluna.relacionamentoCampo || !coluna.relacionamentoCampoDescricao) continue;

    const valores = [...new Set(itens.map((item) => item[coluna.nomeInterno]).filter((v) => v !== null && v !== undefined))];
    if (valores.length === 0) continue;

    const modelo = resolverModel(coluna.relacionamentoModelo, false);
    if (!modelo) continue;
    const delegate = resolverDelegate(modelo);

    const linhas = await delegate.findMany({
      where: { [coluna.relacionamentoCampo]: { in: valores } },
      select: { [coluna.relacionamentoCampo]: true, [coluna.relacionamentoCampoDescricao]: true },
    });

    const mapa: Record<string, string> = {};
    for (const linha of linhas) {
      const chave = String(linha[coluna.relacionamentoCampo as string]);
      const rotulo = linha[coluna.relacionamentoCampoDescricao as string];
      if (rotulo !== null && rotulo !== undefined) mapa[chave] = String(rotulo);
    }
    resultado[coluna.nomeInterno] = mapa;
  }

  return resultado;
}

/** Lista as linhas já sincronizadas da tabela do job, paginado no servidor. */
export async function listarDados(job: KyriaSyncJobDescriptor, pageRaw: unknown, pageSizeRaw: unknown): Promise<ListaDados> {
  const model = resolverModel(job.tabelaLocal, true);
  if (!model) throw new Error(`Model Prisma não encontrado pra tabela local "${job.tabelaLocal}".`);
  const delegate = resolverDelegate(model);

  const page = clampPagina(pageRaw, 1, Number.MAX_SAFE_INTEGER, 1);
  const pageSize = clampPagina(pageSizeRaw, 1, 100, 30);
  const pk = pkFieldsDoModel(job.tabelaLocal);

  const [total, itens, colunas] = await Promise.all([
    delegate.count(),
    delegate.findMany({ skip: (page - 1) * pageSize, take: pageSize, orderBy: pk.map((campo) => ({ [campo]: "asc" })) }),
    resolverColunas(job, model),
  ]);
  const descricoes = await resolverDescricoes(colunas, itens);

  return { total, page, pageSize, colunas, itens, descricoes };
}

export interface ListaCompleta {
  colunas: ColunaDados[];
  itens: Record<string, unknown>[];
  descricoes: Record<string, Record<string, string>>;
}

/**
 * Todas as linhas da tabela do job, sem paginação — pro filtro de coluna no cliente (mesmo
 * espírito de routes/pedidos.ts:GET /por-cliente/indice, que também busca tudo de uma vez pra
 * filtrar/paginar em JS). Tabelas Kyria de hoje são pequenas (9 times, 167 membros); se um
 * recurso futuro (ex.: tickets) crescer muito, isto precisa virar filtro server-side.
 */
export async function listarTodosDados(job: KyriaSyncJobDescriptor): Promise<ListaCompleta> {
  const model = resolverModel(job.tabelaLocal, true);
  if (!model) throw new Error(`Model Prisma não encontrado pra tabela local "${job.tabelaLocal}".`);
  const delegate = resolverDelegate(model);
  const pk = pkFieldsDoModel(job.tabelaLocal);

  const [itens, colunas] = await Promise.all([
    delegate.findMany({ orderBy: pk.map((campo) => ({ [campo]: "asc" })) }),
    resolverColunas(job, model),
  ]);
  const descricoes = await resolverDescricoes(colunas, itens);

  return { colunas, itens, descricoes };
}

/**
 * Edita um campo INTERNO de uma linha já sincronizada — nunca um campo vindo da API (isso é
 * validado aqui, não confiado ao chamador). Quando o campo tem relacionamento registrado, o
 * valor só é aceito se corresponder a uma linha de verdade da tabela relacionada.
 */
export async function editarCampoInterno(job: KyriaSyncJobDescriptor, id: string, campo: string, valor: unknown): Promise<Record<string, unknown>> {
  const recurso = await prisma.kyriaResourceMapping.findUnique({
    where: { resourcePath: job.path },
    include: { campos: true },
  });
  const campoMapeado = recurso?.campos.find((c) => c.nomeInterno === campo);
  if (!campoMapeado) throw new ErroValidacao(`Campo "${campo}" não está registrado no mapeamento de "${job.path}".`);
  if (campoMapeado.nomeOrigem !== null) throw new ErroValidacao(`Campo "${campo}" vem da API — só campo interno pode ser editado aqui.`);
  if (!campoMapeado.manter) throw new ErroValidacao(`Campo "${campo}" está marcado como "não manter" no mapeamento.`);

  if (campoMapeado.relacionamentoModelo && campoMapeado.relacionamentoCampo) {
    const modeloRelacionado = resolverModel(campoMapeado.relacionamentoModelo, false);
    if (!modeloRelacionado) throw new ErroValidacao(`Model relacionado "${campoMapeado.relacionamentoModelo}" não existe mais no schema.`);
    const delegateRelacionado = resolverDelegate(modeloRelacionado);
    const existe = await delegateRelacionado.findFirst({ where: { [campoMapeado.relacionamentoCampo]: valor } });
    if (!existe) {
      throw new ErroValidacao(`Nenhum registro de "${campoMapeado.relacionamentoModelo}" tem ${campoMapeado.relacionamentoCampo} = ${JSON.stringify(valor)}.`);
    }
  }

  const model = resolverModel(job.tabelaLocal, true);
  if (!model) throw new Error(`Model Prisma não encontrado pra tabela local "${job.tabelaLocal}".`);
  const campoPrisma = campoPrismaPorColuna(model, campo);
  if (!campoPrisma) throw new ErroValidacao(`Coluna "${campo}" não existe no model "${model.name}".`);

  // A rota só manda UM `id` (um segmento de URL) — funciona pras tabelas Kyria de hoje, todas
  // com PK simples (`id: String @id`). Nenhuma tem PK composta ainda; se um dia tiver, isto
  // precisa de um `id` estruturado (ex.: "codemp:codusu") em vez do valor único assumido aqui.
  const pk = pkFieldsDoModel(job.tabelaLocal);
  if (pk.length !== 1) throw new Error(`"Ver dados" só suporta tabela com PK simples — "${job.tabelaLocal}" tem PK composta (${pk.join(", ")}).`);
  const delegate = resolverDelegate(model);
  return delegate.update({ where: { [pk[0]]: id }, data: { [campoPrisma]: valor } });
}

export interface ListaRelacionados {
  total: number;
  page: number;
  pageSize: number;
  colunas: string[];
  itens: Record<string, unknown>[];
}

/**
 * Busca/lista linhas de QUALQUER model interno, pro seletor de registro relacionado — genérico,
 * sem código específico por tabela. `busca` filtra por `contains` (case-insensitive) OR em todo
 * campo escalar String do model.
 */
export async function buscarRegistrosRelacionados(nomeModelo: string, busca: string, pageRaw: unknown, pageSizeRaw: unknown): Promise<ListaRelacionados> {
  const model = resolverModel(nomeModelo, false);
  if (!model) throw new ErroValidacao(`Model "${nomeModelo}" não existe.`);
  const delegate = resolverDelegate(model);
  const camposEscalares = model.fields.filter((f) => f.kind === "scalar");
  const camposString = camposEscalares.filter((f) => f.type === "String").map((f) => f.name);

  const page = clampPagina(pageRaw, 1, Number.MAX_SAFE_INTEGER, 1);
  // Teto 500 (não 100): o modal de seleção (DadosKyria.tsx) pede até 500 de uma vez só pra
  // decidir se a tabela é pequena o bastante pra filtro de coluna no cliente (== "índice") ou
  // grande demais (cai de volta pra busca+paginação no servidor, sem funil). Default (20)
  // continua baixo — só quem pede explicitamente um pageSize maior paga o custo.
  const pageSize = clampPagina(pageSizeRaw, 1, 500, 20);
  const where =
    busca.trim() && camposString.length > 0
      ? { OR: camposString.map((campo) => ({ [campo]: { contains: busca.trim(), mode: "insensitive" as const } })) }
      : undefined;

  const [total, itens] = await Promise.all([
    delegate.count({ where }),
    delegate.findMany({ where, skip: (page - 1) * pageSize, take: pageSize }),
  ]);

  return { total, page, pageSize, colunas: camposEscalares.map((f) => f.name), itens };
}

/** Erro de validação de negócio — a rota traduz isso pra 400 (não 500, ver syncKyriaDados.ts). */
export class ErroValidacao extends Error {}
