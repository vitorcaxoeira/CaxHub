const LADO_MAX = 1600;

interface OpcoesReducao {
  // Formato de saída. webp (padrão) é o do 5S; os comprovantes usam JPEG porque o PDF único da RAT
  // (backend/src/domain/pdfComprovantes.ts, pdf-lib) só embute JPEG e PNG.
  formato?: "image/webp" | "image/jpeg";
  qualidade?: number;
}

// Reduz a foto no cliente (lado maior ≤ 1600px) antes de enviar: foto de celular chega a vários MB
// e os limites do servidor são de 10–15 MB. Se o navegador não decodificar o arquivo (ex.: HEIC),
// envia o original e deixa o servidor decidir. Arquivo que não é imagem (PDF) passa intacto. Usado
// pelo 5S (UploadFotos) e pelos comprovantes das despesas de viagem.
export async function reduzirImagem(arquivo: File, { formato = "image/webp", qualidade = 0.82 }: OpcoesReducao = {}): Promise<File> {
  if (!arquivo.type.startsWith("image/")) return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    const ctx = canvas.getContext("2d");
    if (formato === "image/jpeg" && ctx) {
      // JPEG não tem transparência: sem fundo branco, PNG transparente ficaria preto.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, formato, qualidade));
    // Alguns navegadores ignoram formatos que não sabem gerar e devolvem PNG: aí manda o original.
    if (!blob || blob.type !== formato) return arquivo;
    const extensao = formato === "image/jpeg" ? ".jpg" : ".webp";
    return new File([blob], arquivo.name.replace(/\.[^.]+$/, "") + extensao, { type: formato });
  } catch {
    return arquivo;
  }
}
