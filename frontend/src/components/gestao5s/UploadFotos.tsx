import axios from "axios";
import { useState } from "react";
import { Miniatura } from "./Miniatura";
import { classeBotaoSecundario } from "./campos";
import { mensagemDeErro } from "../../utils/gestao5s";
import type { ImagemRef } from "../../utils/gestao5s";
import { reduzirImagem } from "../../utils/reduzirImagem";
import { BotoesCameraGaleria } from "../ui/BotoesCameraGaleria";
import { useToast } from "../ui/Toast";

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
  const [enviando, setEnviando] = useState(false);

  async function enviar(arquivos: File[]) {
    setEnviando(true);
    try {
      for (const arquivo of arquivos) {
        const form = new FormData();
        form.append("arquivo", await reduzirImagem(arquivo));
        for (const [k, v] of Object.entries(campos ?? {})) form.append(k, v);
        await axios.post(urlUpload, form);
      }
      onAlterado();
    } catch (err) {
      mostrar(mensagemDeErro(err, "Falha ao enviar a foto"), "destructive");
    } finally {
      setEnviando(false);
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
        <BotoesCameraGaleria enviando={enviando} classeBotao={`${classeBotaoSecundario} min-h-11`} onSelecionar={(arquivos) => void enviar(arquivos)} />
      )}
    </div>
  );
}
