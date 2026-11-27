import type { ColunaConsulta } from "./consultaColunas";

// Exportação para o Excel das listas do kit (a de SQL, routes/listaConsultavel.ts, e a em memória, routes/listaEmMemoria.ts): um CSV com BOM,
// ";" como separador e vírgula decimal, que abre direto no Excel em português. O formato da célula e a escolha das colunas moram aqui.

const DIA_BR = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const DIA_HORA_BR = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Uma célula do CSV em português: ";" como separador, vírgula decimal, datas dd/mm/aaaa, Sim/Não. */
export function celulaCsv(valor: unknown, tipo: ColunaConsulta["tipo"] | undefined, formato?: ColunaConsulta["formato"]): string {
  let texto: string;
  if (valor == null) texto = "";
  // Coluna em minutos que a tela mostra como HH:MM: no CSV vai em horas decimais, que o Excel soma.
  else if (formato === "horasMinutos" && typeof valor === "number") texto = (valor / 60).toFixed(2).replace(".", ",");
  else if (valor instanceof Date) {
    const meiaNoiteUtc = valor.getUTCHours() === 0 && valor.getUTCMinutes() === 0 && valor.getUTCSeconds() === 0;
    texto = meiaNoiteUtc ? DIA_BR.format(valor) : DIA_HORA_BR.format(valor);
  } else if (typeof valor === "boolean") texto = valor ? "Sim" : "Não";
  else if (typeof valor === "number") texto = (tipo === "decimal" ? valor.toFixed(2) : String(valor)).replace(".", ",");
  else texto = String(valor);
  // Células que o Excel interpretaria como fórmula (=, +, -, @) ganham um apóstrofo na frente: texto vindo do banco nunca vira fórmula.
  if (typeof valor === "string" && /^[=+\-@]/.test(texto)) texto = `'${texto}`;
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * As colunas que a tela pediu (`colunasCsv`, as visíveis na ordem dela) e o título de cada uma (`cabecalhos`, JSON { nome: título }). Nome que a
 * lista não tem é ignorado; sem nenhum válido, saem as colunas `padrao`.
 */
export function colunasDaExportacao(q: Record<string, unknown>, existe: (nome: string) => boolean, padrao: string[]) {
  const pedidas = typeof q.colunasCsv === "string" ? q.colunasCsv.split(",").filter(existe) : [];
  const nomes = pedidas.length ? pedidas : padrao;
  let titulos: Record<string, unknown> = {};
  try {
    const lido = typeof q.cabecalhos === "string" ? JSON.parse(q.cabecalhos) : {};
    if (lido && typeof lido === "object") titulos = lido as Record<string, unknown>;
  } catch {
    /* cabeçalho é só enfeite: sem JSON válido usa o nome técnico */
  }
  const tituloDe = (n: string) => (typeof titulos[n] === "string" ? (titulos[n] as string) : n);
  return { nomes, tituloDe };
}

/** O arquivo inteiro: BOM + cabeçalho + uma linha por registro. */
export function montarCsv(
  nomes: string[],
  tituloDe: (nome: string) => string,
  colunaDe: (nome: string) => { tipo?: ColunaConsulta["tipo"]; formato?: ColunaConsulta["formato"] } | undefined,
  linhas: Record<string, unknown>[]
): string {
  const cabecalho = nomes.map((n) => celulaCsv(tituloDe(n), undefined)).join(";");
  const corpo = linhas.map((l) => nomes.map((n) => celulaCsv(l[n], colunaDe(n)?.tipo, colunaDe(n)?.formato)).join(";"));
  return `﻿${[cabecalho, ...corpo].join("\r\n")}`;
}
