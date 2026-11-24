import { describe, expect, it } from "vitest";
import { analisarFormula, avaliarFormula, colunasDaFormula, formulaParaTexto, lerFormula, type ColunaDisponivel, type No } from "./formula";

const COLUNAS: ColunaDisponivel[] = [
  { nome: "quantidade", titulo: "Quantidade Plannix", tipo: "decimal" },
  { nome: "consumoErp", titulo: "Consumo ERP", tipo: "decimal" },
  { nome: "pecas", titulo: "Peças", tipo: "inteiro" },
  { nome: "descricao", titulo: "Material", tipo: "texto" },
  { nome: "primeiro", titulo: "Primeiro", tipo: "data" },
  { nome: "ultimo", titulo: "Último", tipo: "data" },
  { nome: "incompleto", titulo: "Incompleto", tipo: "booleano" },
];
const TIPOS = new Map(COLUNAS.map((c) => [c.nome, c.tipo]));
const TITULOS = Object.fromEntries(COLUNAS.map((c) => [c.nome, c.titulo]));

const arvore = (texto: string): No => {
  const r = analisarFormula(texto, COLUNAS);
  if (!r.ok) throw new Error(`${r.erro} (posição ${r.posicao})`);
  return r.arvore;
};
const calcular = (texto: string, linha: Record<string, unknown>, totais: Record<string, number | null> = {}) =>
  avaliarFormula(arvore(texto), (n) => linha[n], TIPOS, totais);
const erro = (texto: string) => {
  const r = analisarFormula(texto, COLUNAS);
  return r.ok ? null : r.erro;
};

describe("leitura", () => {
  it("precedência: * antes de +, ^ antes de *, parênteses mandam", () => {
    expect(calcular("1 + 2 * 3", {})).toBe(7);
    expect(calcular("(1 + 2) * 3", {})).toBe(9);
    expect(calcular("2 * 3 ^ 2", {})).toBe(18);
    expect(calcular("2 ^ 3 ^ 2", {})).toBe(512); // ^ associa à direita
    expect(calcular("10 - 4 - 3", {})).toBe(3); // - associa à esquerda
    expect(calcular("-2 ^ 2", {})).toBe(-4); // convenção da matemática: -(2²)
  });
  it("vírgula decimal e sinais colados (× ÷ −)", () => {
    expect(calcular("1,5 * 2", {})).toBe(3);
    expect(calcular("10 ÷ 4 × 2 − 1", {})).toBe(4);
    expect(erro("1.5 * 2")).toMatch(/vírgula/);
  });
  it("colunas pelo título, sem diferenciar maiúsculas, ou pelo nome técnico", () => {
    expect(lerFormula("[consumo erp] + [quantidade]", COLUNAS)).toEqual({
      t: "bin",
      op: "+",
      a: { t: "col", nome: "consumoErp" },
      b: { t: "col", nome: "quantidade" },
    });
  });
  it("erros com a posição", () => {
    const r = analisarFormula("([Consumo ERP] + 1", COLUNAS);
    expect(r).toMatchObject({ ok: false, erro: "Faltou fechar parêntese" });
    expect(analisarFormula("[Consumo] + 1", COLUNAS)).toEqual({ ok: false, erro: "A coluna [Consumo] não existe nesta lista", posicao: 0 });
    expect(erro("1 +")).toMatch(/terminou antes/);
    expect(erro("1 ) + 2")).toMatch(/fechado sem ter sido aberto/);
    expect(erro("SOMA([Peças])")).toMatch(/Função SOMA não existe/);
    expect(erro("1 $ 2")).toMatch(/Caractere inesperado/);
    expect(erro("")).toMatch(/Escreva/);
    expect(erro("1 + ".repeat(200) + "1")).toMatch(/longa demais/);
  });
});

describe("tipos", () => {
  it("texto não entra em conta; data só em DIAS; resultado tem que ser número", () => {
    expect(erro("[Material] + 1")).toMatch(/texto não entra/);
    expect(erro("[Primeiro] + 1")).toMatch(/datas só entram em DIAS/);
    expect(erro("[Peças] > 1")).toMatch(/precisa dar um número/);
    expect(erro("SE([Peças]; 1; 0)")).toMatch(/condição/);
    expect(erro("ARRED([Peças]; 1,5)")).toMatch(/inteiro de 0 a 6/);
    expect(erro("TOTAL([Peças] * 2)")).toMatch(/recebe uma coluna/);
    expect(erro("MIN([Peças])")).toMatch(/argumento/);
    expect(erro("[Primeiro] > [Peças]")).toMatch(/dois números ou de duas datas/);
  });
});

