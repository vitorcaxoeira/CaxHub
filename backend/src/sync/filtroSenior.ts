// Único módulo autorizado a produzir fragmento SQL a partir de valor digitado por admin —
// Fase 3 do plano de filtros na importação (~/.claude/plans/se-liga-na-necessidade-resilient-lark.md,
// seção D). É o núcleo de segurança da feature: esta é a primeira parte do sistema que
// concatena texto de usuário em SQL enviado ao Senior (o serviço SOAP não aceita bind de
// parâmetros, ver pedidoSync.ts:204-208 — a query entra crua num CDATA). Regra geral: nome de
// campo é sempre conferido contra o dicionário real (nunca aceito "de olho"), valor é sempre
// tipado e validado ANTES de virar literal, e string é sempre escapada mesmo depois de
// validada — nenhuma das duas defesas substitui a outra.
import { getTableFields, getFieldDomainValues, SeniorField } from "../soap/metadata";
import { comCache } from "../soap/metadataCache";
// `import type`: só usado como anotação de tipo abaixo, nunca como valor em runtime — vira
// `import type` de propósito (e não `import { SyncJobDescriptor }`) porque registry.ts
// importa os jobs de sync (inclusive pedidoSync.ts, que importa filtrosAtivos.ts, que importa
// este arquivo) — um `import` de VALOR aqui fecharia um ciclo real entre os módulos. `import
// type` é sempre apagado na compilação (garantido pelo TS mesmo em modo transpile-only),
// então não deixa nenhum `require()` pra trás capaz de fechar esse ciclo.
import type { SyncJobDescriptor } from "./registry";

export type OperadorFiltro = "=" | "≠" | "IN" | "≥" | "≤" | "entre" | "contém" | "começa com";

// Categoria interna que decide validação/serialização — não é o `dattyp` cru porque alguns
// dattyp colapsam na mesma regra (2 com prefld>0 e 10 são ambos "decimal") e outros precisam
// da MESMA representação (`dattyp` 1 ou 2) tratados diferente quando têm `enunam` (domínio).
export type CategoriaCampo = "int" | "bigint" | "decimal" | "data" | "string" | "dominio";

export interface PredicadoFiltro {
  // Nome de ORIGEM no Senior (o que o WHERE precisa usar) — nunca o alias local.
  campo: string;
  operador: OperadorFiltro;
  valores: string[];
}

export interface PredicadoValidado extends PredicadoFiltro {
  // Grafia real do campo no dicionário (`fldnam`) — pode diferir de `campo` só em maiúsc./minúsc.
  colunaOrigem: string;
  categoria: CategoriaCampo;
  fragmentoSql: string;
}

// Exportado só pra bateria de valores hostis do script de verificação testar diretamente —
// produção sempre passa por validarEMontarPredicado, nunca importa isto pra revalidar por
// fora (repetir a checagem por fora é como uma regra acaba divergindo da real).
export const NOME_CAMPO_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Valor-sentinela pro pedido do Vitor (21/08/2026): em vez do corte de data do modo Alterados
// ficar escondido dentro de cada job (`if (desde) predicados.push(...)`), o admin pode salvar
// um predicado de verdade no campo de data com este valor especial em vez de uma data literal
// — resolvido pra data da ÚLTIMA SINCRONIZAÇÃO COM SUCESSO em tempo de execução (nunca gravado
// como data fixa). Espelhado como literal no frontend (SincronizacaoErp.tsx) — mesmo padrão de
// duplicação que `OperadorFiltro` já tem entre os dois lados, sem pacote de tipos compartilhado.
export const VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO = "@ultima_sincronizacao";
// A query inteira vai num envelope SOAP com timeout de 20s (soap/client.ts) — um IN com
// milhares de valores testa esse limite à toa; 500 cobre até um lote de clientes/pedidos
// generoso (mesma ordem de grandeza do CLIENTES_POR_LOTE=300 de pedidoSync.ts) sem chegar perto.
const MAX_VALORES_IN = 500;

