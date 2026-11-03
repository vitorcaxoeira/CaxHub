// Fórmulas das colunas calculadas (28/10/2026, pedido do Vitor): contas sobre as colunas da própria linha, no jeito do Excel em português.
//
//   ([Consumo ERP] - [Quantidade Plannix]) / [Quantidade Plannix] * 100
//   SE([Δ % ERP] > 10; 1; 0)        ARRED([Aço ERP] / TOTAL([Aço ERP]) * 100; 1)
//
// Este é o ÚNICO leitor de fórmula do sistema (sem eval): a tela transforma o texto numa árvore (`No`) e é a árvore que vai ao servidor,
// que só a confere (mesmas regras de tipo, backend/src/formulas/formula.ts) e a traduz para SQL. Funções puras, com teste.
//
// Regras: números com vírgula decimal (1,5); `;` separa argumentos; colunas pelo título entre colchetes (guardadas pelo nome técnico, então
// trocar o título não quebra a fórmula); só colunas numéricas entram em contas, datas só em DIAS, texto nunca; vazio na conta → vazio;
// divisão por zero → vazio (nunca erro).

export type TipoColunaFormula = "texto" | "inteiro" | "decimal" | "data" | "booleano";
export type OpBinario = "+" | "-" | "*" | "/" | "^";
export type OpComparacao = "=" | "<>" | ">" | "<" | ">=" | "<=";
export type NomeFuncao = "ABS" | "ARRED" | "MIN" | "MAX" | "SE" | "SEVAZIO" | "DIAS" | "TOTAL" | "E" | "OU";

export type No =
  | { t: "num"; v: number }
  | { t: "col"; nome: string }
  | { t: "neg"; a: No }
  | { t: "bin"; op: OpBinario; a: No; b: No }
  | { t: "cmp"; op: OpComparacao; a: No; b: No }
  | { t: "fn"; nome: NomeFuncao; args: No[] };

/** O que cada nó produz: número, data (só como argumento de DIAS) ou lógico (condição de SE, E, OU). */
export type TipoNo = "numero" | "data" | "logico";

export interface ColunaDisponivel {
  nome: string;
  titulo: string;
  tipo: TipoColunaFormula;
}

export const LIMITE_TEXTO = 500;
export const LIMITE_NOS = 200;
export const LIMITE_PROFUNDIDADE = 30;
/** Expoente acima disso (em módulo) dá vazio: no SQL, potência enorme estoura o numeric. */
export const LIMITE_EXPOENTE = 100;
/** Casas do ARRED: número inteiro de 0 a 6. */
export const LIMITE_CASAS_ARRED = 6;

export const FUNCOES: { nome: NomeFuncao; assinatura: string; descricao: string }[] = [
  { nome: "ABS", assinatura: "ABS(x)", descricao: "valor sem sinal" },
  { nome: "ARRED", assinatura: "ARRED(x; casas)", descricao: "arredonda (casas de 0 a 6)" },
  { nome: "MIN", assinatura: "MIN(a; b; ...)", descricao: "o menor (ignora vazios)" },
  { nome: "MAX", assinatura: "MAX(a; b; ...)", descricao: "o maior (ignora vazios)" },
  { nome: "SE", assinatura: "SE(condição; então; senão)", descricao: "ex.: SE([x] > 0; [x]; 0)" },
  { nome: "SEVAZIO", assinatura: "SEVAZIO(x; padrão)", descricao: "usa o padrão quando x está vazio" },
  { nome: "DIAS", assinatura: "DIAS(início; fim)", descricao: "dias entre duas datas" },
  { nome: "TOTAL", assinatura: "TOTAL([coluna])", descricao: "soma da coluna em todas as linhas do filtro (para % do total)" },
  { nome: "E", assinatura: "E(cond; cond; ...)", descricao: "todas verdadeiras" },
  { nome: "OU", assinatura: "OU(cond; cond; ...)", descricao: "alguma verdadeira" },
];

export class ErroFormula extends Error {
  constructor(
    mensagem: string,
    /** Posição (0 = primeiro caractere) onde o problema foi percebido; null quando é da fórmula toda. */
    readonly posicao: number | null = null,
  ) {
    super(mensagem);
  }
}

// ---- leitura do texto ------------------------------------------------------------------------------------------------------------

type Token =
  | { k: "num"; v: number; p: number }
  | { k: "col"; titulo: string; p: number }
  | { k: "id"; v: string; p: number }
  | { k: "op"; v: string; p: number }
  | { k: "fim"; p: number };

