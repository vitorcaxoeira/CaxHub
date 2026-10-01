import axios from "axios";
import { ReactNode, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";

// Fotos do relatório impresso. As originais chegam a 10 MB e o navegador as embute inteiras no PDF,
// então cada uma é reduzida aqui (lado máximo + JPEG) antes de ser exibida. O provider conta quantas
// fotos o relatório tem e quantas já terminaram (ok ou falha) — o botão Imprimir espera as duas
// contagens fecharem, senão o PDF sairia com quadros vazios.

const LADO_MAXIMO = 800;
const QUALIDADE_JPEG = 0.75;

export interface ProgressoImagens {
  total: number;
  concluidas: number;
}

interface Ctx {
  registrar: () => () => void;
  concluir: () => void;
}

const ImagensCtx = createContext<Ctx | null>(null);

export function ImagensRelatorioProvider({ children, onProgresso }: { children: ReactNode; onProgresso: (p: ProgressoImagens) => void }) {
  const [progresso, setProgresso] = useState<ProgressoImagens>({ total: 0, concluidas: 0 });

  const registrar = useCallback(() => {
    setProgresso((p) => ({ ...p, total: p.total + 1 }));
    return () => setProgresso((p) => ({ ...p, total: p.total - 1 }));
  }, []);
  const concluir = useCallback(() => setProgresso((p) => ({ ...p, concluidas: p.concluidas + 1 })), []);

  // Layout effect: o Imprimir não pode enxergar `total = 0` num frame entre a montagem das fotos e o aviso.
  useLayoutEffect(() => onProgresso(progresso), [progresso, onProgresso]);

  const valor = useMemo(() => ({ registrar, concluir }), [registrar, concluir]);
  return <ImagensCtx.Provider value={valor}>{children}</ImagensCtx.Provider>;
}

// Busca autenticada (as fotos do 5S só saem por rota com token) e redução em canvas. Se o navegador
// não decodificar o formato (ex.: HEIC), devolve a original sem reduzir.
async function carregarReduzida(id: number): Promise<string> {
  const { data } = await axios.get<Blob>(`/api/5s/imagens/${id}`, { responseType: "blob" });
  try {
    const bitmap = await createImageBitmap(data);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sem canvas");
    ctx.fillStyle = "#fff"; // PNG com transparência não vira preto no JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const reduzida = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALIDADE_JPEG));
    return URL.createObjectURL(reduzida ?? data);
  } catch {
    return URL.createObjectURL(data);
  }
}

export function ImagemRelatorio({ id, nome }: { id: number; nome: string }) {
  const ctx = useContext(ImagensCtx);
  const [src, setSrc] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  // Layout effect: o total sobe antes do primeiro paint, então o Imprimir nunca habilita no vão
  // entre "detalhes carregados" e "fotos registradas".
  useLayoutEffect(() => ctx?.registrar(), [ctx]);

  useEffect(() => {
    let cancelado = false;
    let criada: string | null = null;
    carregarReduzida(id)
      .then((url) => {
        if (cancelado) return URL.revokeObjectURL(url);
        criada = url;
        setSrc(url);
      })
      .catch(() => !cancelado && setFalhou(true))
      .finally(() => !cancelado && ctx?.concluir());
    return () => {
      cancelado = true;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [id, ctx]);

  return (
    <div className="h-28 w-28 flex-none overflow-hidden rounded-md border border-border bg-surface-2 print:h-[42mm] print:w-[42mm] print:break-inside-avoid">
      {src ? (
        <img src={src} alt={nome} className="h-full w-full object-cover" />
      ) : (
        // `data-foto-pendente`: o Chromium do PDF só gera quando não resta nenhum (relatorioPdf.ts).
        <div
          data-foto-pendente={falhou ? undefined : ""}
          className={falhou ? "flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-muted" : "h-full w-full animate-pulse"}
        >
          {falhou ? "foto indisponível" : null}
        </div>
      )}
    </div>
  );
}

export function GradeFotos({ imagens }: { imagens: { id: number; nomeArquivo: string }[] }) {
  if (imagens.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {imagens.map((img) => (
        <ImagemRelatorio key={img.id} id={img.id} nome={img.nomeArquivo} />
      ))}
    </div>
  );
}
