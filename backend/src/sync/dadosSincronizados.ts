// Consulta dos dados JÁ SINCRONIZADOS de qualquer tabela espelhada do Senior (tela
// "Ver dados" em Administração > Importados do Senior). Somente leitura — o espelho nunca é
// editado por aqui. Genérico: o model Prisma certo, as colunas e a ordenação saem de
// `Prisma.dmmf` a partir da `tabelaLocal` do job (mesmo truque de recorteRetroativo.ts), então
// um job novo em registry.ts ganha a tela sem nenhum código específico.
//
// Padrão herdado do "Ver dados" do Kyria (CaxHub): a tela decide o modo pelo TAMANHO real da
// tabela — pequena: carrega tudo e filtra/pagina no cliente (funil por coluna); grande: busca e
// paginação no servidor.
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { SyncJobDescriptor } from "./registry";

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
  return camposEscalares(model).map((campo) => ({
    nome: campo.name,
    tipo: tipoDaColuna(campo),
    ehChave: chaves.has(campo.name),
    ehControle: CAMPOS_CONTROLE.has(campo.name),
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

export async function listarDadosDoJob(
  job: SyncJobDescriptor,
  opcoes: { page: number; pageSize: number; busca: string }
): Promise<ResultadoDados> {
  const model = modeloDaTabela(job.tabelaLocal);
  const nomeDelegate = model.name.charAt(0).toLowerCase() + model.name.slice(1);
  const delegate = (prisma as unknown as Record<string, unknown>)[nomeDelegate] as {
    count: (args: { where?: unknown }) => Promise<number>;
    findMany: (args: { where?: unknown; orderBy?: unknown; skip?: number; take?: number }) => Promise<Record<string, unknown>[]>;
  };
  if (!delegate) throw new Error(`prisma.${nomeDelegate} não existe (esperado pra tabela "${job.tabelaLocal}").`);

  const pageSize = Math.min(PAGE_SIZE_MAXIMO, Math.max(1, Math.floor(opcoes.pageSize) || 30));
  const page = Math.max(1, Math.floor(opcoes.page) || 1);
  const where = filtroDeBusca(model, opcoes.busca);
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