const SIMBOLOS = ["<>", ">=", "<=", "+", "-", "*", "/", "^", "(", ")", ";", "=", ">", "<"];

function tokens(texto: string): Token[] {
  const lista: Token[] = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "[") {
      const fim = texto.indexOf("]", i + 1);
      if (fim < 0) throw new ErroFormula("Faltou fechar o colchete da coluna", i);
      const titulo = texto.slice(i + 1, fim).trim();
      if (!titulo) throw new ErroFormula("Coluna sem nome entre os colchetes", i);
      lista.push({ k: "col", titulo, p: i });
      i = fim + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      // Vírgula decimal (1,5). Ponto de milhar não é aceito: "1.500" seria ambíguo.
      const m = /^[0-9]+(,[0-9]+)?/.exec(texto.slice(i))!;
      if (/^[0-9]+\.[0-9]/.test(texto.slice(i))) throw new ErroFormula("Use vírgula para decimais (ex.: 1,5)", i);
      lista.push({ k: "num", v: Number(m[0].replace(",", ".")), p: i });
      i += m[0].length;
      continue;
    }
    // Sinais que as pessoas costumam colar (× ÷ −) valem como os do teclado. Antes das letras: × e ÷ estão na faixa À-ú.
    const trocado = c === "×" ? "*" : c === "÷" ? "/" : c === "−" ? "-" : null;
    if (!trocado && /[A-Za-zÀ-ú_]/.test(c)) {
      const m = /^[A-Za-zÀ-ÖØ-öø-ú_][A-Za-zÀ-ÖØ-öø-ú_0-9]*/.exec(texto.slice(i));
      if (m) {
        lista.push({ k: "id", v: m[0].toUpperCase(), p: i });
        i += m[0].length;
        continue;
      }
    }
    const simbolo = trocado ?? SIMBOLOS.find((s) => texto.startsWith(s, i));
    if (!simbolo) throw new ErroFormula(`Caractere inesperado "${c}"`, i);
    lista.push({ k: "op", v: simbolo, p: i });
    i += trocado ? 1 : simbolo.length;
  }
  lista.push({ k: "fim", p: texto.length });
  return lista;
}

const NOMES_FUNCOES = new Set<string>(FUNCOES.map((f) => f.nome));
const PRECEDENCIA: Record<string, number> = { "=": 1, "<>": 1, ">": 1, "<": 1, ">=": 1, "<=": 1, "+": 2, "-": 2, "*": 3, "/": 3, "^": 5 };
const COMPARACOES = new Set(["=", "<>", ">", "<", ">=", "<="]);

/** Lê o texto da fórmula numa árvore (sem conferir tipos). Colunas resolvidas pelo título (sem diferenciar maiúsculas) ou pelo nome técnico. */
export function lerFormula(texto: string, colunas: ColunaDisponivel[]): No {
  if (!texto.trim()) throw new ErroFormula("Escreva a fórmula");
  if (texto.length > LIMITE_TEXTO) throw new ErroFormula(`Fórmula longa demais (máximo de ${LIMITE_TEXTO} caracteres)`);
  const porTitulo = new Map<string, string>();
  for (const c of colunas) porTitulo.set(c.nome.toLowerCase(), c.nome);
  for (const c of colunas) porTitulo.set(c.titulo.trim().toLowerCase(), c.nome);
  const lista = tokens(texto);
  let i = 0;
  const atual = () => lista[i];
  const esperar = (v: string) => {
    const t = atual();
    if (t.k !== "op" || t.v !== v) throw new ErroFormula(v === ")" ? "Faltou fechar parêntese" : `Esperava "${v}"`, t.p);
    i++;
  };

  const primario = (): No => {
    const t = atual();
    if (t.k === "num") {
      i++;
      return { t: "num", v: t.v };
    }
    if (t.k === "col") {
      i++;
      const nome = porTitulo.get(t.titulo.toLowerCase());
      if (!nome) throw new ErroFormula(`A coluna [${t.titulo}] não existe nesta lista`, t.p);
      return { t: "col", nome };
    }
    if (t.k === "op" && t.v === "(") {
      i++;
      const dentro = expressao(0);
      esperar(")");
      return dentro;
    }
    if (t.k === "op" && (t.v === "-" || t.v === "+")) {
      i++;
      const a = expressao(4);
      return t.v === "-" ? { t: "neg", a } : a;
    }
    if (t.k === "id") {
      if (!NOMES_FUNCOES.has(t.v)) throw new ErroFormula(`Função ${t.v} não existe`, t.p);
      i++;
      esperar("(");
      const args: No[] = [];
      if (!(atual().k === "op" && (atual() as { v: string }).v === ")")) {
        args.push(expressao(0));
        while (atual().k === "op" && (atual() as { v: string }).v === ";") {
          i++;
          args.push(expressao(0));
        }
      }
      esperar(")");
      return { t: "fn", nome: t.v as NomeFuncao, args };
    }
    if (t.k === "fim") throw new ErroFormula("A fórmula terminou antes da hora", t.p);
    throw new ErroFormula(`Não esperava "${t.k === "op" ? t.v : ""}" aqui`, t.p);
  };

  // Precedência por "subida": ^ associa à direita, o resto à esquerda; comparação é a mais fraca.
  const expressao = (minimo: number): No => {
    let esquerda = primario();
    for (;;) {
      const t = atual();
      if (t.k !== "op" || !(t.v in PRECEDENCIA)) break;
      const prec = PRECEDENCIA[t.v];
      if (prec < minimo) break;
      i++;
      const direita = expressao(t.v === "^" ? prec : prec + 1);
      esquerda = COMPARACOES.has(t.v)
        ? { t: "cmp", op: t.v as OpComparacao, a: esquerda, b: direita }
        : { t: "bin", op: t.v as OpBinario, a: esquerda, b: direita };
    }
    return esquerda;
  };

  const arvore = expressao(0);
  const sobra = atual();
  if (sobra.k !== "fim") throw new ErroFormula(sobra.k === "op" && sobra.v === ")" ? "Parêntese fechado sem ter sido aberto" : "Sobrou algo depois do fim da fórmula", sobra.p);
  return arvore;
}

