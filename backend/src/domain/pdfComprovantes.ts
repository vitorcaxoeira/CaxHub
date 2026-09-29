import fs from "fs";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

// PDF único com os comprovantes de uma RAT (GET /rats/:id/comprovantes/pdf). Dois modos:
//  - "prestacao": capa com o resumo da RAT/despesas + cada comprovante numa página com faixa de
//    identificação + rodapé numerado ("Página X de Y");
//  - "simples": só os comprovantes em sequência (páginas de PDF como estão, foto numa página A4).
// Monta tudo no servidor com pdf-lib (JS puro, sem binário nativo no Docker). pdf-lib só embute
// JPEG e PNG: o cliente reduz as fotos pra JPEG ao enviar (frontend/src/utils/reduzirImagem.ts);
// o que não entra (webp antigo, HEIC, PDF protegido/corrompido, arquivo sumido) vira uma página de
// aviso — um anexo ruim nunca derruba o PDF inteiro.

export type ModoPdfComprovantes = "prestacao" | "simples";

export interface ComprovanteParaPdf {
  id: number;
  despesaId: number | null;
  nomeArquivo: string;
  mimeType: string;
  // Caminho absoluto no disco.
  arquivo: string;
}

export interface DespesaParaPdf {
  id: number;
  tipdes: number | null;
  tipdesLabel: string;
  desrdv: string | null;
  qtdrdv: number | null;
  vlrtot: number | null;
  datemi: Date | string | null;
}

export interface RelatorioParaPdf {
  rat: {
    numrat: number | null;
    datemi: Date | string | null;
    consultorNome: string;
    cliente: string | null;
    codpro: number | null;
    numprj: number | null;
    codfpj: number | null;
    faturaCliente: boolean;
  };
  despesas: DespesaParaPdf[];
  resumoPorCategoria: { categoria: string; qtdrdv: number; vlrtot: number }[];
  total: number;
}

// Deslocamento por km (1) e por rota (7) não têm nota a comprovar — mesma regra do aviso "Sem
// comprovante" da tela (DespesasRatPainel.tsx).
const TIPOS_SEM_NOTA = new Set([1, 7]);

const A4 = { w: 595.28, h: 841.89 };
const MARGEM = 40;
const COR_TEXTO = rgb(0.1, 0.1, 0.1);
const COR_MUDO = rgb(0.4, 0.4, 0.4);
const COR_LINHA = rgb(0.75, 0.75, 0.75);
const COR_MARCA = rgb(0.09, 0.45, 0.33);
const COR_ALERTA = rgb(0.75, 0.3, 0.05);
const ALTURA_FAIXA = 46;
const ALTURA_RODAPE = 26;

// Paleta e traços da capa (modo prestação): mesmo estilo "documento oficial" do relatório de RDV
// já existente (frontend/src/pages/projetos/RelatorioDespesasRat.tsx) — preto sólido, sem cor de
// marca, pra prestação de contas parecer a mesma família de papel que RH/financeiro já reconhece.
const CAPA_PRETO = rgb(0, 0, 0);
const CAPA_CINZA_TEXTO = rgb(0.35, 0.35, 0.35);
const CAPA_CINZA_CLARO = rgb(0.92, 0.92, 0.92);
const CAPA_CINZA_LINHA = rgb(0.7, 0.7, 0.7);
const CAPA_BORDA_GROSSA = 1.6;
const CAPA_BORDA_FINA = 0.75;

const dinheiro = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatarDinheiro = (v: number | null) => `R$ ${dinheiro.format(v ?? 0)}`;

function formatarData(v: Date | string | null): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d);
}

function formatarDataHora(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(d);
}

// A fonte padrão do PDF (WinAnsi) cobre os acentos do português, mas lança erro em qualquer outro
// caractere (emoji, aspas curvas de outros idiomas...) — troca o que não couber por "?".
function texto(fonte: PDFFont, valor: string): string {
  let saida = "";
  for (const ch of valor.replace(/[\r\n\t]+/g, " ")) {
    try {
      fonte.encodeText(ch);
      saida += ch;
    } catch {
      saida += "?";
    }
  }
  return saida;
}

