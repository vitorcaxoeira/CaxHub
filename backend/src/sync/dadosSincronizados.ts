// Consulta dos dados JÁ SINCRONIZADOS de qualquer tabela espelhada do Senior (tela
// "Ver dados" em Administração > Importados do ERP). Somente leitura — o espelho nunca é
// editado por aqui. Genérico: o model Prisma certo, as colunas e a ordenação saem de
// `Prisma.dmmf` a partir da `tabelaLocal` do job (mesmo truque de recorteRetroativo.ts), então
// um job novo em registry.ts ganha a tela sem nenhum código específico.
//
// Desde 21/10/2026 tudo é no SERVIDOR, para qualquer tamanho de tabela: busca, filtro por coluna com operador (filtroColunaLocal.ts),
// valores mais frequentes de uma coluna sob demanda (valoresDaColuna) e paginação. Antes a tela carregava as tabelas pequenas
// inteiras e filtrava no cliente, e as grandes ficavam só com a busca.
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { SyncJobDescriptor } from "./registry";
import { ColunaFiltravel, FiltroColuna, OperadorColuna, TipoColuna, operadoresDaColuna, whereDosFiltros } from "./filtroColunaLocal";
import { OpcaoDominio, catalogoDeDominios, dominioDoCampo } from "./dominioDoSchema";

// Teto de linhas por chamada — protege contra tabelas enormes (itens, movimentos) mesmo que o
// cliente peça mais.
export const PAGE_SIZE_MAXIMO = 1000;

type ModeloDmmf = (typeof Prisma.dmmf.datamodel.models)[number];
type CampoDmmf = ModeloDmmf["fields"][number];

export interface ColunaDados {
  nome: string;
  // "texto" | "inteiro" | "decimal" | "data" | "booleano" | "json" — só pra alinhar/formatar
  // na tela; a lógica de busca usa o tipo Prisma direto.
  tipo: string;
  ehChave: boolean;
  // Coluna de controle do espelho (visto_em_sync/removido_em_senior), não dado do Senior.
  ehControle: boolean;
  // Não aceita nulo (sem "vazio"/"não vazio" no filtro).
  obrigatoria: boolean;
  // Operadores que o funil da coluna oferece (vazio = coluna sem filtro, ex.: json).
  operadores: OperadorColuna[];
  // Lista fechada de valores documentada no schema (/// Domínio "X": 1=..., ver dominioDoSchema.ts): o funil oferece a lista e a
  // tabela/chips mostram "código · rótulo". Ausente = coluna sem domínio.
  dominio?: OpcaoDominio[];
}

// Catálogo nome do domínio -> itens, de TODOS os campos documentados do schema (para o campo que só cita o nome, ex.: 'Domínio
// "LSimNao"'). Montado uma vez: o schema não muda em tempo de execução.
let catalogo: ReturnType<typeof catalogoDeDominios> | null = null;
function catalogoDoSchema() {
  if (!catalogo) catalogo = catalogoDeDominios(Prisma.dmmf.datamodel.models.flatMap((m) => m.fields.map((f) => f.documentation)));
  return catalogo;
}

const CAMPOS_CONTROLE = new Set(["vistoEmSync", "removidoEmSenior"]);

function modeloDaTabela(tabelaLocal: string): ModeloDmmf {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.dbName === tabelaLocal);
  if (!model) throw new Error(`Model Prisma não encontrado pra tabela local "${tabelaLocal}".`);
  return model;
}

function tipoDaColuna(campo: CampoDmmf): string {
  switch (campo.type) {
    case "Int":
    case "BigInt":
      return "inteiro";
    case "Decimal":
    case "Float":
      return "decimal";
    case "DateTime":
      return "data";
    case "Boolean":
      return "booleano";
    case "Json":
      return "json";
    default:
      return "texto";
  }
}

function camposEscalares(model: ModeloDmmf): CampoDmmf[] {
  const escalares = model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
  // Controle por último, mesmo que o schema os declare no meio.
  return [...escalares.filter((f) => !CAMPOS_CONTROLE.has(f.name)), ...escalares.filter((f) => CAMPOS_CONTROLE.has(f.name))];
}

