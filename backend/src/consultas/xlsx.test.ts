import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { FORMATOS_XLSX, celulaXlsx, montarXlsx, nomeDeAba, type ColunaXlsx } from "./xlsx";

const COLUNAS: Record<string, ColunaXlsx> = {
  consultor: { tipo: "texto" },
  codigo: { tipo: "inteiro" },
  horas: { tipo: "decimal", formato: "horasMinutos" },
  banco: { tipo: "decimal", formato: "horasMinutos" },
  valor: { tipo: "decimal" },
  dia: { tipo: "data" },
  ativo: { tipo: "booleano" },
};

const abrir = async (buf: Buffer) => {
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(buf as unknown as ArrayBuffer);
  return livro.worksheets[0];
};

const pedido = (nomes: string[], linhas: Record<string, unknown>[], totais: string[] = []) => ({
  nomes,
  tituloDe: (n: string) => n.toUpperCase(),
  colunaDe: (n: string) => COLUNAS[n],
  linhas,
  totais,
  aba: "Provisionamento",
});

test("lido de volta: tipos do Excel, cabeçalho fixo, autofiltro e linha de total separada", async () => {
  const buf = await montarXlsx(
    pedido(
      ["consultor", "codigo", "horas", "valor", "dia", "ativo"],
      [
        { consultor: "Fulano", codigo: 505, horas: 9854, valor: 17359.1, dia: new Date("2026-10-31T00:00:00.000Z"), ativo: true },
        { consultor: "=1+1", codigo: 506, horas: 90.6, valor: 0.9, dia: "2026-11-01T00:00:00.000Z", ativo: false },
      ],
      ["horas", "valor", "coluna_oculta"]
    )
  );
  const p = await abrir(buf);
  assert.equal(p.name, "Provisionamento");
  assert.deepEqual((p.getRow(1).values as unknown[]).slice(1), ["CONSULTOR", "CODIGO", "HORAS", "VALOR", "DIA", "ATIVO"]);
  assert.equal(p.getRow(1).getCell(1).font?.bold, true);
  assert.equal((p.views[0] as { state?: string; ySplit?: number }).state, "frozen");
  assert.ok(p.autoFilter, "tem autofiltro");

  const valor = p.getRow(2).getCell(4);
  assert.equal(valor.value, 17359.1);
  assert.equal(valor.numFmt, FORMATOS_XLSX.decimal);
  assert.equal(p.getRow(2).getCell(2).value, 505);
  // 9854 min = 164:14, como fração de dia; 90,6 min arredonda para 91 (1:31, como a tela)
  const horas = p.getRow(2).getCell(3);
  assert.equal(horas.numFmt, FORMATOS_XLSX.horas);
  assert.ok(horas.value instanceof Date || Math.abs(Number(horas.value) - 9854 / 1440) < 1e-9);
  assert.equal(p.getRow(2).getCell(5).numFmt, FORMATOS_XLSX.data);
  assert.equal((p.getRow(2).getCell(5).value as Date).toISOString().slice(0, 10), "2026-10-31");
  assert.equal((p.getRow(3).getCell(5).value as Date).toISOString().slice(0, 10), "2026-11-01");
  assert.equal(p.getRow(2).getCell(6).value, "Sim");
  // texto que parece fórmula continua texto
  assert.equal(p.getRow(3).getCell(1).value, "=1+1");
  assert.equal(p.getRow(3).getCell(1).formula, undefined);

  // linha 4 em branco, total na 5
  assert.equal(p.getRow(4).getCell(4).value, null);
  assert.equal(p.getRow(5).getCell(1).value, "Total");
  assert.equal(p.getRow(5).getCell(4).value, 17360);
  assert.equal(p.getRow(5).font?.bold, true);
});

test("coluna de horas com valor negativo sai em horas decimais (o Excel não mostra hora negativa); as outras continuam hora", async () => {
  const p = await abrir(await montarXlsx(pedido(["banco", "horas"], [{ banco: -173, horas: 60 }, { banco: 142, horas: 30 }], ["banco", "horas"])));
  assert.equal(p.getRow(1).getCell(1).value, "BANCO (horas decimais)");
  assert.equal(p.getRow(1).getCell(2).value, "HORAS");
  assert.equal(p.getRow(2).getCell(1).value, -2.88);
  assert.equal(p.getRow(3).getCell(1).value, 2.37);
  assert.equal(p.getRow(2).getCell(1).numFmt, FORMATOS_XLSX.decimal);
  assert.equal(p.getRow(2).getCell(2).numFmt, FORMATOS_XLSX.horas);
  assert.equal(p.getRow(5).getCell(1).value, -0.52); // total -31 min
});

test("carimbo com hora vira a hora de Brasília; vazio fica vazio; caracteres de controle saem do texto", () => {
  const c = celulaXlsx(new Date("2026-10-06T01:30:00.000Z"), { tipo: "data" });
  assert.equal((c.valor as Date).toISOString(), "2026-10-05T22:30:00.000Z");
  assert.equal(c.formato, FORMATOS_XLSX.dataHora);
  assert.equal(celulaXlsx(null, { tipo: "decimal" }).valor, null);
  assert.equal(celulaXlsx("a\u0000b\u000bc\nd", { tipo: "texto" }).valor, "a b c\nd");
  assert.equal(celulaXlsx("linha 1\r\nlinha 2\rfim", { tipo: "texto" }).valor, "linha 1\nlinha 2\nfim");
});

test("lista vazia gera um arquivo só com o cabeçalho, sem total; nome de aba é saneado", async () => {
  const p = await abrir(await montarXlsx(pedido(["consultor", "valor"], [], ["valor"])));
  assert.equal(p.rowCount, 1);
  assert.equal(nomeDeAba("pedidos/2026: [x]"), "pedidos 2026   x");
  assert.equal(nomeDeAba("a".repeat(50)).length, 31);
});
