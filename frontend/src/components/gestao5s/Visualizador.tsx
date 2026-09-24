// Lightbox simples para uma foto já carregada (objectURL).
export function Visualizador({ url, onFechar }: { url: string | null; onFechar: () => void }) {
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={onFechar} role="dialog" aria-modal="true">
      <img src={url} alt="Foto ampliada" className="max-h-full max-w-full rounded-md object-contain" />
      <button type="button" onClick={onFechar} aria-label="Fechar" className="absolute right-4 top-4 rounded-full bg-background/90 px-3 py-1.5 text-sm text-foreground">
        ✕
      </button>
    </div>
  );
}
