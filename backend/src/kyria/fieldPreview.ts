import axios from "axios";
import { getKyriaSample } from "./client";
import { competenciaAtual } from "./competencia";

const KYRIA_OPENAPI_URL = "https://elegant-llama-879.convex.site/api/v1/openapi.json";

export type TipoInferidoAmostra = "string" | "number" | "boolean" | "object" | "array" | "null";

// Sugestão de tipo Prisma a partir do tipo inferido da amostra — só um DEFAULT pro <select> da
// tela, nunca gravado sem o admin confirmar. `array` sempre sugere Json, sem flatten — mesmo
// tratamento que `KyriaTeam.appearance` já recebia quando ainda era array/estrutura variável.
// `object` só cai aqui se sobrar aninhado depois de UM nível de achatamento (ver `achatarUmNivel`
// logo abaixo) — objeto bem raso vira campos próprios, só o que ainda estiver aninhado 2+ níveis
// continua Json opaco.
const TIPO_SUGERIDO: Record<Exclude<TipoInferidoAmostra, "number">, string> = {
  string: "String",
  boolean: "Boolean",
  object: "Json",
  array: "Json",
  null: "String",
};

// Limite do INTEGER do Postgres (4 bytes) — um `number` acima disso sugerido como "Int" cria
// uma coluna que já nasce incapaz de guardar o próprio valor de amostra. Achado ao testar
// `/customers` de verdade (18/09/2026): `createdAt`/`updatedAt` vêm como epoch em
// MILISSEGUNDOS (ex.: 1785282433326), bem acima disso — sugerir "Int" pra esses campos seria um
// erro na cara, exatamente o tipo de coisa que esta ferramenta existe pra evitar.
const LIMITE_INTEGER_POSTGRES = 2147483647;
// Epoch em milissegundos pra qualquer data depois de 2001 já passa de 10^12 — limiar seguro pra
// diferenciar "isso parece timestamp" de "isso é só um número grande".
const LIMITE_PARECE_EPOCH_MS = 1e12;

function sugerirTipoNumero(nomeOrigem: string, valor: number): string {
  if (!Number.isInteger(valor)) return "Float";
  // A doc do Kyria confirma: todo campo de data (openedAt/createdAt/updatedAt/closedAt/
  // effectiveAt, ...) é epoch em ms — o padrão de nome (termina em "At"/"Date") mais a
  // magnitude do valor são sinal forte o bastante pra sugerir DateTime em vez de Int/BigInt.
  if (/(At|Date)$/.test(nomeOrigem) && valor > LIMITE_PARECE_EPOCH_MS) return "DateTime";
  return Math.abs(valor) > LIMITE_INTEGER_POSTGRES ? "BigInt" : "Int";
}

function tipoSugerido(nomeOrigem: string, tipoInferido: TipoInferidoAmostra, valor: unknown): string {
  if (tipoInferido === "number") return sugerirTipoNumero(nomeOrigem, valor as number);
  return TIPO_SUGERIDO[tipoInferido];
}

function inferirTipo(valor: unknown): TipoInferidoAmostra {
  if (valor === null) return "null";
  if (Array.isArray(valor)) return "array";
  return typeof valor as TipoInferidoAmostra;
}

function valorExemplo(valor: unknown): string {
  const texto = JSON.stringify(valor);
  const TAMANHO_MAXIMO = 200;
  return texto.length > TAMANHO_MAXIMO ? `${texto.slice(0, TAMANHO_MAXIMO)}…` : texto;
}

export interface CampoPreview {
  nomeOrigem: string;
  ordem: number;
  tipoInferidoAmostra: TipoInferidoAmostra;
  tipoSugerido: string;
  valorExemplo: string;
  tipoOpenApi: string | null;
  nullableOpenApi: boolean | null;
  enumOpenApi: string[] | null;
}

export interface ResourcePreview {
  path: string;
  amostraBruta: unknown;
  campos: CampoPreview[];
}

interface OpenApiPropertySchema {
  type?: string | string[];
  enum?: string[];
}

// Busca o openapi.json AO VIVO a cada preview — chamada não-autenticada e barata, só acontece
// quando um admin abre a tela (sem cron, sem hot path). Sem cache de propósito: um cache
// arriscaria mascarar justamente a mudança de contrato que este cross-reference existe pra
// pegar. Falha ao buscar, ou schema sem o nome pedido, degrada com segurança — devolve `{}`, e
// quem chama trata como "sem cross-reference disponível", não como erro fatal do preview.
async function propriedadesOpenApi(openApiSchemaName: string | undefined): Promise<Record<string, OpenApiPropertySchema>> {
  if (!openApiSchemaName) return {};
  try {
    const { data } = await axios.get(KYRIA_OPENAPI_URL, { timeout: 10000 });
    const propriedades = data?.components?.schemas?.[openApiSchemaName]?.properties;
    return propriedades && typeof propriedades === "object" ? propriedades : {};
  } catch {
    return {};
  }
}

function tipoOpenApiNormalizado(schema: OpenApiPropertySchema | undefined): { tipo: string | null; nullable: boolean | null; enumValores: string[] | null } {
  if (!schema) return { tipo: null, nullable: null, enumValores: null };
  const tipos = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const nullable = tipos.includes("null") ? true : tipos.length > 0 ? false : null;
  const tipoPrincipal = tipos.find((t) => t !== "null") ?? null;
  return { tipo: tipoPrincipal, nullable, enumValores: schema.enum ?? null };
}

