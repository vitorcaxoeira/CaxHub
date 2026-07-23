import { formatHoras } from "../../utils/horas";

export type KpiTone = "destructive" | "warning" | "success" | "primary" | "neutral";

export const kpiToneClasses: Record<KpiTone, { texto: string; barra: string; borda: string }> = {
  destructive: { texto: "text-destructive", barra: "bg-destructive", borda: "border-destructive" },
  warning: { texto: "text-warning", barra: "bg-warning", borda: "border-warning" },
  success: { texto: "text-success", barra: "bg-success", borda: "border-success" },
  primary: { texto: "text-primary", barra: "bg-primary", borda: "border-primary" },
  neutral: { texto: "text-foreground", barra: "bg-muted", borda: "border-border" },
};

export function KpiIcone({ tone }: { tone: KpiTone }) {
  const paths: Record<KpiTone, JSX.Element> = {
    destructive: (
      <>
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="12.5" />
        <circle cx="12" cy="16" r="0.5" fill="currentColor" />
      </>
    ),
    warning: (
      <>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 14" />
      </>
    ),
    success: (
      <>
        <circle cx="12" cy="12" r="9" />
        <polyline points="8 12.5 11 15.5 16 9" />
      </>
    ),
    primary: (
      <>
        <circle cx="8" cy="8" r="2.5" />
        <circle cx="16" cy="8" r="2.5" />
        <path d="M3.5 18c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
        <path d="M11.5 18c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      </>
    ),
    neutral: (
      <>
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </>
    ),
  };
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths[tone]}
    </svg>
  );
}

export interface KpiCardProps {
  label: string;
  tone: KpiTone;
  quantidade: number;
  total: number;
  /** Minutos previstos/alocados — omitir junto com `horasLabel` quando `rodape` for usado. */
  horas?: number;
  horasLabel?: string;
  /** Sobrescreve o número grande do card (ex.: "82.3%" no lugar de uma contagem). */
  valor?: string;
  /** Sobrescreve a linha inferior inteira (ex.: SLA, que não tem horas, só uma amostra). */
  rodape?: string;
  ativo?: boolean;
  onClick?: () => void;
}

export function KpiCard({ label, tone, quantidade, total, horas, horasLabel, valor, rodape, ativo, onClick }: KpiCardProps) {
  const cores = kpiToneClasses[tone];
  const pct = total > 0 ? Math.round((quantidade / total) * 100) : 0;
  const conteudo = (
    <>
      <p className={`mb-2 flex items-center gap-1.5 text-[11.5px] ${ativo ? cores.texto : "text-muted"}`}>
        <KpiIcone tone={tone} />
        {label}
      </p>
      <p className="flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{valor ?? quantidade}</span>
        {valor === undefined && (
          <span className="font-mono text-[12px] tabular-nums text-muted">
            / {total} · {pct}%
          </span>
        )}
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted/20">
        <div className={`h-full rounded-full ${cores.barra}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-2 font-mono text-[11px] ${cores.texto}`}>{rodape ?? `${formatHoras((horas ?? 0) / 60)} ${horasLabel ?? ""}`}</p>
    </>
  );

  if (!onClick) {
    return <div className={`rounded-lg border bg-surface p-5 text-left ${ativo ? cores.borda : "border-border"}`}>{conteudo}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border bg-surface p-5 text-left transition hover:bg-surface-2 ${ativo ? cores.borda : "border-border"}`}
    >
      {conteudo}
    </button>
  );
}
