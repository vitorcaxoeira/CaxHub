import ExcelJS from "exceljs";
import type { ColunaConsulta } from "./consultaColunas";

// Exportação .xlsx das listas do kit (27/11/2026), ao lado do CSV (csv.ts): o mesmo conteúdo (linhas do filtro, na ordem da tela, com as colunas
// visíveis e os títulos dela), mas com os tipos do Excel: número é número, data é data, horas são hora do Excel (164:14, que soma), cabeçalho
// fixo com autofiltro e uma linha de total nas colunas que a lista já soma no rodapé. Texto é sempre gravado como texto, nunca como fórmula.

export interface ColunaXlsx {
  tipo?: ColunaConsulta["tipo"];
  formato?: ColunaConsulta["formato"];
}

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const FORMATOS_XLSX = { decimal: "#,##0.00", inteiro: "0", horas: "[h]:mm", data: "dd/mm/yyyy", dataHora: "dd/mm/yyyy hh:mm" } as const;

const LARGURA_MINIMA = 10;
const LARGURA_MAXIMA = 60;
const MAX_TEXTO_CELULA = 32767;
// Caracteres de controle (vêm em alguns textos antigos do ERP) deixam o XML inválido e o Excel recusa o arquivo.
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const emBrasilia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/**
 * O Excel não tem fuso: grava a hora "de parede". Data pura (meia-noite UTC) fica como está; carimbo com hora vira a hora de Brasília, como na
 * tela e no CSV.
 */
function dataDoExcel(d: Date): { valor: Date; formato: string } {
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return { valor: d, formato: FORMATOS_XLSX.data };
  const p = Object.fromEntries(emBrasilia.formatToParts(d).map((x) => [x.type, x.value]));
  return { valor: new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))), formato: FORMATOS_XLSX.dataHora };
}

interface Celula {
  valor: ExcelJS.CellValue;
  formato?: string;
  /** Quantos caracteres a célula ocupa na tela (para a largura da coluna). */
  largura: number;
}

const texto = (t: string): Celula => {
  // Quebra de linha dentro da célula, no Excel, é só LF (o ERP grava CR+LF).
  const limpo = t.replace(/\r\n?/g, "\n").replace(CONTROLE, " ").slice(0, MAX_TEXTO_CELULA);
  return { valor: limpo, largura: limpo.length };
};
const comSeparadorDeMilhar = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length;

/** Uma célula no tipo do Excel. `horasEmDecimal`: coluna de minutos com valor negativo (ver montarXlsx). */
export function celulaXlsx(valor: unknown, coluna: ColunaXlsx | undefined, horasEmDecimal = false): Celula {
  if (valor == null || valor === "") return { valor: null, largura: 0 };
  if (coluna?.formato === "horasMinutos" && typeof valor === "number") {
    if (horasEmDecimal) return { valor: Math.round((valor / 60) * 100) / 100, formato: FORMATOS_XLSX.decimal, largura: comSeparadorDeMilhar(valor / 60) };
    // Minuto inteiro, arredondado como a tela (o Excel cortaria os segundos e mostraria um minuto a menos). Dia = 1 no Excel.
    return { valor: Math.round(valor) / 1440, formato: FORMATOS_XLSX.horas, largura: 8 };
  }
  const comoData = valor instanceof Date ? valor : coluna?.tipo === "data" && typeof valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(valor) ? new Date(valor) : null;
  if (comoData && !Number.isNaN(comoData.getTime())) {
    const d = dataDoExcel(comoData);
    return { valor: d.valor, formato: d.formato, largura: d.formato.length };
  }
  if (typeof valor === "boolean") return texto(valor ? "Sim" : "Não");
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return { valor: null, largura: 0 };
    return coluna?.tipo === "decimal"
      ? { valor, formato: FORMATOS_XLSX.decimal, largura: comSeparadorDeMilhar(valor) }
      : { valor, ...(coluna?.tipo === "inteiro" ? { formato: FORMATOS_XLSX.inteiro } : {}), largura: String(valor).length };
  }
  return texto(String(valor));
}