describe("cálculo (mesma semântica do SQL do servidor)", () => {
  const linha = { quantidade: 120, consumoErp: 100, pecas: 4, primeiro: "2026-01-01T03:00:00Z", ultimo: "2026-01-11T03:00:00Z", incompleto: true };
  it("contas com as colunas da linha", () => {
    expect(calcular("([Quantidade Plannix] - [Consumo ERP]) / [Consumo ERP] * 100", linha)).toBe(20);
    expect(calcular("[Quantidade Plannix] / [Peças]", linha)).toBe(30);
  });
  it("vazio contamina; divisão por zero dá vazio", () => {
    expect(calcular("[Quantidade Plannix] + [Consumo ERP]", { quantidade: 1, consumoErp: null })).toBeNull();
    expect(calcular("[Quantidade Plannix] / [Consumo ERP]", { quantidade: 1, consumoErp: 0 })).toBeNull();
    expect(calcular("SEVAZIO([Consumo ERP]; 0) + 1", { consumoErp: null })).toBe(1);
  });
  it("funções", () => {
    expect(calcular("ABS(-3)", {})).toBe(3);
    expect(calcular("ARRED(2,5; 0)", {})).toBe(3);
    expect(calcular("ARRED(-2,5; 0)", {})).toBe(-3); // metade para longe do zero, como o round() do Postgres
    expect(calcular("ARRED(1,23456; 2)", {})).toBe(1.23);
    expect(calcular("MIN([Consumo ERP]; [Quantidade Plannix]; 50)", linha)).toBe(50);
    expect(calcular("MAX([Consumo ERP]; [Peças])", { consumoErp: null, pecas: 4 })).toBe(4); // ignora vazio
    expect(calcular("SE([Quantidade Plannix] > [Consumo ERP]; 1; 0)", linha)).toBe(1);
    expect(calcular("SE([Consumo ERP] > 0; 1; 0)", { consumoErp: null })).toBe(0); // condição vazia vai para o senão
    expect(calcular("SE(E([Peças] > 1; [Consumo ERP] > 0); 1; 0)", { pecas: 2, consumoErp: null })).toBe(0); // E com vazio: não é verdadeiro
    expect(calcular("SE(OU([Peças] > 1; [Consumo ERP] > 0); 1; 0)", { pecas: 2, consumoErp: null })).toBe(1);
    expect(erro("SE([Incompleto] = [Incompleto]; 1; 0)")).toMatch(/dois números ou de duas datas/); // Sim/Não não se compara
  });
  it("DIAS entre datas", () => {
    expect(calcular("DIAS([Primeiro]; [Último])", linha)).toBe(10);
  });
  it("TOTAL vem de fora (soma da coluna no filtro)", () => {
    expect(calcular("[Consumo ERP] / TOTAL([Consumo ERP]) * 100", linha, { consumoErp: 400 })).toBe(25);
    expect(calcular("[Consumo ERP] / TOTAL([Consumo ERP])", linha, {})).toBeNull();
  });
  it("potência: expoente enorme, raiz de negativo e 0 elevado a negativo dão vazio", () => {
    expect(calcular("2 ^ 101", {})).toBeNull();
    expect(calcular("(-8) ^ 0,5", {})).toBeNull();
    expect(calcular("0 ^ -1", {})).toBeNull();
    expect(calcular("(-2) ^ 3", {})).toBe(-8);
  });
});

describe("de volta para texto", () => {
  it("usa os títulos atuais e só os parênteses necessários", () => {
    for (const f of ["([Quantidade Plannix] - [Consumo ERP]) / [Consumo ERP] * 100", "SE([Peças] > 1; ARRED([Consumo ERP]; 2); 0)", "2 ^ 3 ^ 2", "(2 ^ 3) ^ 2", "10 - (4 - 3)", "-(1 + 2)"])
      expect(formulaParaTexto(arvore(f), TITULOS)).toBe(f);
    expect(formulaParaTexto(arvore("1,5 * [peças]"), { ...TITULOS, pecas: "Qtd. peças" })).toBe("1,5 * [Qtd. peças]");
  });
  it("colunas citadas, e as de dentro do TOTAL", () => {
    const a = arvore("[Consumo ERP] / TOTAL([Consumo ERP]) + [Peças]");
    expect(colunasDaFormula(a).sort()).toEqual(["consumoErp", "pecas"]);
    expect(colunasDaFormula(a, true)).toEqual(["consumoErp"]);
  });
});