// ---- tipos -------------------------------------------------------------------------------------------------------------------------

const TIPO_DA_COLUNA: Record<TipoColunaFormula, TipoNo | null> = { inteiro: "numero", decimal: "numero", data: "data", booleano: "logico", texto: null };

/**
 * Confere a árvore: só colunas existentes, tipos certos em cada lugar, limites de tamanho. Devolve o tipo do resultado. A mesma regra roda
 * no servidor (backend/src/formulas/formula.ts): mudar aqui = mudar lá.
 */
export function tipoDoNo(no: No, colunas: Map<string, TipoColunaFormula>, profundidade = 0): TipoNo {
  if (profundidade > LIMITE_PROFUNDIDADE) throw new ErroFormula("Fórmula aninhada demais");
  const numero = (filho: No, onde: string) => {
    const t = tipoDoNo(filho, colunas, profundidade + 1);
    if (t !== "numero") throw new ErroFormula(`${onde} precisa de um número${t === "data" ? " (datas só entram em DIAS)" : ""}`);
  };
  const logico = (filho: No, onde: string) => {
    if (tipoDoNo(filho, colunas, profundidade + 1) !== "logico") throw new ErroFormula(`${onde} precisa de uma condição (ex.: [x] > 0)`);
  };
  switch (no.t) {
    case "num":
      if (!Number.isFinite(no.v)) throw new ErroFormula("Número inválido");
      return "numero";
    case "col": {
      const tipo = colunas.get(no.nome);
      if (!tipo) throw new ErroFormula(`A coluna ${no.nome} não existe nesta lista`);
      const t = TIPO_DA_COLUNA[tipo];
      if (!t) throw new ErroFormula("Coluna de texto não entra em conta");
      return t;
    }
    case "neg":
      numero(no.a, "O sinal de menos");
      return "numero";
    case "bin":
      numero(no.a, `A conta "${no.op}"`);
      numero(no.b, `A conta "${no.op}"`);
      return "numero";
    case "cmp": {
      const a = tipoDoNo(no.a, colunas, profundidade + 1);
      const b = tipoDoNo(no.b, colunas, profundidade + 1);
      if (a === "logico" || a !== b) throw new ErroFormula("A comparação precisa de dois números ou de duas datas");
      return "logico";
    }
    case "fn": {
      const n = no.args.length;
      const qtd = (min: number, max: number) => {
        if (n < min || n > max) throw new ErroFormula(`${no.nome} recebe ${min === max ? min : `de ${min} a ${max === Infinity ? "vários" : max}`} argumento(s)`);
      };
      switch (no.nome) {
        case "ABS":
          qtd(1, 1);
          numero(no.args[0], "ABS");
          return "numero";
        case "ARRED": {
          qtd(2, 2);
          numero(no.args[0], "ARRED");
          const casas = no.args[1];
          if (casas.t !== "num" || !Number.isInteger(casas.v) || casas.v < 0 || casas.v > LIMITE_CASAS_ARRED)
            throw new ErroFormula(`As casas do ARRED são um número inteiro de 0 a ${LIMITE_CASAS_ARRED}`);
          return "numero";
        }
        case "MIN":
        case "MAX":
          qtd(2, Infinity);
          no.args.forEach((a) => numero(a, no.nome));
          return "numero";
        case "SE":
          qtd(3, 3);
          logico(no.args[0], "A condição do SE");
          numero(no.args[1], "O SE");
          numero(no.args[2], "O SE");
          return "numero";
        case "SEVAZIO":
          qtd(2, 2);
          numero(no.args[0], "SEVAZIO");
          numero(no.args[1], "SEVAZIO");
          return "numero";
        case "DIAS":
          qtd(2, 2);
          for (const a of no.args) if (tipoDoNo(a, colunas, profundidade + 1) !== "data") throw new ErroFormula("DIAS precisa de duas colunas de data");
          return "numero";
        case "TOTAL": {
          qtd(1, 1);
          const a = no.args[0];
          if (a.t !== "col") throw new ErroFormula("TOTAL recebe uma coluna, ex.: TOTAL([Aço ERP])");
          numero(a, "TOTAL");
          return "numero";
        }
        case "E":
        case "OU":
          qtd(2, Infinity);
          no.args.forEach((a) => logico(a, no.nome));
          return "logico";
      }
    }
  }
}