// A maioria dos endpoints Kyria é coleção cursor-paginada (`{ data: [...], page: {...} }` —
// /teams, /members, /customers). Os de relatório (ex. GET /reports/hours) devolvem um envelope
// agregado (`{ data: { rows: [...], totalMinutes }, meta: {...} }`) — mesma ideia de "lista de
// registros", só um passo mais fundo. Aceita os dois formatos sem exigir que quem chama saiba
// qual é qual de antemão; qualquer outro formato cai no erro de amostra vazia abaixo.
function primeiroRegistro(resposta: unknown): unknown {
  const data = (resposta as { data?: unknown })?.data;
  if (Array.isArray(data)) return data[0];
  const rows = (data as { rows?: unknown })?.rows;
  if (Array.isArray(rows)) return rows[0];
  return undefined;
}

function ehObjetoSimples(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

// Achata UM nível de objeto aninhado ("group": {"id": "...", "name": "..."} vira "group.id",
// "group.name" como campos próprios) — pedido do Vitor (22/09/2026, mapeamento de GET
// /reports/hours): o `group` desse endpoint muda de forma conforme o `groupBy` escolhido
// (id/name pra user, id/code/title pra ticket, só date pro dia), e esconder isso atrás de um
// Json opaco impedia justamente o que a tela existe pra fazer — deixar o admin escolher tipo e
// nome de CADA campo real, inclusive decidir qual vira PK (convenção já usada em todo outro
// recurso Kyria: um campo chamado "id"). Só UM nível: se o valor achatado ainda for objeto,
// para aí e cai em Json mesmo (não persegue estrutura arbitrariamente funda). Array continua
// Json sempre, achatado ou não — não tem "campo N" que faça sentido num objeto de linha.
function achatarUmNivel(amostra: Record<string, unknown>): [string, unknown][] {
  const entradas: [string, unknown][] = [];
  for (const [chave, valor] of Object.entries(amostra)) {
    if (ehObjetoSimples(valor)) {
      for (const [subchave, subvalor] of Object.entries(valor)) {
        entradas.push([`${chave}.${subchave}`, subvalor]);
      }
    } else {
      entradas.push([chave, valor]);
    }
  }
  return entradas;
}

/**
 * Chama o Kyria de verdade (uma amostra mínima, `limit=1`), infere o tipo de cada campo do
 * primeiro registro e cruza com o schema do OpenAPI (quando disponível) — pura leitura, não
 * grava nada. O resultado é o que a tela de Mapeamento de Campos mostra pro admin decidir em
 * cima (ver routes/syncKyriaMapping.ts).
 */
export async function previewKyriaResource(path: string, openApiSchemaName?: string): Promise<ResourcePreview> {
  // `limit=1` é ignorado sem erro pelos endpoints de relatório (não fazem parte do contrato
  // deles) — testado ao vivo contra GET /reports/hours (21/09/2026): a query string do `path`
  // (ex. "?from=...&to=...&groupBy=user", digitada no campo de caminho customizado) e o
  // `limit=1` daqui convivem na mesma URL sem conflito.
  // Relatório de horas com groupBy no path (ex.: "/reports/hours?groupBy=customer"): as datas
  // nunca fazem parte da origem registrada — o preview usa o mês corrente completo (regra da
  // competência, ver competencia.ts) e devolve `competencia` como campo derivado, pra entrar no
  // mapa como qualquer outro. O "/reports/hours" puro (recurso #8) segue como sempre foi.
  const relatorioPorGrupo = /^\/reports\/hours\?.*groupBy=/.test(path) && !/[?&]from=/.test(path);
  const competencia = relatorioPorGrupo ? competenciaAtual() : null;
  const resposta = await getKyriaSample(
    path,
    competencia ? { limit: 1, from: competencia.from, to: competencia.to } : { limit: 1 }
  );
  const amostra = primeiroRegistro(resposta);

  if (!amostra || typeof amostra !== "object") {
    throw new Error(`"${path}" não devolveu nenhum registro — não dá pra inferir tipo de uma amostra vazia`);
  }

  const propriedades = await propriedadesOpenApi(openApiSchemaName);

  const entradas = achatarUmNivel(amostra as Record<string, unknown>);
  if (competencia) entradas.unshift(["competencia", competencia.from]);

  const campos: CampoPreview[] = entradas.map(([nomeOrigem, valor], indice) => {
    if (nomeOrigem === "competencia" && competencia) {
      return {
        nomeOrigem,
        ordem: indice,
        tipoInferidoAmostra: "string",
        tipoSugerido: "DateTime",
        valorExemplo: valorExemplo(valor),
        tipoOpenApi: null,
        nullableOpenApi: false,
        enumOpenApi: null,
      };
    }
    const tipoInferido = inferirTipo(valor);
    const { tipo, nullable, enumValores } = tipoOpenApiNormalizado(propriedades[nomeOrigem]);
    return {
      nomeOrigem,
      ordem: indice,
      tipoInferidoAmostra: tipoInferido,
      tipoSugerido: tipoSugerido(nomeOrigem, tipoInferido, valor),
      valorExemplo: valorExemplo(valor),
      tipoOpenApi: tipo,
      nullableOpenApi: nullable,
      enumOpenApi: enumValores,
    };
  });

  return { path, amostraBruta: amostra, campos };
}