function cortar(fonte: PDFFont, valor: string, tamanho: number, larguraMax: number): string {
  let t = texto(fonte, valor);
  if (fonte.widthOfTextAtSize(t, tamanho) <= larguraMax) return t;
  while (t.length > 1 && fonte.widthOfTextAtSize(`${t}...`, tamanho) > larguraMax) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

function quebrarLinhas(fonte: PDFFont, valor: string, tamanho: number, larguraMax: number): string[] {
  const palavras = texto(fonte, valor).split(" ");
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(tentativa, tamanho) <= larguraMax || !atual) atual = tentativa;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

interface Fontes {
  normal: PDFFont;
  negrito: PDFFont;
}

function tipoDoArquivo(c: ComprovanteParaPdf): "pdf" | "jpg" | "png" | "outro" {
  const mime = c.mimeType.toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  return "outro";
}

function novaPaginaA4(doc: PDFDocument): PDFPage {
  return doc.addPage([A4.w, A4.h]);
}

function paginaDeAviso(doc: PDFDocument, fontes: Fontes, nome: string, motivo: string): PDFPage {
  const pagina = novaPaginaA4(doc);
  const larg = A4.w - MARGEM * 2;
  let y = A4.h / 2 + 40;
  pagina.drawText("Arquivo não incluído neste PDF", { x: MARGEM, y, size: 15, font: fontes.negrito, color: COR_ALERTA });
  y -= 26;
  for (const linha of quebrarLinhas(fontes.normal, nome, 12, larg)) {
    pagina.drawText(linha, { x: MARGEM, y, size: 12, font: fontes.normal, color: COR_TEXTO });
    y -= 16;
  }
  y -= 6;
  for (const linha of quebrarLinhas(fontes.normal, `${motivo} Baixe o arquivo original separadamente (botão "Baixar" na janela de comprovantes).`, 11, larg)) {
    pagina.drawText(linha, { x: MARGEM, y, size: 11, font: fontes.normal, color: COR_MUDO });
    y -= 15;
  }
  return pagina;
}

// Área útil de uma página de comprovante: no modo prestação, abaixo da faixa e acima do rodapé;
// no simples, a página inteira com uma margem pequena.
function areaUtil(pagina: PDFPage, comFaixa: boolean) {
  const { width, height } = pagina.getSize();
  if (!comFaixa) return { x: 28, y: 28, w: width - 56, h: height - 56 };
  const base = ALTURA_RODAPE + 10;
  return { x: MARGEM, y: base, w: width - MARGEM * 2, h: height - ALTURA_FAIXA - 12 - base };
}

function desenharFaixa(pagina: PDFPage, fontes: Fontes, titulo: string, subtitulo: string) {
  const { width, height } = pagina.getSize();
  pagina.drawRectangle({ x: 0, y: height - ALTURA_FAIXA, width, height: ALTURA_FAIXA, color: rgb(0.94, 0.97, 0.95) });
  pagina.drawRectangle({ x: 0, y: height - ALTURA_FAIXA, width: 5, height: ALTURA_FAIXA, color: COR_MARCA });
  pagina.drawText(cortar(fontes.negrito, titulo, 11.5, width - MARGEM * 2), { x: MARGEM, y: height - 20, size: 11.5, font: fontes.negrito, color: COR_TEXTO });
  pagina.drawText(cortar(fontes.normal, subtitulo, 9.5, width - MARGEM * 2), { x: MARGEM, y: height - 36, size: 9.5, font: fontes.normal, color: COR_MUDO });
}

async function adicionarComprovante(
  doc: PDFDocument,
  fontes: Fontes,
  c: ComprovanteParaPdf,
  modo: ModoPdfComprovantes,
  faixa: { titulo: string; subtitulo: string }
): Promise<void> {
  const comFaixa = modo === "prestacao";
  const tipo = tipoDoArquivo(c);

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(c.arquivo);
  } catch {
    paginaDeAviso(doc, fontes, c.nomeArquivo, "O arquivo não foi encontrado no servidor.");
    return;
  }

  try {
    if (tipo === "jpg" || tipo === "png") {
      const imagem = tipo === "jpg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      const pagina = novaPaginaA4(doc);
      const area = areaUtil(pagina, comFaixa);
      const escala = Math.min(area.w / imagem.width, area.h / imagem.height);
      const larg = imagem.width * escala;
      const alt = imagem.height * escala;
      pagina.drawImage(imagem, { x: area.x + (area.w - larg) / 2, y: area.y + (area.h - alt) / 2, width: larg, height: alt });
      if (comFaixa) desenharFaixa(pagina, fontes, faixa.titulo, faixa.subtitulo);
      return;
    }

    if (tipo === "pdf") {
      const origem = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
      if (modo === "simples") {
        const copiadas = await doc.copyPages(origem, origem.getPageIndices());
        copiadas.forEach((p) => doc.addPage(p));
        return;
      }
      // Prestação: cada página do anexo vira uma página A4 com faixa, a original em escala.
      const incorporadas = await doc.embedPdf(origem, origem.getPageIndices());
      incorporadas.forEach((pagOrigem, i) => {
        const paisagem = pagOrigem.width > pagOrigem.height;
        const pagina = doc.addPage(paisagem ? [A4.h, A4.w] : [A4.w, A4.h]);
        const area = areaUtil(pagina, true);
        const escala = Math.min(area.w / pagOrigem.width, area.h / pagOrigem.height);
        const larg = pagOrigem.width * escala;
        const alt = pagOrigem.height * escala;
        pagina.drawPage(pagOrigem, { x: area.x + (area.w - larg) / 2, y: area.y + (area.h - alt) / 2, width: larg, height: alt });
        pagina.drawRectangle({
          x: area.x + (area.w - larg) / 2,
          y: area.y + (area.h - alt) / 2,
          width: larg,
          height: alt,
          borderColor: COR_LINHA,
          borderWidth: 0.5,
        });
        const sufixo = incorporadas.length > 1 ? ` · página ${i + 1} de ${incorporadas.length}` : "";
        desenharFaixa(pagina, fontes, faixa.titulo, `${faixa.subtitulo}${sufixo}`);
      });
      return;
    }

    paginaDeAviso(doc, fontes, c.nomeArquivo, `Formato não suportado no PDF (${c.mimeType}).`);
  } catch {
    // Uma página de aviso no lugar; páginas que o arquivo tenha chegado a adicionar antes do erro
    // ficam (raro: o erro costuma vir no load/embed, antes de qualquer página).
    paginaDeAviso(doc, fontes, c.nomeArquivo, tipo === "pdf" ? "O PDF está protegido ou corrompido." : "A imagem não pôde ser lida.");
  }
}