export function contarNos(no: No): number {
  switch (no.t) {
    case "num":
    case "col":
      return 1;
    case "neg":
      return 1 + contarNos(no.a);
    case "bin":
    case "cmp":
      return 1 + contarNos(no.a) + contarNos(no.b);
    case "fn":
      return 1 + no.args.reduce((s, a) => s + contarNos(a), 0);
  }
}

/** Colunas que a fórmula cita (sem repetir); `soTotal` = só as que aparecem dentro de TOTAL. */
export function colunasDaFormula(no: No, soTotal = false): string[] {
  const nomes = new Set<string>();
  const visitar = (n: No, dentroDeTotal: boolean) => {
    if (n.t === "col") {
      if (!soTotal || dentroDeTotal) nomes.add(n.nome);
    } else if (n.t === "neg") visitar(n.a, dentroDeTotal);
    else if (n.t === "bin" || n.t === "cmp") {
      visitar(n.a, dentroDeTotal);
      visitar(n.b, dentroDeTotal);
    } else if (n.t === "fn") n.args.forEach((a) => visitar(a, dentroDeTotal || n.nome === "TOTAL"));
  };
  visitar(no, false);
  return [...nomes];
}

export type ResultadoAnalise = { ok: true; arvore: No } | { ok: false; erro: string; posicao: number | null };

/** Lê e confere a fórmula de uma coluna calculada (o resultado tem que ser número). Para o editor da tela. */
export function analisarFormula(texto: string, colunas: ColunaDisponivel[]): ResultadoAnalise {
  try {
    const arvore = lerFormula(texto, colunas);
    if (contarNos(arvore) > LIMITE_NOS) throw new ErroFormula("Fórmula grande demais");
    const tipo = tipoDoNo(arvore, new Map(colunas.map((c) => [c.nome, c.tipo])));
    if (tipo !== "numero") throw new ErroFormula("A fórmula precisa dar um número (uma condição sozinha só vale dentro do SE)");
    return { ok: true, arvore };
  } catch (e) {
    if (e instanceof ErroFormula) return { ok: false, erro: e.message, posicao: e.posicao };
    throw e;
  }
}

// ---- de volta para texto (títulos atuais) ------------------------------------------------------------------------------------------

const fmtNumero = (v: number) => String(v).replace(".", ",");

/** Texto da fórmula com os títulos atuais das colunas (o que a pessoa vê e edita). */
export function formulaParaTexto(no: No, titulos: Record<string, string>, pai = 0): string {
  switch (no.t) {
    case "num":
      return fmtNumero(no.v);
    case "col":
      return `[${titulos[no.nome] ?? no.nome}]`;
    case "neg":
      return `-${formulaParaTexto(no.a, titulos, 4)}`;
    case "bin":
    case "cmp": {
      const prec = PRECEDENCIA[no.op];
      const texto = `${formulaParaTexto(no.a, titulos, no.op === "^" ? prec + 1 : prec)} ${no.op} ${formulaParaTexto(no.b, titulos, no.op === "^" ? prec : prec + 1)}`;
      return prec < pai ? `(${texto})` : texto;
    }
    case "fn":
      return `${no.nome}(${no.args.map((a) => formulaParaTexto(a, titulos)).join("; ")})`;
  }
}

