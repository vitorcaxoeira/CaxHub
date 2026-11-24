// Leitura dos parâmetros de query string que as telas de consulta repetem. Criado com a tela Notas de Saída (16/10/2026);
// os routers mais antigos têm cópias locais destas funções e seguem como estão.

/** 'AAAA-MM-DD' válido, ou null. */
export function lerData(valor: unknown): string | null {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  return Number.isNaN(new Date(`${valor}T00:00:00.000Z`).getTime()) ? null : valor;
}

export interface ParFilial {
  codemp: number;
  codfil: number;
}

/** "codemp:codfil,codemp:codfil" — o mesmo formato do EmpresaFilialFilter. Par inválido é descartado. */
export function lerEmpresasFiliais(valor: unknown): ParFilial[] {
  const raw = typeof valor === "string" ? valor : "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((par) => {
      const [codempStr, codfilStr] = par.split(":");
      const codemp = Number(codempStr);
      const codfil = Number(codfilStr);
      return Number.isInteger(codemp) && Number.isInteger(codfil) ? { codemp, codfil } : null;
    })
    .filter((v): v is ParFilial => v !== null);
}

/**
 * Lista literal `(1,1),(1,2)` pra um `IN`. Seguro de interpolar no SQL porque codemp/codfil chegam SEMPRE validados por
 * Number.isInteger em lerEmpresasFiliais (nunca texto cru do usuário).
 */
export function paresSql(pares: ParFilial[]): string {
  return pares.map((p) => `(${p.codemp},${p.codfil})`).join(",");
}

/** "1,3,4" -> [1,3,4]. Valor único, vazio ou inválido não quebra: item inválido é descartado. */
export function lerListaInt(valor: unknown): number[] {
  const raw = typeof valor === "string" ? valor : "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "") // Number("") é 0, que aqui é um valor válido (ex.: tipo "Sem tipo")
    .map(Number)
    .filter((n) => Number.isInteger(n));
}

/** "2,3" -> ["2","3"], só os itens que passam em `valido`. */
export function lerListaTexto(valor: unknown, valido: (item: string) => boolean): string[] {
  const raw = typeof valor === "string" ? valor : "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "" && valido(v));
}

/** Inteiro positivo da query, com padrão e teto. */
export function lerInteiro(valor: unknown, padrao: number, minimo: number, maximo: number): number {
  const n = Number(valor);
  if (!Number.isInteger(n)) return padrao;
  return Math.min(Math.max(n, minimo), maximo);
}

/** Escapa `%`, `_` e `\` do texto digitado pra ele valer como texto literal num ILIKE. */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}