const OPERADORES_POR_CATEGORIA: Record<CategoriaCampo, OperadorFiltro[]> = {
  int: ["=", "≠", "IN", "≥", "≤", "entre"],
  bigint: ["=", "≠", "IN", "≥", "≤", "entre"],
  decimal: ["=", "≠", "≥", "≤", "entre"],
  data: ["=", "≠", "≥", "≤", "entre"],
  string: ["=", "≠", "IN", "contém", "começa com"],
  // Lista fechada de valores — "entre"/"≥"/"≤" não fazem sentido pra um código de domínio.
  dominio: ["=", "≠", "IN"],
};

/**
 * Valida um predicado candidato contra o dicionário real do Senior (cacheado, ver
 * soap/metadataCache.ts) e devolve o fragmento SQL pronto pra entrar em `montarQuerySenior`.
 * Lança com mensagem clara no primeiro problema — nunca devolve fragmento parcial/melhor-esforço.
 */
export async function validarEMontarPredicado(
  job: SyncJobDescriptor,
  predicado: PredicadoFiltro
): Promise<PredicadoValidado> {
  if (!job.temDicionario) {
    throw new Error(`"${job.displayName}" não tem dicionário de dados no Senior — não é possível filtrar por campo.`);
  }
  // Cinto e suspensório: nome de coluna nunca pode ser escapado por aspas simples, então a
  // defesa aqui é não deixar passar nada que não seja um identificador simples ANTES de
  // sequer consultar o dicionário.
  if (!NOME_CAMPO_REGEX.test(predicado.campo)) {
    throw new Error(`Nome de campo inválido: "${predicado.campo}".`);
  }

  const fields = await comCache(`campos:${job.tabelaSenior}`, () => getTableFields(job.tabelaSenior));
  const field = fields.find((f) => f.fldnam.toLowerCase() === predicado.campo.toLowerCase());
  if (!field) {
    throw new Error(`Campo "${predicado.campo}" não existe em "${job.tabelaSenior}" (conferido contra o dicionário do Senior).`);
  }

  // Busca o domínio (lista fechada de valores) só se o campo realmente for um — evita round-trip
  // à toa nos ~9 em cada 10 campos que não têm `enunam`.
  let valoresDominio: Set<string> | null = null;
  if (field.enunam && (field.dattyp === 1 || field.dattyp === 2)) {
    const dominio = await comCache(`dominio:${field.enunam}`, () => getFieldDomainValues(field.enunam as string));
    valoresDominio = new Set(dominio.map((d) => d.keynam));
  }

  return validarPredicadoComCampo(field, predicado, valoresDominio);
}

// Núcleo síncrono da validação, separado de `validarEMontarPredicado` só pra poder ser
// exercitado com um `SeniorField` sintético — sem SOAP — pela bateria de valores hostis do
// script de verificação (backend/prisma/verificarFase3Filtro.ts). Mesma lógica que o caminho
// real usa depois de resolver o campo no dicionário; nenhuma regra vive só num dos dois lados.
export function validarPredicadoComCampo(
  field: SeniorField,
  predicado: PredicadoFiltro,
  valoresDominio: Set<string> | null
): PredicadoValidado {
  const categoria = categoriaDoCampo(field);
  if (categoria === null) {
    throw new Error(`Campo "${field.fldnam}" tem tipo não suportado para filtro (${motivoBloqueio(field)}).`);
  }

  const operadoresPermitidos = OPERADORES_POR_CATEGORIA[categoria];
  if (!operadoresPermitidos.includes(predicado.operador)) {
    throw new Error(
      `Operador "${predicado.operador}" não é permitido para "${field.fldnam}" (tipo ${categoria}). Use um de: ${operadoresPermitidos.join(", ")}.`
    );
  }

  // Pedido do Vitor (21/08/2026): o corte de data do modo Alterados pode ser um predicado de
  // verdade em vez de ficar escondido em cada job. Escopo restrito de propósito — só data, só
  // operador de valor único — pra não abrir superfície demais numa mudança já maior que o normal.
  if (predicado.valores.includes(VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO)) {
    if (categoria !== "data") {
      throw new Error(`A variável "última sincronização com sucesso" só pode ser usada em campo de data.`);
    }
    if (!["=", "≥", "≤"].includes(predicado.operador)) {
      throw new Error(`A variável "última sincronização com sucesso" só pode ser usada com os operadores =, ≥ ou ≤.`);
    }
  }

  validarQuantidadeDeValores(predicado);

  const valoresChecados = predicado.valores.map((v) => valorChecado(v, categoria, field, valoresDominio));
  const fragmentoSql = montarFragmento(field.fldnam, predicado.operador, categoria, valoresChecados);

  return { ...predicado, colunaOrigem: field.fldnam, categoria, fragmentoSql };
}

