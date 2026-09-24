import type { Tendencia } from "../../utils/gestao5s";

const CONF = {
  melhora: { simbolo: "▲", classe: "text-success", texto: "Melhora" },
  queda: { simbolo: "▼", classe: "text-destructive", texto: "Queda" },
  estavel: { simbolo: "▬", classe: "text-muted", texto: "Estável" },
} as const;

export function TendenciaSeta({ tendencia, comTexto = false }: { tendencia: Tendencia; comTexto?: boolean }) {
  if (!tendencia) return <span className="text-muted">—</span>;
  const c = CONF[tendencia];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${c.classe}`} title={c.texto}>
      <span aria-hidden>{c.simbolo}</span>
      {comTexto ? c.texto : <span className="sr-only">{c.texto}</span>}
    </span>
  );
}