export function colunasDoJob(job: SyncJobDescriptor): ColunaDados[] {
  const model = modeloDaTabela(job.tabelaLocal);
  const chaves = new Set(model.primaryKey?.fields?.length ? model.primaryKey.fields : model.fields.filter((f) => f.isId).map((f) => f.name));
  return camposEscalares(model).map((campo) => {
    const tipo = tipoDaColuna(campo) as TipoColuna;
    return {
      nome: campo.name,
      tipo,
      ehChave: chaves.has(campo.name),
      ehControle: CAMPOS_CONTROLE.has(campo.name),
      obrigatoria: campo.isRequired,
      operadores: operadoresDaColuna({ tipo, obrigatoria: campo.isRequired }),
      ...(() => {
        const d = dominioDoCampo(campo.documentation, campo.type, catalogoDoSchema());
        return d ? { dominio: d.opcoes } : {};
      })(),
    };
  });
}

/** Colunas com o tipo do schema, para validar e montar o filtro (filtroColunaLocal.ts). */
export function colunasFiltraveis(job: SyncJobDescriptor): ColunaFiltravel[] {
  const model = modeloDaTabela(job.tabelaLocal);
  return camposEscalares(model).map((campo) => ({
    nome: campo.name,
    tipo: tipoDaColuna(campo) as TipoColuna,
    obrigatoria: campo.isRequired,
    prisma: campo.type,
  }));
}

// BigInt não passa por JSON.stringify e Decimal vira objeto — texto nos dois casos; Date vai
// em ISO (a tela decide se mostra só o dia).
function serializar(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "bigint") return valor.toString();
  if (valor instanceof Date) return valor.toISOString();
  if (Prisma.Decimal.isDecimal(valor)) return (valor as Prisma.Decimal).toString();
  return valor;
}

// Busca de texto: `contains` (sem diferenciar maiúscula) em todas as colunas de texto, mais
// igualdade nas colunas inteiras quando o termo é um número inteiro. Datas/decimais ficam de
// fora de propósito — busca por elas é o funil da tela, não o campo de texto.
function filtroDeBusca(model: ModeloDmmf, busca: string): Record<string, unknown> | undefined {
  const termo = busca.trim();
  if (!termo) return undefined;
  const condicoes: Record<string, unknown>[] = [];
  for (const campo of camposEscalares(model)) {
    if (CAMPOS_CONTROLE.has(campo.name)) continue;
    if (campo.type === "String") condicoes.push({ [campo.name]: { contains: termo, mode: "insensitive" } });
    else if (campo.type === "Int" && /^-?\d{1,9}$/.test(termo)) condicoes.push({ [campo.name]: { equals: Number(termo) } });
    else if (campo.type === "BigInt" && /^\d{1,18}$/.test(termo)) condicoes.push({ [campo.name]: { equals: BigInt(termo) } });
  }
  // `OR: []` não casa nada no Prisma — tabela sem coluna pesquisável devolve vazio em vez de tudo.
  return { OR: condicoes };
}

export interface ResultadoDados {
  colunas: ColunaDados[];
  total: number;
  itens: Record<string, unknown>[];
}

/**
 * Recorte de "removidos" da tela de dados (21/10/2026, pedido do Vitor: a lista de removidos virou uma tela igual ao "Ver dados"):
 *  - "removidos": já marcados (`removidoEmSenior` preenchido);
 *  - "candidatos": os que a ÚLTIMA varredura acharia sumidos (vivos, carimbo anterior ao início dela) DENTRO do recorte do filtro da
 *    sincronização — a mesma conta da varredura, para o número bater com o selo "teto · N";
 *  - "sumidos": os dois juntos.
 */
export type SituacaoRemovidos = "removidos" | "candidatos" | "sumidos";

// Tabelas de MÃO DUPLA (e Pedido) chamam varrerRemovidos() direto, sem `incluirNuncaCarimbados`: lá carimbo NULL é registro nascido
// no CaxHub e nunca é candidato. Nas de espelho puro (executarVarreduraDoJob) NULL também é candidato.
const MODELOS_NULL_IMUNE = new Set(["AtividadeConsultor", "Pedido", "Rat", "RatItem", "RegistroDespesaViagem"]);

