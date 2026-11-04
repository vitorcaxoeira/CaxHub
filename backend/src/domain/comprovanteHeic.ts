import fs from "fs/promises";
import path from "path";

// Comprovante HEIC/HEIF (foto do iPhone) nas despesas de viagem da RAT (04/11/2026, pedido do Vitor).
//
// Dois problemas que isto resolve:
// 1. Anexar: no Windows (Chrome/Edge), o navegador costuma mandar o .heic SEM tipo ("" ou application/octet-stream), e o filtro do upload,
//    que só olhava o tipo, recusava com "Tipo de arquivo não permitido". Agora a extensão .heic/.heif também vale.
// 2. Usar: Chrome/Edge não desenham HEIC e o PDF único da RAT (domain/pdfComprovantes.ts) só embute JPEG e PNG. Por isso o arquivo é
//    convertido para JPEG no servidor, na hora do upload; se a conversão falhar (variante não suportada, arquivo corrompido), o HEIC original
//    fica guardado como está (anexado, baixável, só não aparece como imagem nem entra no PDF, como antes).

// eslint-disable-next-line @typescript-eslint/no-var-requires
const heicConvert: (opcoes: { buffer: Buffer; format: "JPEG" | "PNG"; quality?: number }) => Promise<ArrayBuffer | Buffer> = require("heic-convert");

export const EXTENSOES_HEIC = [".heic", ".heif"];
const MIMES_HEIC = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
/** Tipo que o navegador manda quando não reconhece o arquivo. */
const MIMES_SEM_TIPO = new Set(["", "application/octet-stream"]);

/** É HEIC/HEIF? Pelo tipo, ou pela extensão quando o navegador não informou o tipo. */
export function ehHeic(nomeArquivo: string, mimeType: string): boolean {
  if (MIMES_HEIC.has(mimeType)) return true;
  return EXTENSOES_HEIC.includes(path.extname(nomeArquivo).toLowerCase()) && MIMES_SEM_TIPO.has(mimeType);
}

/** O arquivo recebido pelo multer, só o que importa aqui. */
export interface ArquivoRecebido {
  path: string;
  filename: string;
  originalname: string;
  size: number;
  mimetype: string;
}

/**
 * Se o arquivo é HEIC, converte para JPEG no mesmo diretório e atualiza `arquivo` (caminho, nome, tamanho, tipo; o nome original troca a
 * extensão para .jpg). Se a conversão falhar, mantém o HEIC e só acerta o tipo para image/heic. Devolve se converteu.
 */
export async function converterHeicSeNecessario(arquivo: ArquivoRecebido): Promise<boolean> {
  if (!ehHeic(arquivo.originalname, arquivo.mimetype)) return false;
  try {
    const entrada = await fs.readFile(arquivo.path);
    const convertido = await heicConvert({ buffer: entrada, format: "JPEG", quality: 0.85 });
    const saida = Buffer.isBuffer(convertido) ? convertido : Buffer.from(new Uint8Array(convertido));
    const novoNome = `${path.basename(arquivo.filename, path.extname(arquivo.filename))}.jpg`;
    const novoCaminho = path.join(path.dirname(arquivo.path), novoNome);
    await fs.writeFile(novoCaminho, saida);
    await fs.unlink(arquivo.path).catch(() => undefined);
    arquivo.path = novoCaminho;
    arquivo.filename = novoNome;
    arquivo.size = saida.length;
    arquivo.mimetype = "image/jpeg";
    arquivo.originalname = `${path.basename(arquivo.originalname, path.extname(arquivo.originalname))}.jpg`;
    return true;
  } catch (erro) {
    console.error("[comprovantes] conversão HEIC→JPEG falhou, guardando o HEIC original:", erro instanceof Error ? erro.message : erro);
    if (MIMES_SEM_TIPO.has(arquivo.mimetype)) arquivo.mimetype = path.extname(arquivo.originalname).toLowerCase() === ".heif" ? "image/heif" : "image/heic";
    return false;
  }
}
