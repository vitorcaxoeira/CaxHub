import { useEffect, useRef, useState } from "react";

const classeBotaoPadrao =
  "min-h-11 rounded-md border border-border px-3.5 py-1.5 text-sm text-muted transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

interface BotoesCameraGaleriaProps {
  // `accept` da Galeria / do seletor no desktop. A Câmera é sempre `image/*`.
  accept?: string;
  rotuloDesktop?: string;
  rotuloEnviando?: string;
  enviando?: boolean;
  desabilitado?: boolean;
  classeBotao?: string;
  onSelecionar: (arquivos: File[]) => void;
}

// Botões de escolher foto/arquivo, com câmera no celular. Em aparelho de toque (celular/tablet)
// mostra "Câmera" e "Galeria" separados; no desktop o atributo `capture` é ignorado pelo
// navegador, então um botão de câmera lá só confundiria — fica um botão único abrindo o seletor
// de arquivos. Lido uma vez na montagem. Não precisa de HTTPS (diferente de getUserMedia).
// Usado pelo 5S (UploadFotos) e pelos comprovantes das despesas de viagem.
export function BotoesCameraGaleria({
  accept = "image/*",
  rotuloDesktop = "📷 Foto",
  rotuloEnviando = "Enviando…",
  enviando = false,
  desabilitado = false,
  classeBotao = classeBotaoPadrao,
  onSelecionar,
}: BotoesCameraGaleriaProps) {
  const galeriaRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [aparelhoDeToque, setAparelhoDeToque] = useState(false);
  useEffect(() => {
    setAparelhoDeToque(window.matchMedia?.("(pointer: coarse)").matches ?? false);
  }, []);

  function selecionar(lista: FileList | null) {
    const arquivos = lista ? Array.from(lista) : [];
    // Limpa os dois pra o mesmo arquivo poder ser escolhido de novo.
    if (galeriaRef.current) galeriaRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    if (arquivos.length > 0) onSelecionar(arquivos);
  }

  const travado = enviando || desabilitado;
  return (
    <>
      <input ref={galeriaRef} type="file" accept={accept} multiple hidden onChange={(e) => selecionar(e.target.files)} />
      {/* Sem `multiple` de propósito: no Android, com `multiple` o navegador esconde a câmera e
          abre só o seletor de arquivos. `capture="environment"` pede a câmera traseira. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => selecionar(e.target.files)} />
      {aparelhoDeToque ? (
        <>
          <button type="button" disabled={travado} onClick={() => cameraRef.current?.click()} className={classeBotao}>
            {enviando ? rotuloEnviando : "📷 Câmera"}
          </button>
          <button type="button" disabled={travado} onClick={() => galeriaRef.current?.click()} className={classeBotao}>
            🖼 Galeria
          </button>
        </>
      ) : (
        <button type="button" disabled={travado} onClick={() => galeriaRef.current?.click()} className={classeBotao}>
          {enviando ? rotuloEnviando : rotuloDesktop}
        </button>
      )}
    </>
  );
}