// ---------- capa (modo prestação) ----------
//
// Mesmo estilo visual do relatório de impressão já existente (RelatorioDespesasRat.tsx): caixas
// retangulares com borda preta, cabeçalho cinza-claro em maiúsculas, checkbox quadrado pra
// Faturar Cliente — "papel oficial", sem cor de marca. O conteúdo é diferente (tabela de despesas
// ganha a coluna Comprovantes, com o aviso de quem está sem nota) porque este documento fala de
// comprovante e aquele não.

function linhaCentralizada(pagina: PDFPage, fonte: PDFFont, valor: string, y: number, tamanho: number, cor = CAPA_PRETO) {
  const largura = fonte.widthOfTextAtSize(valor, tamanho);
  pagina.drawText(valor, { x: (A4.w - largura) / 2, y, size: tamanho, font: fonte, color: cor });
}

// Checkbox quadrado com "X" quando marcado — mesmo espírito do <span className="border"> do HTML.
function desenharCheckbox(pagina: PDFPage, fontes: Fontes, x: number, y: number, marcado: boolean) {
  const lado = 9;
  pagina.drawRectangle({ x, y, width: lado, height: lado, borderColor: CAPA_PRETO, borderWidth: CAPA_BORDA_FINA });
  if (marcado) {
    const largX = fontes.negrito.widthOfTextAtSize("X", 7.5);
    pagina.drawText("X", { x: x + (lado - largX) / 2, y: y + 1.5, size: 7.5, font: fontes.negrito, color: CAPA_PRETO });
  }
}

