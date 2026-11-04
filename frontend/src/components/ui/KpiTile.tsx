import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Skeleton } from "./Skeleton";

// No CaxHub este bloco está copiado literalmente em seis telas (ContasReceber, Recebimentos,
// Inadimplencia, Clientes, Historico e ExecutivaTab), cada uma com sua própria cópia dos mapas
// `toneText`/`toneBg`. Aqui ele é um componente só — mudar o visual do KPI passa a ser uma
// edição, não seis.
//
// Não confundir com o `KpiCard` do CaxHub, que é outra coisa: aquele tem ícone, barra de
// progresso e formatação de horas de proposta (USU_QtdHor), e não veio para este projeto.

export type KpiTone = "success" | "warning" | "destructive" | "neutral";

const toneText: Record<KpiTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  neutral: "text-foreground",
};

const toneBg: Record<KpiTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-muted",
};

export interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  /**
   * Omitir é significativo, não é o mesmo que "neutral": as telas do CaxHub vêm em duas
   * variantes, e ambas continuam existindo aqui.
   *
   *   sem `tone`  -> valor em text-foreground e legenda sem marcador (Recebimentos,
   *                  Clientes, Historico)
   *   com `tone`  -> valor colorido e bolinha da mesma cor antes da legenda
   *                  (Inadimplencia, ExecutivaTab)
   */
  tone?: KpiTone | string;
  /** Com `onClick` o tile vira botão (foco, hover). Sem ele continua sendo um bloco estático, como sempre. */
  onClick?: () => void;
  /** Tile clicável atualmente selecionado (anel de destaque + aria-pressed). */
  ativo?: boolean;
  /** Informação de apoio no canto superior direito, na linha do rótulo (ex.: contadores). */
  canto?: ReactNode;
  /** Texto do title do tile (explicação ao passar o mouse). */
  title?: string;
}

export function KpiTile({ label, value, sub, tone, onClick, ativo, canto, title }: KpiTileProps) {
  // `tone` chega como string das telas — os cards são montados em arrays literais, sem
  // anotação de tipo. Valor fora do conjunto cai em "neutral" em vez de quebrar o className.
  const t: KpiTone | undefined =
    tone === undefined
      ? undefined
      : (["success", "warning", "destructive", "neutral"] as const).includes(tone as KpiTone)
        ? (tone as KpiTone)
        : "neutral";

  // Atenção e crítico não dependem só da cor (03/11/2026): o rótulo ganha o ícone de alerta.
  const alerta = t === "warning" || t === "destructive";
  const rotulo = (
    <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
      {alerta && <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" className={`shrink-0 ${toneText[t!]}`} />}
      {label}
    </p>
  );
  const conteudo = (
    <>
      {canto ? (
        <div className="mb-2 flex items-start justify-between gap-2">
          {rotulo}
          <span className="shrink-0 text-right text-[11px] leading-tight text-muted">{canto}</span>
        </div>
      ) : (
        <div className="mb-2">{rotulo}</div>
      )}
      <span className={`block text-[26px] font-semibold leading-tight tracking-tight tabular-nums ${t ? toneText[t] : "text-foreground"}`}>
        {value}
      </span>
      {sub && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
          {t && <span className={`h-1.5 w-1.5 flex-none rounded-full ${toneBg[t]}`} />}
          {sub}
        </p>
      )}
    </>
  );

  if (!onClick)
    return (
      <div className="rounded-lg border border-border bg-surface p-5" title={title}>
        {conteudo}
      </div>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={!!ativo}
      className={`w-full rounded-lg border bg-surface p-5 text-left transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        ativo ? "border-primary ring-2 ring-primary/40" : "border-border"
      }`}
    >
      {conteudo}
    </button>
  );
}

/** Placeholder do KpiTile durante o carregamento — mesma moldura, para a grade não pular. */
export function KpiTileSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <Skeleton className="mb-2 h-3.5 w-32" />
      <Skeleton className="h-7 w-20" />
      <Skeleton className="mt-2 h-3 w-28" />
    </div>
  );
}
