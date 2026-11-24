import { Prisma } from "@prisma/client";
import { dominioDoCampo, catalogoDeDominios } from "../sync/dominioDoSchema";
import { col } from "./colunasDeSubconsulta";
import type { ColunaConsulta } from "./consultaColunas";

// Campos das tabelas que uma lista já consulta (12/11/2026): além das colunas que a tela declara, a pessoa liga qualquer campo da tabela alvo
// e das relacionadas (ex.: Gestão Propostas -> todos os campos de `propostas` e de `clientes`). O catálogo sai do schema Prisma (Prisma.dmmf),
// então campo novo no schema aparece sozinho; só entram no SELECT os campos PEDIDOS (`campos` na query), nunca `alias.*`.
//
// Segurança: o cliente só manda NOMES (`<fonte>__<campo>`); o SQL é montado aqui a partir do catálogo, com a coluna que o schema declara.
// Nome fora do catálogo é ignorado. Colunas de controle do espelho (visto_em_sync, removido_em_senior) e as `omitir` da fonte nunca entram.

/** Uma tabela que a consulta da lista já tem em mãos (já ligada por JOIN, com `alias`) e cujos campos podem virar colunas. */
export interface FonteCampos {
  /** Id curto, só `[a-z0-9]` (entra no nome da coluna: `<id>__<campo>`). */
  id: string;
  /** Como a fonte aparece para a pessoa (ex.: "Cliente"). */
  titulo: string;
  /** Tabela no Postgres (`@@map` do model Prisma). */
  tabela: string;
  /** Alias da tabela na consulta base da lista (ex.: `p`, `c`). */
  alias: string;
  /** Campos (nome do campo no schema Prisma) que não são oferecidos (ex.: dado sensível). */
  omitir?: string[];
  /** A fonte entra na consulta por LEFT JOIN: todo campo dela pode vir nulo. */
  opcional?: boolean;
}

export interface CampoCatalogo {
  /** Nome da coluna na lista: `<fonte>__<campo>`. */
  nome: string;
  fonte: string;
  /** Nome do campo no schema Prisma. */
  campo: string;
  /** Nome da coluna no Postgres. */
  coluna: string;
  tipo: ColunaConsulta["tipo"];
  obrigatoria: boolean;
  dominio?: { valor: string; rotulo: string }[];
}

type ModeloDmmf = (typeof Prisma.dmmf.datamodel.models)[number];

const CONTROLE = new Set(["vistoEmSync", "removidoEmSenior"]);
/** Teto de campos extras por lista (guarda contra pedido enorme; a tela real usa meia dúzia). */
export const MAX_CAMPOS_EXTRAS = 40;

const TIPO: Record<string, ColunaConsulta["tipo"] | undefined> = {
  String: "texto",
  Int: "inteiro",
  BigInt: "inteiro",
  Decimal: "decimal",
  Float: "decimal",
  DateTime: "data",
  Boolean: "booleano",
};

let dominios: ReturnType<typeof catalogoDeDominios> | null = null;
function catalogoDeDominiosDoSchema() {
  if (!dominios) dominios = catalogoDeDominios(Prisma.dmmf.datamodel.models.flatMap((m) => m.fields.map((f) => f.documentation)));
  return dominios;
}

function modeloDaTabela(tabela: string): ModeloDmmf {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.dbName === tabela);
  if (!model) throw new Error(`Model Prisma não encontrado para a tabela "${tabela}".`);
  return model;
}

const memoria = new Map<string, CampoCatalogo[]>();