function categoriaDoCampo(field: SeniorField): CategoriaCampo | null {
  // Domínio (lista fechada) tem prioridade sobre o tipo bruto — um dattyp=1/2 com `enunam`
  // preenchido só aceita os códigos cadastrados, mesmo sendo tecnicamente string/int.
  if (field.enunam && (field.dattyp === 1 || field.dattyp === 2)) return "dominio";
  switch (field.dattyp) {
    case 1:
      return "string";
    case 2:
      if (field.prefld > 0) return "decimal";
      return field.lenfld <= 9 ? "int" : "bigint";
    case 4:
      return "data";
    case 10:
      return "decimal";
    // 3 (booleano, representação real nunca confirmada), 5 (hora, guardado como minutos
    // desde meia-noite — "filtrar por hora" precisaria de conversão que a v1 não resolve),
    // 8 (binário) e qualquer dattyp desconhecido ficam bloqueados — ver typeMapping.ts.
    default:
      return null;
  }
}

function motivoBloqueio(field: SeniorField): string {
  switch (field.dattyp) {
    case 3:
      return "booleano — representação real (0/1 ou T/F) nunca foi confirmada com dado real";
    case 5:
      return "hora — guardado como minutos desde a meia-noite, sem conversão de filtro na v1";
    case 8:
      return "binário";
    default:
      return `dattyp=${field.dattyp} desconhecido`;
  }
}

function validarQuantidadeDeValores(predicado: PredicadoFiltro): void {
  const n = predicado.valores.length;
  if (predicado.operador === "entre") {
    if (n !== 2) throw new Error(`Operador "entre" precisa de exatamente 2 valores (recebi ${n}).`);
    return;
  }
  if (predicado.operador === "IN") {
    if (n === 0) throw new Error(`Operador "IN" precisa de pelo menos 1 valor.`);
    if (n > MAX_VALORES_IN) throw new Error(`Operador "IN" aceita no máximo ${MAX_VALORES_IN} valores (recebi ${n}).`);
    return;
  }
  if (n !== 1) throw new Error(`Operador "${predicado.operador}" precisa de exatamente 1 valor (recebi ${n}).`);
}