// ---- cálculo na tela ---------------------------------------------------------------------------------------------------------------

type Valor = number | boolean | null;

const comoNumero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const comoData = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
};
/** Arredonda "para longe do zero" na metade, como o round() do Postgres (Math.round arredondaria -2,5 para -2). */
const arredondar = (x: number, casas: number) => {
  const f = 10 ** casas;
  return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f;
};
const finito = (x: number): number | null => (Number.isFinite(x) ? x : null);

/**
 * Calcula a fórmula numa linha. `ler(nome)` devolve o valor da coluna na linha; `totais[nome]` = TOTAL da coluna no filtro. Mesma
 * semântica do SQL gerado no servidor: vazio contamina a conta, divisão por zero dá vazio, MIN/MAX ignoram vazios, condição vazia vai
 * para o "senão" do SE, E/OU com lógica de três valores.
 */
export function avaliarFormula(no: No, ler: (nome: string) => unknown, tipos: Map<string, TipoColunaFormula>, totais: Record<string, number | null> = {}): number | null {
  const v = valor(no, ler, tipos, totais);
  return typeof v === "number" ? v : null;
}

function valor(no: No, ler: (nome: string) => unknown, tipos: Map<string, TipoColunaFormula>, totais: Record<string, number | null>): Valor {
  const num = (n: No) => {
    const r = valor(n, ler, tipos, totais);
    return typeof r === "number" ? r : null;
  };
  switch (no.t) {
    case "num":
      return no.v;
    case "col": {
      const tipo = tipos.get(no.nome);
      const bruto = ler(no.nome);
      if (tipo === "data") return comoData(bruto);
      if (tipo === "booleano") return bruto === null || bruto === undefined ? null : bruto === true || bruto === "true";
      return comoNumero(bruto);
    }
    case "neg": {
      const a = num(no.a);
      return a === null ? null : -a;
    }
    case "bin": {
      const a = num(no.a);
      const b = num(no.b);
      if (a === null || b === null) return null;
      switch (no.op) {
        case "+":
          return finito(a + b);
        case "-":
          return finito(a - b);
        case "*":
          return finito(a * b);
        case "/":
          return b === 0 ? null : finito(a / b);
        case "^":
          if (Math.abs(b) > LIMITE_EXPOENTE || (a < 0 && !Number.isInteger(b)) || (a === 0 && b < 0)) return null;
          return finito(a ** b);
      }
      break;
    }
    case "cmp": {
      const a = valor(no.a, ler, tipos, totais);
      const b = valor(no.b, ler, tipos, totais);
      if (typeof a !== "number" || typeof b !== "number") return null;
      switch (no.op) {
        case "=":
          return a === b;
        case "<>":
          return a !== b;
        case ">":
          return a > b;
        case "<":
          return a < b;
        case ">=":
          return a >= b;
        case "<=":
          return a <= b;
      }
      break;
    }
    case "fn": {
      switch (no.nome) {
        case "ABS": {
          const a = num(no.args[0]);
          return a === null ? null : Math.abs(a);
        }
        case "ARRED": {
          const a = num(no.args[0]);
          return a === null ? null : arredondar(a, (no.args[1] as { v: number }).v);
        }
        case "MIN":
        case "MAX": {
          const vs = no.args.map(num).filter((x): x is number => x !== null);
          if (!vs.length) return null;
          return no.nome === "MIN" ? Math.min(...vs) : Math.max(...vs);
        }
        case "SE":
          return valor(no.args[0], ler, tipos, totais) === true ? num(no.args[1]) : num(no.args[2]);
        case "SEVAZIO": {
          const a = num(no.args[0]);
          return a === null ? num(no.args[1]) : a;
        }
        case "DIAS": {
          const a = valor(no.args[0], ler, tipos, totais);
          const b = valor(no.args[1], ler, tipos, totais);
          return typeof a === "number" && typeof b === "number" ? (b - a) / 86_400_000 : null;
        }
        case "TOTAL": {
          const t = totais[(no.args[0] as { nome: string }).nome];
          return t === undefined ? null : t;
        }
        case "E":
        case "OU": {
          const vs = no.args.map((a) => valor(a, ler, tipos, totais));
          if (no.nome === "E") return vs.some((x) => x === false) ? false : vs.some((x) => x === null) ? null : true;
          return vs.some((x) => x === true) ? true : vs.some((x) => x === null) ? null : false;
        }
      }
    }
  }
  return null;
}