/** Nome de aba válido no Excel (até 31 caracteres, sem [ ] : * ? / \). */
export const nomeDeAba = (nome: string) => nome.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Dados";

export interface PedidoXlsx {
  nomes: string[];
  tituloDe: (nome: string) => string;
  colunaDe: (nome: string) => ColunaXlsx | undefined;
  linhas: Record<string, unknown>[];
  /** Colunas que a lista soma no rodapé: ganham a linha de total (só as que estão entre as visíveis). */
  totais?: string[];
  aba: string;
}

export async function montarXlsx({ nomes, tituloDe, colunaDe, linhas, totais = [], aba }: PedidoXlsx): Promise<Buffer> {
  const livro = new ExcelJS.Workbook();
  livro.creator = "CaxHub";
  const planilha = livro.addWorksheet(nomeDeAba(aba), { views: [{ state: "frozen", ySplit: 1 }] });

  // O Excel não mostra hora negativa em [h]:mm (vira ####): a coluna de horas com algum valor negativo sai inteira em horas decimais, e o título diz.
  const emDecimal = new Set(nomes.filter((n) => colunaDe(n)?.formato === "horasMinutos" && linhas.some((l) => typeof l[n] === "number" && (l[n] as number) < 0)));
  const titulos = nomes.map((n) => (emDecimal.has(n) ? `${tituloDe(n)} (horas decimais)` : tituloDe(n)));
  const larguras = titulos.map((t) => t.length + 2); // a folga é a seta do autofiltro

  const escrever = (linha: ExcelJS.Row, indice: number, c: Celula) => {
    const alvo = linha.getCell(indice + 1);
    alvo.value = c.valor;
    if (c.formato) alvo.numFmt = c.formato;
    if (c.largura > larguras[indice]) larguras[indice] = c.largura;
  };

  const cabecalho = planilha.getRow(1);
  titulos.forEach((t, i) => (cabecalho.getCell(i + 1).value = texto(t).valor));
  cabecalho.eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDEA" } };
    c.border = { bottom: { style: "thin" } };
    c.alignment = { vertical: "middle" };
  });

  linhas.forEach((registro, n) => {
    const linha = planilha.getRow(n + 2);
    nomes.forEach((nome, i) => escrever(linha, i, celulaXlsx(registro[nome], colunaDe(nome), emDecimal.has(nome))));
  });

  if (linhas.length > 0) planilha.autoFilter = { from: { row: 1, column: 1 }, to: { row: linhas.length + 1, column: nomes.length } };

  const somadas = nomes.filter((n) => totais.includes(n));
  if (linhas.length > 0 && somadas.length > 0) {
    // Uma linha em branco separa o total: assim o autofiltro e a ordenação do Excel não o misturam com os registros.
    const linha = planilha.getRow(linhas.length + 3);
    nomes.forEach((nome, i) => {
      if (!somadas.includes(nome)) return;
      const soma = linhas.reduce((s, l) => s + (Number.isFinite(Number(l[nome])) && l[nome] !== null ? Number(l[nome]) : 0), 0);
      escrever(linha, i, celulaXlsx(Math.round(soma * 100) / 100, colunaDe(nome) ?? { tipo: "decimal" }, emDecimal.has(nome)));
    });
    if (!somadas.includes(nomes[0])) linha.getCell(1).value = "Total";
    linha.font = { bold: true };
    nomes.forEach((_, i) => (linha.getCell(i + 1).border = { top: { style: "thin" } }));
  }

  larguras.forEach((w, i) => (planilha.getColumn(i + 1).width = Math.min(LARGURA_MAXIMA, Math.max(LARGURA_MINIMA, w + 2))));

  return Buffer.from(await livro.xlsx.writeBuffer());
}