/** Campos oferecidos de uma fonte, na ordem do schema. Memoizado: o schema não muda em tempo de execução. */
export function catalogoDaFonte(fonte: FonteCampos): CampoCatalogo[] {
  const chave = `${fonte.id}|${fonte.tabela}|${(fonte.omitir ?? []).join(",")}|${fonte.opcional ? 1 : 0}`;
  const guardado = memoria.get(chave);
  if (guardado) return guardado;
  if (!/^[a-z0-9]+$/.test(fonte.id)) throw new Error(`Id de fonte inválido: "${fonte.id}"`);
  const omitir = new Set(fonte.omitir ?? []);
  const model = modeloDaTabela(fonte.tabela);
  const campos: CampoCatalogo[] = [];
  for (const f of model.fields) {
    if ((f.kind !== "scalar" && f.kind !== "enum") || CONTROLE.has(f.name) || omitir.has(f.name)) continue;
    const tipo = f.kind === "enum" ? "texto" : TIPO[f.type];
    if (!tipo) continue; // Json/Bytes: sem filtro nem formato úteis
    const d = dominioDoCampo(f.documentation, f.type, catalogoDeDominiosDoSchema());
    campos.push({
      nome: `${fonte.id}__${f.name}`,
      fonte: fonte.id,
      campo: f.name,
      coluna: f.dbName ?? f.name,
      tipo,
      obrigatoria: f.isRequired && !fonte.opcional,
      ...(d ? { dominio: d.opcoes } : {}),
    });
  }
  memoria.set(chave, campos);
  return campos;
}

/** Nomes pedidos em `campos` (texto "a,b,c") que existem no catálogo, sem repetição, na ordem pedida e até MAX_CAMPOS_EXTRAS. */
export function lerCamposPedidos(fontes: FonteCampos[], bruto: unknown): CampoCatalogo[] {
  if (typeof bruto !== "string" || !bruto.trim()) return [];
  const porNome = new Map(fontes.flatMap((f) => catalogoDaFonte(f)).map((c) => [c.nome, c]));
  const vistos = new Set<string>();
  const saida: CampoCatalogo[] = [];
  for (const nome of bruto.split(",").map((n) => n.trim())) {
    const campo = porNome.get(nome);
    if (!campo || vistos.has(nome)) continue;
    vistos.add(nome);
    saida.push(campo);
    if (saida.length >= MAX_CAMPOS_EXTRAS) break;
  }
  return saida;
}

export interface ExtrasDaConsulta {
  /** `, p."tippro" AS "proposta__tippro"` ... para o SELECT da consulta base (vazio sem campos). */
  selecao: Prisma.Sql;
  /** `, b."proposta__tippro"` ... para a camada de fora repassar as colunas (`b` = alias da consulta base). */
  repasse: Prisma.Sql;
  /** As colunas da lista para os campos pedidos (some às que a tela declara). */
  colunas: ColunaConsulta[];
}

const SEM_EXTRAS: ExtrasDaConsulta = { selecao: Prisma.empty, repasse: Prisma.empty, colunas: [] };

function colunaDe(c: CampoCatalogo): ColunaConsulta {
  const o = { obrigatoria: c.obrigatoria, titulo: c.campo, fonte: c.fonte, ...(c.dominio ? { dominio: c.dominio } : {}) };
  return col[c.tipo](c.nome, o);
}

/**
 * O que a consulta da lista precisa para mostrar os campos pedidos em `query.campos`. `aliasBase` é o alias da consulta base na camada de
 * fora (`b` em gestaoPropostasSql.ts). Sem pedido (ou sem fontes), tudo vazio: a consulta fica byte a byte a de antes.
 */
export function extrasDaConsulta(fontes: FonteCampos[], query: Record<string, unknown>, aliasBase = "b"): ExtrasDaConsulta {
  const pedidos = lerCamposPedidos(fontes, query.campos);
  if (pedidos.length === 0) return SEM_EXTRAS;
  const aliasDe = new Map(fontes.map((f) => [f.id, f.alias]));
  return {
    selecao: Prisma.sql`, ${Prisma.join(pedidos.map((c) => Prisma.raw(`${aliasDe.get(c.fonte)}."${c.coluna}" AS "${c.nome}"`)))}`,
    repasse: Prisma.sql`, ${Prisma.join(pedidos.map((c) => Prisma.raw(`${aliasBase}."${c.nome}"`)))}`,
    colunas: pedidos.map(colunaDe),
  };
}

/** Humaniza o nome do campo quando o dicionário do Senior não responde (`nomcli` -> `nomcli`; camelCase -> "camel Case"). */
export const tituloPadraoDoCampo = (campo: string) => campo.replace(/([a-z])([A-Z])/g, "$1 $2");