function desenharCapa(doc: PDFDocument, fontes: Fontes, relatorio: RelatorioParaPdf, contagem: Map<number, number>, geradoEm: Date, geradoPor: string) {
  const { rat } = relatorio;
  let pagina = novaPaginaA4(doc);
  const larg = A4.w - MARGEM * 2;
  let y = A4.h - MARGEM;

  // Cabeçalho — título centrado, maiúsculo, borda grossa por baixo (mesmo peso do <h2> do
  // relatório de RDV).
  linhaCentralizada(pagina, fontes.negrito, texto(fontes.negrito, "PRESTAÇÃO DE CONTAS"), y - 14, 17);
  linhaCentralizada(
    pagina,
    fontes.normal,
    texto(fontes.normal, `Despesas de viagem · RAT ${rat.numrat ?? "—"}`),
    y - 30,
    10.5,
    CAPA_CINZA_TEXTO
  );
  y -= 42;
  pagina.drawLine({ start: { x: MARGEM, y }, end: { x: MARGEM + larg, y }, thickness: CAPA_BORDA_GROSSA, color: CAPA_PRETO });

  // Bloco Consultor (esquerda) | Faturar Cliente + Emitido em/por (direita) — uma caixa só, com
  // divisórias internas, igual à grade `grid-cols-[1fr_auto]` do relatório.
  const alturaBloco1 = 56;
  const yBloco1 = y - alturaBloco1;
  const xDivisor1 = MARGEM + larg * 0.42;
  const xDivisor2 = xDivisor1 + 108;
  pagina.drawRectangle({ x: MARGEM, y: yBloco1, width: larg, height: alturaBloco1, borderColor: CAPA_PRETO, borderWidth: CAPA_BORDA_FINA });
  pagina.drawLine({ start: { x: xDivisor1, y: yBloco1 }, end: { x: xDivisor1, y }, thickness: CAPA_BORDA_FINA, color: CAPA_PRETO });
  pagina.drawLine({ start: { x: xDivisor2, y: yBloco1 }, end: { x: xDivisor2, y }, thickness: CAPA_BORDA_FINA, color: CAPA_PRETO });

  const rotuloPequeno = (x: number, yy: number, texto_: string) =>
    pagina.drawText(texto(fontes.negrito, texto_.toUpperCase()), { x, y: yy, size: 7, font: fontes.negrito, color: CAPA_CINZA_TEXTO });

  rotuloPequeno(MARGEM + 8, y - 15, "Consultor");
  pagina.drawText(cortar(fontes.normal, rat.consultorNome, 10.5, xDivisor1 - MARGEM - 16), {
    x: MARGEM + 8,
    y: y - 29,
    size: 10.5,
    font: fontes.normal,
    color: CAPA_PRETO,
  });

  // Faturar Cliente: dois checkboxes empilhados, só um marcado — cópia do HTML.
  desenharCheckbox(pagina, fontes, xDivisor1 + 10, y - 16, rat.faturaCliente);
  pagina.drawText(texto(fontes.normal, "Faturar Cliente"), { x: xDivisor1 + 24, y: y - 15, size: 8.5, font: fontes.normal, color: CAPA_PRETO });
  desenharCheckbox(pagina, fontes, xDivisor1 + 10, y - 32, !rat.faturaCliente);
  pagina.drawText(texto(fontes.normal, "Não Fatura"), { x: xDivisor1 + 24, y: y - 31, size: 8.5, font: fontes.normal, color: CAPA_PRETO });

  rotuloPequeno(xDivisor2 + 10, y - 15, "Emitido em");
  pagina.drawText(formatarDataHora(geradoEm), { x: xDivisor2 + 10, y: y - 27, size: 9.5, font: fontes.normal, color: CAPA_PRETO });
  rotuloPequeno(xDivisor2 + 10, y - 40, "Emitido por");
  pagina.drawText(cortar(fontes.normal, geradoPor, 9.5, MARGEM + larg - xDivisor2 - 18), { x: xDivisor2 + 10, y: y - 52, size: 9.5, font: fontes.normal, color: CAPA_PRETO });

  y = yBloco1;

  // Tabela Proposta / Projeto / Fase / Data da RAT / Cliente — mesmas colunas do relatório de
  // RDV, com "Data da RAT" no lugar do que lá não existe (a prestação não repete no cabeçalho).
  const colunasCab = [
    { rotulo: "Proposta", largura: 58, valor: rat.codpro != null ? String(rat.codpro) : "—" },
    { rotulo: "Projeto / Fase", largura: 70, valor: `${rat.numprj ?? "—"} / ${rat.codfpj ?? "—"}` },
    { rotulo: "Data da RAT", largura: 78, valor: formatarData(rat.datemi) },
    { rotulo: "Nome do Cliente", largura: 0, valor: rat.cliente ?? "—" }, // 0 = ocupa o resto
  ];
  const alturaLinhaCab = 34;
  pagina.drawRectangle({ x: MARGEM, y: y - alturaLinhaCab, width: larg, height: alturaLinhaCab, color: CAPA_CINZA_CLARO, borderColor: CAPA_PRETO, borderWidth: CAPA_BORDA_FINA });
  {
    let x = MARGEM;
    for (const col of colunasCab) {
      const w = col.largura || larg - (x - MARGEM);
      if (x > MARGEM) pagina.drawLine({ start: { x, y }, end: { x, y: y - alturaLinhaCab }, thickness: CAPA_BORDA_FINA, color: CAPA_PRETO });
      pagina.drawText(texto(fontes.negrito, col.rotulo.toUpperCase()), { x: x + 6, y: y - 13, size: 7, font: fontes.negrito, color: CAPA_CINZA_TEXTO });
      pagina.drawText(cortar(fontes.normal, col.valor, 9.5, w - 12), { x: x + 6, y: y - 27, size: 9.5, font: fontes.normal, color: CAPA_PRETO });
      x += w;
    }
  }
  y -= alturaLinhaCab;
  pagina.drawLine({ start: { x: MARGEM, y }, end: { x: MARGEM + larg, y }, thickness: CAPA_BORDA_GROSSA, color: CAPA_PRETO });
  y -= 20;

  // Tabela de despesas — cabeçalho cinza-claro repetido em cada página, linhas finas entre
  // registros, borda externa grossa em cima/embaixo (mesmo padrão do relatório de RDV). Coluna
  // "Comprovantes" é o que este documento acrescenta.
  const col = { data: MARGEM, tipo: MARGEM + 58, desc: MARGEM + 168, qtd: MARGEM + 318, valor: MARGEM + 350, comp: MARGEM + 425 };
  const desenharCabecalhoTabela = () => {
    pagina.drawRectangle({ x: MARGEM, y: y - 18, width: larg, height: 18, color: CAPA_CINZA_CLARO });
    pagina.drawLine({ start: { x: MARGEM, y }, end: { x: MARGEM + larg, y }, thickness: CAPA_BORDA_GROSSA, color: CAPA_PRETO });
    const t = (s: string, x: number, alinhadoDireita = false, larguraCol = 0) => {
      const largTxt = fontes.negrito.widthOfTextAtSize(s, 7.5);
      pagina.drawText(s, { x: alinhadoDireita ? x + larguraCol - largTxt : x, y: y - 13, size: 7.5, font: fontes.negrito, color: CAPA_CINZA_TEXTO });
    };
    t("DATA", col.data + 4);
    t("TIPO", col.tipo);
    t("DESCRIÇÃO", col.desc);
    t("QTD.", col.qtd, true, 26);
    t("VALOR", col.valor, true, 62);
    t("COMPROVANTES", col.comp);
    // Avança mais que a altura da caixa (18): sem essa folga, a 1ª linha de dados (desenhada logo
    // em seguida na mesma coordenada) ficava colada no texto do cabeçalho.
    y -= 28;
  };
  desenharCabecalhoTabela();

  let semComprovante = 0;
  for (const d of relatorio.despesas) {
    if (y < MARGEM + 100) {
      pagina.drawLine({ start: { x: MARGEM, y }, end: { x: MARGEM + larg, y }, thickness: CAPA_BORDA_GROSSA, color: CAPA_PRETO });
      pagina = novaPaginaA4(doc);
      y = A4.h - MARGEM;
      desenharCabecalhoTabela();
    }
    const qtdComp = contagem.get(d.id) ?? 0;
    const cobrada = !TIPOS_SEM_NOTA.has(d.tipdes ?? 0);
    const faltando = qtdComp === 0 && cobrada;
    if (faltando) semComprovante += 1;
    pagina.drawText(formatarData(d.datemi), { x: col.data + 4, y, size: 9, font: fontes.normal, color: CAPA_PRETO });
    pagina.drawText(cortar(fontes.normal, d.tipdesLabel, 9, 104), { x: col.tipo, y, size: 9, font: fontes.normal, color: CAPA_CINZA_TEXTO });
    pagina.drawText(cortar(fontes.normal, d.desrdv ?? "—", 9, 142), { x: col.desc, y, size: 9, font: fontes.normal, color: CAPA_PRETO });
    const qtdTxt = String(d.qtdrdv ?? "—");
    pagina.drawText(qtdTxt, { x: col.qtd + 26 - fontes.normal.widthOfTextAtSize(qtdTxt, 9), y, size: 9, font: fontes.normal, color: CAPA_PRETO });
    const valTxt = formatarDinheiro(d.vlrtot);
    pagina.drawText(valTxt, { x: col.valor + 62 - fontes.normal.widthOfTextAtSize(valTxt, 9), y, size: 9, font: fontes.normal, color: CAPA_PRETO });
    pagina.drawText(qtdComp > 0 ? String(qtdComp) : faltando ? "sem comprovante" : "—", {
      x: col.comp,
      y,
      size: 9,
      font: faltando ? fontes.negrito : fontes.normal,
      color: faltando ? COR_ALERTA : qtdComp > 0 ? CAPA_PRETO : CAPA_CINZA_TEXTO,
    });
    y -= 8;
    pagina.drawLine({ start: { x: MARGEM, y }, end: { x: MARGEM + larg, y }, thickness: 0.4, color: CAPA_CINZA_LINHA });
    y -= 9;
  }
  if (relatorio.despesas.length === 0) {
    pagina.drawText(texto(fontes.normal, "Nenhuma despesa lançada nesta RAT."), { x: MARGEM, y, size: 10, font: fontes.normal, color: CAPA_CINZA_TEXTO });
    y -= 17;
  }
  pagina.drawLine({ start: { x: MARGEM, y: y + 9 }, end: { x: MARGEM + larg, y: y + 9 }, thickness: CAPA_BORDA_GROSSA, color: CAPA_PRETO });

  // Total + resumo por categoria — barra com borda preta em cima/embaixo pro total, igual ao
  // relatório de RDV; sem caixa colorida.
  if (y < MARGEM + 160) {
    pagina = novaPaginaA4(doc);
    y = A4.h - MARGEM;
  }
  // Régua de cima 16pt ACIMA do texto (não 6, que cortava o topo das letras maiúsculas em negrito
  // — bug real, visto no PDF) e a de baixo 10pt abaixo — clareza generosa dos dois lados, mesmo
  // espírito da barra "Valor Total da RDV" do relatório de RDV.
  y -= 20;
  pagina.drawLine({ start: { x: MARGEM, y }, end: { x: MARGEM + larg, y }, thickness: CAPA_BORDA_GROSSA, color: CAPA_PRETO });
  y -= 16;
  pagina.drawText(texto(fontes.negrito, "VALOR TOTAL DA RDV"), { x: MARGEM, y, size: 10.5, font: fontes.negrito, color: CAPA_PRETO });
  const totalTxt = formatarDinheiro(relatorio.total);
  pagina.drawText(totalTxt, { x: MARGEM + larg - fontes.negrito.widthOfTextAtSize(totalTxt, 12), y, size: 12, font: fontes.negrito, color: CAPA_PRETO });
  y -= 10;
  pagina.drawLine({ start: { x: MARGEM, y }, end: { x: MARGEM + larg, y }, thickness: CAPA_BORDA_GROSSA, color: CAPA_PRETO });
  y -= 24;

  pagina.drawText(texto(fontes.negrito, "RESUMO POR CATEGORIA"), { x: MARGEM, y, size: 8, font: fontes.negrito, color: CAPA_CINZA_TEXTO });
  y -= 16;
  for (const r of relatorio.resumoPorCategoria) {
    pagina.drawText(texto(fontes.normal, r.categoria), { x: MARGEM, y, size: 9.5, font: fontes.normal, color: CAPA_PRETO });
    const q = String(r.qtdrdv).padStart(2, "0");
    pagina.drawText(q, { x: col.qtd + 26 - fontes.normal.widthOfTextAtSize(q, 9.5), y, size: 9.5, font: fontes.normal, color: CAPA_CINZA_TEXTO });
    const v = formatarDinheiro(r.vlrtot);
    pagina.drawText(v, { x: col.valor + 62 - fontes.normal.widthOfTextAtSize(v, 9.5), y, size: 9.5, font: fontes.normal, color: CAPA_PRETO });
    y -= 15;
  }

  // Aviso "N sem comprovante" — não existe no relatório de RDV (que não fala de comprovante);
  // continua em vermelho, é alerta, não faz parte da paleta "papel oficial" do resto da capa.
  if (semComprovante > 0) {
    y -= 8;
    pagina.drawText(
      texto(fontes.negrito, `${semComprovante} ${semComprovante === 1 ? "despesa sem comprovante anexado" : "despesas sem comprovante anexado"}.`),
      { x: MARGEM, y, size: 10, font: fontes.negrito, color: COR_ALERTA }
    );
  }
}

