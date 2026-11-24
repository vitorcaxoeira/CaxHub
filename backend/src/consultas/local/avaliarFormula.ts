// Avaliação da fórmula de uma coluna calculada em JS, cópia fiel de frontend/src/lib/formulas/formula.ts (avaliarFormula, 03/11/2026), para a
// lista em memória do servidor. A estrutura é validada antes por validarFormula (formulas/formula.ts).
import { LIMITE_EXPOENTE, type No, type TipoColunaFormula } from "../../formulas/formula";

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