function filtroDeSituacao(
  model: ModeloDmmf,
  situacao: SituacaoRemovidos,
  candidatosDesde: Date | null,
  escopo: Record<string, unknown> | null
): Record<string, unknown> {
  const marcados = { removidoEmSenior: { not: null } };
  // Sem varredura registrada, ou com filtro que não dá para recortar localmente, não há como dizer quem é candidato.
  if (situacao === "removidos" || !candidatosDesde || escopo === null) return situacao === "candidatos" ? { AND: [{ removidoEmSenior: null }, { removidoEmSenior: { not: null } }] } : marcados;
  const carimbo = MODELOS_NULL_IMUNE.has(model.name)
    ? { vistoEmSync: { lt: candidatosDesde } }
    : { OR: [{ vistoEmSync: { lt: candidatosDesde } }, { vistoEmSync: null }] };
  const candidatos = { AND: [escopo, { removidoEmSenior: null }, carimbo] };
  return situacao === "candidatos" ? candidatos : { OR: [marcados, candidatos] };
}

// Recorte comum à listagem e aos valores de uma coluna: busca + situação (removidos) + filtros de coluna, tudo em E.
interface OpcoesRecorte {
  busca: string;
  /** Só na tela de removidos: recorte por situação (ver SituacaoRemovidos). */
  situacao?: SituacaoRemovidos;
  /** Início da última varredura (SyncLog.varreduraInicio): quem tem carimbo anterior não veio nela. */
  candidatosDesde?: Date | null;
  /** Recorte local do filtro da sincronização (filtroDoJob().escopoLocal); `null` = filtro não recortável. */
  escopo?: Record<string, unknown> | null;
  /** Filtros de coluna já validados (validarFiltrosColuna). */
  filtros?: FiltroColuna[];
}

function whereDoRecorte(job: SyncJobDescriptor, model: ModeloDmmf, opcoes: OpcoesRecorte): Record<string, unknown> | undefined {
  const partes = [
    filtroDeBusca(model, opcoes.busca),
    opcoes.situacao
      ? filtroDeSituacao(model, opcoes.situacao, opcoes.candidatosDesde ?? null, opcoes.escopo === undefined ? {} : opcoes.escopo)
      : undefined,
    whereDosFiltros(colunasFiltraveis(job), opcoes.filtros ?? []),
  ].filter((p): p is Record<string, unknown> => p !== undefined);
  return partes.length === 0 ? undefined : partes.length === 1 ? partes[0] : { AND: partes };
}

function delegateDoModelo(model: ModeloDmmf, tabelaLocal: string) {
  const nomeDelegate = model.name.charAt(0).toLowerCase() + model.name.slice(1);
  const delegate = (prisma as unknown as Record<string, unknown>)[nomeDelegate] as {
    count: (args: { where?: unknown }) => Promise<number>;
    findMany: (args: { where?: unknown; orderBy?: unknown; skip?: number; take?: number }) => Promise<Record<string, unknown>[]>;
    groupBy: (args: { by: string[]; where?: unknown; _count: Record<string, boolean>; orderBy?: unknown; take?: number }) => Promise<Record<string, unknown>[]>;
  };
  if (!delegate) throw new Error(`prisma.${nomeDelegate} não existe (esperado pra tabela "${tabelaLocal}").`);
  return delegate;
}

