import axios from "axios";
import { useRef, useState } from "react";
import { Miniatura } from "./Miniatura";
import { classeBotaoSecundario } from "./campos";
import { mensagemDeErro } from "../../utils/gestao5s";
import type { ImagemRef } from "../../utils/gestao5s";
import { useToast } from "../ui/Toast";

const LADO_MAX = 1600;

// Reduz a foto no cliente (lado maior ≤ 1600px, webp) antes de enviar: foto de celular chega a
// vários MB e o limite do servidor é 10 MB. Se o navegador não decodificar o arquivo (ex.: HEIC),
// envia o original e deixa o servidor decidir.
async function reduzir(arquivo: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob) return arquivo;
    return new File([blob], arquivo.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
  } catch {
    return arquivo;
  }
}

interface UploadFotosProps {
  imagens: ImagemRef[];
  // Rota POST que recebe o multipart ("arquivo") e campos extras.
  urlUpload: string;
  campos?: Record<string, string>;
  podeEditar: boolean;
  onAlterado: () => void;
  onAbrir: (url: string) => void;
}

export function UploadFotos({ imagens, urlUpload, campos, podeEditar, onAlterado, onAbrir }: UploadFotosProps) {
  const { mostrar } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    setEnviando(true);
    try {
      for (const arquivo of Array.from(lista)) {
        const form = new FormData();
        form.append("arquivo", await reduzir(arquivo));
        for (const [k, v] of Object.entries(campos ?? {})) form.append(k, v);
        await axios.post(urlUpload, form);
      }
      onAlterado();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Falha ao enviar a foto"), "destructive");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remover(id: number) {
    try {
      await axios.delete(`/api/5s/imagens/${id}`);
      onAlterado();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Falha ao remover a foto"), "destructive");
    }
  }

  if (!podeEditar && imagens.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {imagens.map((img) => (
        <Miniatura key={img.id} id={img.id} nome={img.nomeArquivo} onAbrir={onAbrir} onRemover={podeEditar ? () => remover(img.id) : undefined} />
      ))}
      {podeEditar && (
        <>
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => enviar(e.target.files)} />
          <button type="button" disabled={enviando} onClick={() => inputRef.current?.click()} className={`${classeBotaoSecundario} min-h-11`}>
            {enviando ? "Enviando…" : "📷 Foto"}
          </button>
        </>
      )}
    </div>
  );
}
