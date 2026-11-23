// Lista de recursos do Mapeamento de Campos vinda da DOCUMENTAÇÃO da API do Kyria (18/11/2026, pedido do Vitor): em vez de uma lista fixa no
// código, a tela lê o `openapi.json` (a mesma fonte que a doc interativa em /api/v1/docs renderiza) e oferece todos os GETs dele, com o resumo,
// os parâmetros de caminho/query e a URL completa. Lógica PURA (recebe o spec) + uma função de busca; sem cache de propósito — um cache
// mascararia justamente a mudança de contrato que ler a doc existe pra mostrar.
import axios from "axios";
import { kyriaBaseUrl } from "./client";

const BASE_PADRAO = "https://elegant-llama-879.convex.site/api/v1";
const PREFIXO_API = "/api/v1";

export interface ParametroDoc {
  nome: string;
  local: "path" | "query";
  obrigatorio: boolean;
  tipo: string | null;
  enumValores: string[] | null;
  padrao: string | null;
  descricao: string | null;
  /** O sistema preenche (não a pessoa): as datas do relatório de horas usam o mês corrente e nunca são gravadas no recurso (ver competencia.ts). */
  preenchidoPeloSistema: boolean;
}

export interface RecursoDoc {
  /** Caminho sem o prefixo /api/v1, com {parametros} (ex.: /tickets/{ticketId}/messages). */
  caminho: string;
  resumo: string;
  /** Primeiro segmento do caminho (tickets, reports...), pra agrupar na lista. */
  grupo: string;
  parametrosCaminho: ParametroDoc[];
  /** Query SEM limit/cursor: a paginação é do sistema (o preview força limit=1). */
  parametrosQuery: ParametroDoc[];
  /** Tem `limit` na doc: só aí o preview manda limit=1 (nos demais, parâmetro desconhecido poderia ser recusado). */
  paginado: boolean;
  /** Nome do schema do ITEM da resposta (ex.: Team), pra cruzar tipos no preview. Nulo quando o item é polimórfico ou agregado. */
  schemaItem: string | null;
}