export async function listarDadosDoJob(
  job: SyncJobDescriptor,
  opcoes: {
    page: number;
    pageSize: number;
    busca: string;
    filtros?: FiltroColuna[];
    /** Só na tela de removidos: recorte por situação (ver SituacaoRemovidos). */
    situacao?: SituacaoRemovidos;
    /** Início da última varredura (SyncLog.varreduraInicio): quem tem carimbo anterior não veio nela. */
    candidatosDesde?: Date | null;
    /** Recorte local do filtro da sincronização (filtroDoJob().escopoLocal); `null` = filtro não recortável. */
    escopo?: Record<string, unknown> | null;
  }
): Promise<ResultadoDados> {
  const model = modeloDaTabela(job.tabelaLocal);
  const delegate = delegateDoModelo(model, job.tabelaLocal);

  const pageSize = Math.min(PAGE_SIZE_MAXIMO, Math.max(1, Math.floor(opcoes.pageSize) || 30));
  const page = Math.max(1, Math.floor(opcoes.page) || 1);
  const where = whereDoRecorte(job, model, opcoes);
  const chaves = model.primaryKey?.fields?.length ? [...model.primaryKey.fields] : model.fields.filter((f) => f.isId).map((f) => f.name);

  const [total, linhas] = await Promise.all([
    delegate.count({ where }),
    delegate.findMany({ where, orderBy: chaves.map((c) => ({ [c]: "asc" })), skip: (page - 1) * pageSize, take: pageSize }),
  ]);

  const colunas = colunasDoJob(job);
  return {
    colunas,
    total,
    itens: linhas.map((linha) => Object.fromEntries(colunas.map((c) => [c.nome, serializar(linha[c.nome])]))),
  };
}

const MAX_VALORES_COLUNA = 200;

export interface ValoresDaColuna {
  coluna: string;
  /** Valores mais frequentes (no máximo 200), já serializados; `null` = vazio. */
  valores: { valor: unknown; quantidade: number }[];
  /** Há mais valores distintos além dos devolvidos (a tela avisa e pede para refinar com a busca). */
  temMais: boolean;
}

/**
 * Valores mais frequentes de UMA coluna dentro do recorte atual (aba "Valores" do funil). O filtro da própria coluna fica de fora, como
 * no Excel, para dar para trocar a seleção. `termo` restringe os valores: `contains` em texto, igualdade em número.
 */
export async function valoresDaColuna(job: SyncJobDescriptor, coluna: string, opcoes: OpcoesRecorte & { termo: string }): Promise<ValoresDaColuna> {
  const model = modeloDaTabela(job.tabelaLocal);
  const delegate = delegateDoModelo(model, job.tabelaLocal);
  const col = colunasFiltraveis(job).find((c) => c.nome === coluna);
  if (!col || col.tipo === "json") throw new Error(`A coluna "${coluna}" não tem filtro.`);
  const semAPropria = { ...opcoes, filtros: (opcoes.filtros ?? []).filter((f) => f.coluna !== coluna) };
  const recorte = whereDoRecorte(job, model, semAPropria);
  const termo = opcoes.termo.trim();
  let doTermo: Record<string, unknown> | undefined;
  if (termo) {
    if (col.tipo === "texto") doTermo = { [coluna]: { contains: termo, mode: "insensitive" } };
    else if (col.tipo === "inteiro" && /^-?\d{1,18}$/.test(termo)) doTermo = { [coluna]: col.prisma === "BigInt" ? BigInt(termo) : Number(termo) };
    else if (col.tipo === "decimal" && /^-?\d+(\.\d+)?$/.test(termo)) doTermo = { [coluna]: termo };
    else doTermo = { AND: [{ [coluna]: null }, { [coluna]: { not: null } }] }; // termo que não casa com o tipo: nenhum valor
  }
  const where = recorte && doTermo ? { AND: [recorte, doTermo] } : recorte ?? doTermo;
  // Um a mais que o teto só para saber se há mais: contar todos os distintos traria centenas de milhares de grupos numa coluna quase
  // única (numlct).
  const grupos = await delegate.groupBy({ by: [coluna], where, _count: { _all: true }, orderBy: { _count: { [coluna]: "desc" } }, take: MAX_VALORES_COLUNA + 1 });
  // `_count` por coluna não conta nulos; a quantidade real de cada grupo vem de `_all`. Reordena por ela (nulos podem ser muitos).
  const valores = grupos
    .slice(0, MAX_VALORES_COLUNA)
    .map((g) => ({ valor: serializar(g[coluna]), quantidade: Number((g._count as { _all: number })._all) }))
    .sort((a, b) => b.quantidade - a.quantidade);
  return { coluna, valores, temMais: grupos.length > MAX_VALORES_COLUNA };
}
