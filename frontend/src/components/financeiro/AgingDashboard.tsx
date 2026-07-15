type Tone = "success" | "warning" | "destructive" | "neutral";

interface Kpi {
  label: string;
  value: string;
  sub: string;
  tone: Tone;
}

interface Bucket {
  key: string;
  label: string;
  pct: number;
  valor: string;
  tone: Tone;
}

interface AgingDashboardProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  dataLabel?: string;
  kpis: Kpi[];
  buckets: Bucket[];
  activeBucket?: string | null;
  onBucketClick?: (key: string) => void;
}

const toneText: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  neutral: "text-foreground",
};

const toneBg: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-muted",
};

export function AgingDashboard({
  eyebrow,
  title,
  subtitle,
  dataLabel,
  kpis,
  buckets,
  activeBucket,
  onBucketClick,
}: AgingDashboardProps) {
  return (
    <div>
      {title && (
        <header className="mb-6 border-b border-border pb-5">
          {eyebrow && <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">{eyebrow}</p>}
          <h1 className="mt-1 font-display text-2xl font-bold text-foreground">{title}</h1>
          {subtitle && <p className="mt-2 max-w-[60ch] text-sm text-muted">{subtitle}</p>}
        </header>
      )}

      <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">{kpi.label}</p>
            <span className={`block font-mono text-2xl font-semibold tabular-nums ${toneText[kpi.tone]}`}>
              {kpi.value}
            </span>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span className={`h-1.5 w-1.5 flex-none rounded-full ${toneBg[kpi.tone]}`} />
              {kpi.sub}
            </p>
          </div>
        ))}
      </div>

      {buckets.length > 0 && (
        <section className="mb-6 rounded-lg border border-border bg-surface p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{dataLabel}</p>
            {activeBucket && (
              <button
                onClick={() => onBucketClick?.(activeBucket)}
                className="font-mono text-[10.5px] uppercase tracking-wide text-muted underline hover:text-foreground"
              >
                limpar filtro
              </button>
            )}
          </div>
          <div className="mb-4 flex h-8 gap-0.5 overflow-hidden rounded-md" role="img" aria-label={dataLabel}>
            {buckets.map((bucket) => (
              <button
                key={bucket.key}
                onClick={() => onBucketClick?.(bucket.key)}
                className={`${toneBg[bucket.tone]} transition-transform hover:scale-y-105 ${
                  activeBucket && activeBucket !== bucket.key ? "opacity-40" : ""
                }`}
                style={{ width: `${bucket.pct}%` }}
                title={`${bucket.label} — R$ ${bucket.valor} (clique para filtrar a lista)`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-6">
            {buckets.map((bucket) => (
              <button
                key={bucket.key}
                onClick={() => onBucketClick?.(bucket.key)}
                className={`flex items-baseline gap-2 text-left ${
                  activeBucket && activeBucket !== bucket.key ? "opacity-40" : ""
                }`}
              >
                <span className={`h-6 w-[3px] flex-none self-center rounded-sm ${toneBg[bucket.tone]}`} />
                <span>
                  <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
                    R$ {bucket.valor}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-muted">
                    {bucket.label} · {bucket.pct}%
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