export interface DocumentacaoKyria {
  versao: string | null;
  baseUrl: string;
  docsUrl: string;
  recursos: RecursoDoc[];
  /** Schemas do spec, pra o preview achar as propriedades do item. */
  schemas: Record<string, { properties?: Record<string, unknown> }>;
}

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Segue um `$ref` interno (#/components/...). Devolve o próprio nó quando não é referência. */
function resolver(spec: Obj, no: unknown): Obj | null {
  if (!ehObj(no)) return null;
  const ref = no.$ref;
  if (typeof ref !== "string") return no;
  if (!ref.startsWith("#/")) return null;
  let atual: unknown = spec;
  for (const parte of ref.slice(2).split("/")) {
    if (!ehObj(atual)) return null;
    atual = atual[parte];
  }
  return ehObj(atual) ? atual : null;
}

const nomeDoRef = (no: unknown): string | null => (ehObj(no) && typeof no.$ref === "string" ? (no.$ref.split("/").pop() ?? null) : null);

// `from`/`to` do relatório de horas: preenchidos pelo sistema com o mês corrente (fieldPreview.ts / competencia.ts).
function preenchidoPeloSistema(caminho: string, nome: string): boolean {
  return caminho === "/reports/hours" && (nome === "from" || nome === "to");
}

function parametrosDe(spec: Obj, caminho: string, operacao: Obj, itemDoCaminho: Obj): ParametroDoc[] {
  const brutos = [...(Array.isArray(itemDoCaminho.parameters) ? itemDoCaminho.parameters : []), ...(Array.isArray(operacao.parameters) ? operacao.parameters : [])];
  const saida: ParametroDoc[] = [];
  for (const bruto of brutos) {
    const p = resolver(spec, bruto);
    if (!p || typeof p.name !== "string" || (p.in !== "path" && p.in !== "query")) continue;
    const schema = resolver(spec, p.schema) ?? {};
    const tipos = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const principal = tipos.find((t) => t !== "null");
    saida.push({
      nome: p.name,
      local: p.in,
      obrigatorio: p.in === "path" ? true : p.required === true,
      tipo: typeof principal === "string" ? principal : null,
      enumValores: Array.isArray(schema.enum) ? schema.enum.map(String) : null,
      padrao: schema.default !== undefined && schema.default !== null ? String(schema.default) : null,
      descricao: typeof p.description === "string" ? p.description : typeof schema.description === "string" ? schema.description : null,
      preenchidoPeloSistema: p.in === "query" && preenchidoPeloSistema(caminho, p.name),
    });
  }
  return saida;
}

/** Nome do schema do item devolvido: lista (`data: [Item]`) ou registro único (`data: Item`). Agregado/polimórfico sem nome → nulo. */
export function schemaDoItem(spec: Obj, operacao: Obj): string | null {
  const respostas = ehObj(operacao.responses) ? operacao.responses : {};
  const ok = resolver(spec, respostas["200"]);
  const conteudo = ehObj(ok?.content) ? ok.content : null;
  const json = conteudo && ehObj(conteudo["application/json"]) ? conteudo["application/json"] : null;
  const envelope = resolver(spec, json?.schema);
  const props = envelope && ehObj(envelope.properties) ? envelope.properties : null;
  const data = props ? props.data : null;
  if (!ehObj(data)) return null;
  if (data.type === "array") return nomeDoRef(data.items);
  return nomeDoRef(data);
}

/** Todos os GETs da documentação, em ordem de grupo e caminho. */
export function recursosGetDaDoc(spec: unknown): RecursoDoc[] {
  if (!ehObj(spec) || !ehObj(spec.paths)) return [];
  const recursos: RecursoDoc[] = [];
  for (const [caminhoCru, item] of Object.entries(spec.paths)) {
    if (!ehObj(item) || !ehObj(item.get)) continue;
    const caminho = caminhoCru.startsWith(PREFIXO_API) ? caminhoCru.slice(PREFIXO_API.length) : caminhoCru;
    const todos = parametrosDe(spec, caminho, item.get, item);
    recursos.push({
      caminho,
      resumo: typeof item.get.summary === "string" ? item.get.summary : caminho,
      grupo: caminho.split("/").filter(Boolean)[0] ?? "",
      parametrosCaminho: todos.filter((p) => p.local === "path"),
      parametrosQuery: todos.filter((p) => p.local === "query" && p.nome !== "limit" && p.nome !== "cursor"),
      paginado: todos.some((p) => p.local === "query" && p.nome === "limit"),
      schemaItem: schemaDoItem(spec, item.get),
    });
  }
  return recursos.sort((a, b) => a.grupo.localeCompare(b.grupo) || a.caminho.localeCompare(b.caminho));
}

export interface CaminhoCasado {
  recurso: RecursoDoc;
  valoresCaminho: Record<string, string>;
  valoresQuery: Record<string, string>;
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * De um caminho salvo (`/reports/hours?groupBy=customer`, `/tickets/abc/messages`) volta ao recurso da documentação e aos valores dos
 * parâmetros. Em empate escolhe o mais específico (mais segmentos literais). Nulo se a documentação não tem mais a rota.
 */
export function casarCaminho(resourcePath: string, recursos: RecursoDoc[]): CaminhoCasado | null {
  const [base, consulta = ""] = resourcePath.split("?");
  const segmentos = base.split("/").filter(Boolean);
  let melhor: { recurso: RecursoDoc; literais: number; valores: Record<string, string> } | null = null;
  for (const recurso of recursos) {
    const modelo = recurso.caminho.split("/").filter(Boolean);
    if (modelo.length !== segmentos.length) continue;
    const valores: Record<string, string> = {};
    let literais = 0;
    let confere = true;
    modelo.forEach((m, i) => {
      const param = /^\{(.+)\}$/.exec(m);
      if (param) valores[param[1]] = decodeURIComponent(segmentos[i]);
      else if (new RegExp(`^${escaparRegex(m)}$`).test(segmentos[i])) literais++;
      else confere = false;
    });
    if (confere && (!melhor || literais > melhor.literais)) melhor = { recurso, literais, valores };
  }
  if (!melhor) return null;
  const valoresQuery: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(consulta)) valoresQuery[k] = v;
  return { recurso: melhor.recurso, valoresCaminho: melhor.valores, valoresQuery };
}

/** Lê o openapi.json AO VIVO (público, sem auth) e devolve a documentação já organizada. Lança com mensagem clara se não conseguir. */
export async function buscarDocumentacao(): Promise<DocumentacaoKyria> {
  const baseUrl = kyriaBaseUrl() || BASE_PADRAO;
  let spec: unknown;
  try {
    const { data } = await axios.get(`${baseUrl}/openapi.json`, { timeout: 10000 });
    spec = data;
  } catch {
    throw new Error("Não consegui ler a documentação da API do Kyria (openapi.json). Tente de novo em instantes.");
  }
  const recursos = recursosGetDaDoc(spec);
  if (recursos.length === 0) throw new Error("A documentação do Kyria veio sem nenhum endpoint GET.");
  const info = ehObj(spec) && ehObj(spec.info) ? spec.info : {};
  const componentes = ehObj(spec) && ehObj(spec.components) ? spec.components : {};
  return {
    versao: typeof info.version === "string" ? info.version : null,
    baseUrl,
    docsUrl: `${baseUrl}/docs`,
    recursos,
    schemas: (ehObj(componentes.schemas) ? componentes.schemas : {}) as DocumentacaoKyria["schemas"],
  };
}