// ---------- montagem ----------

export interface EntradaPdf {
  modo: ModoPdfComprovantes;
  relatorio: RelatorioParaPdf;
  comprovantes: ComprovanteParaPdf[];
  geradoPor: string;
}

export async function montarPdfComprovantes({ modo, relatorio, comprovantes, geradoPor }: EntradaPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const geradoEm = new Date();
  const fontes: Fontes = { normal: await doc.embedFont(StandardFonts.Helvetica), negrito: await doc.embedFont(StandardFonts.HelveticaBold) };
  const numrat = relatorio.rat.numrat != null ? String(relatorio.rat.numrat) : "";

  doc.setTitle(modo === "prestacao" ? `Prestação de contas — RAT ${numrat}` : `Comprovantes — RAT ${numrat}`);
  doc.setAuthor("CaxHub");
  doc.setProducer("CaxHub");
  doc.setCreationDate(geradoEm);

  const doPdfDaDespesa = new Map(relatorio.despesas.map((d) => [d.id, d]));
  const contagem = new Map<number, number>();
  for (const c of comprovantes) if (c.despesaId != null) contagem.set(c.despesaId, (contagem.get(c.despesaId) ?? 0) + 1);

  // Ordem: despesas na ordem do relatório (data, id), depois os sem despesa. Comprovante de
  // despesa que não está no relatório (ex.: deslocamento por rota zerado, que é omitido) entra
  // junto dos soltos, sem perder o arquivo.
  const ordenados: { c: ComprovanteParaPdf; despesa: DespesaParaPdf | null; n: number; de: number }[] = [];
  const porDespesa = (id: number) => comprovantes.filter((c) => c.despesaId === id);
  for (const d of relatorio.despesas) {
    const lista = porDespesa(d.id);
    lista.forEach((c, i) => ordenados.push({ c, despesa: d, n: i + 1, de: lista.length }));
  }
  const soltos = comprovantes.filter((c) => c.despesaId == null || !doPdfDaDespesa.has(c.despesaId));
  soltos.forEach((c, i) => ordenados.push({ c, despesa: null, n: i + 1, de: soltos.length }));

  if (modo === "prestacao") desenharCapa(doc, fontes, relatorio, contagem, geradoEm, geradoPor);

  for (const { c, despesa, n, de } of ordenados) {
    const titulo = despesa
      ? `Despesa ${despesa.id} · ${despesa.desrdv ?? despesa.tipdesLabel} · ${formatarDinheiro(despesa.vlrtot)} · ${formatarData(despesa.datemi)}`
      : "Comprovante sem despesa vinculada";
    const subtitulo = `Comprovante ${n} de ${de} · ${c.nomeArquivo}`;
    await adicionarComprovante(doc, fontes, c, modo, { titulo: texto(fontes.normal, titulo), subtitulo: texto(fontes.normal, subtitulo) });
  }

  // Rodapé numerado em todas as páginas (só no modo prestação) — depois de montar tudo, com o total.
  if (modo === "prestacao") {
    const total = doc.getPageCount();
    const rodape = `RAT ${numrat} · Gerado em ${formatarDataHora(geradoEm)} por ${geradoPor} · CaxHub`;
    doc.getPages().forEach((pagina, i) => {
      const { width } = pagina.getSize();
      const numero = `Página ${i + 1} de ${total}`;
      pagina.drawLine({ start: { x: MARGEM, y: ALTURA_RODAPE }, end: { x: width - MARGEM, y: ALTURA_RODAPE }, thickness: 0.4, color: COR_LINHA });
      pagina.drawText(cortar(fontes.normal, rodape, 8, width - MARGEM * 2 - 70), { x: MARGEM, y: ALTURA_RODAPE - 12, size: 8, font: fontes.normal, color: COR_MUDO });
      pagina.drawText(numero, { x: width - MARGEM - fontes.normal.widthOfTextAtSize(numero, 8), y: ALTURA_RODAPE - 12, size: 8, font: fontes.normal, color: COR_MUDO });
    });
  }
  return doc.save();
}
