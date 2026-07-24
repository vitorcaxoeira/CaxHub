export interface AreaPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Recorta `area` (em pixels da imagem original, vindo do onCropComplete do react-easy-crop)
// e redimensiona pro quadrado final via canvas — mantém a etapa de reencode client-side
// (o backend só valida magic bytes, não reprocessa a imagem, ver backend/src/routes/perfil.ts).
export async function recortarERedimensionar(imageSrc: string, area: AreaPixels, tamanhoFinal = 256): Promise<Blob> {
  const img = await carregarImagem(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = tamanhoFinal;
  canvas.height = tamanhoFinal;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível neste navegador");

  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, tamanhoFinal, tamanhoFinal);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar imagem"))),
      "image/webp",
      0.9
    );
  });
}
