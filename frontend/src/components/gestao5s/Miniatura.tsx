import { useBlobAutenticado } from "../../hooks/useBlobAutenticado";

interface MiniaturaProps {
  id: number;
  nome: string;
  onRemover?: () => void;
  onAbrir: (url: string) => void;
}

export function Miniatura({ id, nome, onRemover, onAbrir }: MiniaturaProps) {
  // As imagens do 5S só saem por rota autenticada — ver useBlobAutenticado.
  const url = useBlobAutenticado(`/api/5s/imagens/${id}`);
  return (
    <div className="relative h-20 w-20 flex-none overflow-hidden rounded-md border border-border bg-surface-2">
      {url ? (
        <button type="button" onClick={() => onAbrir(url)} className="h-full w-full" title={nome}>
          <img src={url} alt={nome} className="h-full w-full object-cover" />
        </button>
      ) : (
        <div className="h-full w-full animate-pulse" />
      )}
      {onRemover && (
        <button
          type="button"
          onClick={onRemover}
          aria-label={`Remover ${nome}`}
          className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-xs text-destructive shadow"
        >
          ✕
        </button>
      )}
    </div>
  );
}