// Confere e normaliza minimamente um valor — devolve texto ainda CRU (sem aspas/escape), quem
// decide como virar literal SQL é montarFragmento (IN/entre/contém precisam de tratamento
// diferente de "="). Lança no primeiro valor inválido.
function valorChecado(v: string, categoria: CategoriaCampo, field: SeniorField, valoresValidos: Set<string> | null): string {
  switch (categoria) {
    case "int": {
      if (!/^-?\d+$/.test(v)) throw new Error(`Valor "${v}" não é um número inteiro válido para "${field.fldnam}".`);
      const n = Number(v);
      if (!Number.isSafeInteger(n) || n < -2147483648 || n > 2147483647) {
        throw new Error(`Valor "${v}" está fora do intervalo de inteiro para "${field.fldnam}".`);
      }
      return v;
    }
    case "bigint": {
      if (!/^-?\d+$/.test(v)) throw new Error(`Valor "${v}" não é um número inteiro válido para "${field.fldnam}".`);
      return v;
    }
    case "decimal": {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`Valor "${v}" não é um número válido para "${field.fldnam}".`);
      return n.toFixed(field.prefld > 0 ? field.prefld : 2);
    }
    case "data": {
      // A variável não é uma data real — só é resolvida em tempo de execução (ver
      // `substituirVariavelUltimaSincronizacao`), então pula a validação de formato ISO aqui.
      if (v === VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO) return v;
      if (!dataValidaISO(v)) throw new Error(`Data "${v}" precisa estar no formato AAAA-MM-DD e ser uma data real.`);
      return v;
    }
    case "dominio": {
      if (!valoresValidos || !valoresValidos.has(v)) {
        throw new Error(`Valor "${v}" não é um código válido do domínio "${field.enunam}" de "${field.fldnam}".`);
      }
      return v;
    }
    case "string": {
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x1F\x7F]/.test(v)) {
        throw new Error(`Valor de "${field.fldnam}" contém caractere de controle/quebra de linha — não permitido.`);
      }
      if (field.lenfld > 0 && v.length > field.lenfld) {
        throw new Error(`Valor de "${field.fldnam}" tem ${v.length} caractere(s), acima do limite do campo (${field.lenfld}).`);
      }
      return v;
    }
  }
}

// `Date.parse`/`new Date(str)` sozinho NÃO rejeita dia inválido em formato ISO (ex.:
// "2026-02-30" rola pra "2026-03-02" em vez de virar Invalid Date) — confirmado testando
// antes de escrever isto. Validação manual: monta a data a partir dos componentes e confere
// se ela "voltou" exatamente igual, o que só acontece se ano/mês/dia formarem uma data real.
function dataValidaISO(v: string): boolean {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function montarFragmento(origem: string, operador: OperadorFiltro, categoria: CategoriaCampo, valores: string[]): string {
  // Número (int/bigint/decimal) já vem pronto pra entrar cru na query; os demais precisam
  // de aspas simples + escape.
  const numerico = categoria === "int" || categoria === "bigint" || categoria === "decimal";
  const literal = (v: string) => (numerico ? v : `'${escaparAspas(v)}'`);

  switch (operador) {
    case "=":
      return `${origem} = ${literal(valores[0])}`;
    case "≠":
      return `${origem} <> ${literal(valores[0])}`;
    case "IN":
      return `${origem} IN (${valores.map(literal).join(", ")})`;
    case "≥":
      return `${origem} >= ${literal(valores[0])}`;
    case "≤":
      return `${origem} <= ${literal(valores[0])}`;
    case "entre":
      return `${origem} BETWEEN ${literal(valores[0])} AND ${literal(valores[1])}`;
    case "contém":
      return `${origem} LIKE '%${escaparLike(valores[0])}%' ESCAPE '\\'`;
    case "começa com":
      return `${origem} LIKE '${escaparLike(valores[0])}%' ESCAPE '\\'`;
  }
}

// Único lugar que sabe como o token da variável aparece DENTRO de um fragmento já montado
// (`montarFragmento` sempre entre aspas simples, categoria "data" não é numérica) — troca pelo
// literal 'AAAA-MM-DD' de `desde`. Reaproveitado por filtrosAtivos.ts (tempo de execução, a
// cada run) e routes/syncErp.ts (exibição em GET/preview, pra "ver query" nunca mostrar o
// token cru como se fosse SQL de verdade).
export function substituirVariavelUltimaSincronizacao(predicadosSql: string[], desde: Date): string[] {
  const token = `'${VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO}'`;
  const literal = `'${desde.toISOString().slice(0, 10)}'`;
  return predicadosSql.map((sql) => sql.split(token).join(literal));
}

function escaparAspas(v: string): string {
  return v.replace(/'/g, "''");
}

// Escapa primeiro os coringas do LIKE (\, %, _) e só depois a aspa simples — nessa ordem,
// senão as barras inseridas pelo primeiro passo seriam escapadas de novo pelo segundo.
function escaparLike(v: string): string {
  return escaparAspas(v.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_"));
}
