export interface EficienciaComercial {
  winRatePct: number | null;
  ganhas: number;
  perdidas: number;
  rejeicaoPct: number;
  cancelamentoPct: number;
  cicloMedioDias: number | null;
  cicloMedianaDias: number | null;
  cicloQtdValidas: number;
  cicloQtdExcluidas: number;
  preparoMedioDias: number | null;
  preparoMedianaDias: number | null;
  preparoQtdValidas: number;
  preparoQtdExcluidas: number;
  valorGanho: number;
  valorPerdido: number;
}

interface EficienciaComercialCardsProps {
  dados: EficienciaComercial;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtDias = (v: number | null) => (v === null ? "—" : `${Math.round(v)} dias`);

const toneText: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  neutral: "text-foreground",
};
const toneBg: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-muted",
};

function toneWinRate(pct: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 60) return "success";
  if (pct >= 40) return "warning";
  return "destructive";
}

// Fórmulas (documentado pra auditoria — ver também backend/src/routes/projetos.ts):
//  - Win Rate = ganhas / (ganhas + perdidas), no período filtrado.
//  - Ciclo Médio = média de (datret - datenv), decididas com ambas as datas.
//  - Tempo de Preparação = média de (datenv - datpro), todas exceto Levantamento Interno.
export function EficienciaComercialCards({ dados }: EficienciaComercialCardsProps) {
  const cards = [
    {
      label: "Win Rate",
      value: dados.winRatePct === null ? "—" : fmtPct(dados.winRatePct),
      sub: `${dados.ganhas.toLocaleString("pt-BR")} ganhas vs. ${dados.perdidas.toLocaleString("pt-BR")} decididas`,
      tone: toneWinRate(dados.winRatePct),
    },
    {
      label: "Taxa de Rejeição",
      value: fmtPct(dados.rejeicaoPct),
      sub: `${fmtPct(dados.cancelamentoPct)} canceladas`,
      tone: "neutral" as const,
    },
    {
      label: "Ciclo Médio de Fechamento",
      value: fmtDias(dados.cicloMedioDias),
      sub: `mediana ${fmtDias(dados.cicloMedianaDias)} · ${dados.cicloQtdExcluidas.toLocaleString("pt-BR")} sem data excluídas`,
      tone: "neutral" as const,
    },
    {
      label: "Tempo Médio de Preparação",
      value: fmtDias(dados.preparoMedioDias),
      sub: `mediana ${fmtDias(dados.preparoMedianaDias)} · ${dados.preparoQtdExcluidas.toLocaleString("pt-BR")} sem data excluídas`,
      tone: "neutral" as const,
    },
    {
      label: "Valor Ganho × Perdido",
      value: `${fmtMoney(dados.valorGanho)} ganhos`,
      sub: `${fmtMoney(dados.valorPerdido)} perdidos`,
      tone: "neutral" as const,
    },
  ];

  return (
    <section className="mb-6">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">Eficiência Comercial</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">{card.label}</p>
            <span className={`block font-mono text-2xl font-semibold tabular-nums ${toneText[card.tone]}`}>{card.value}</span>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span className={`h-1.5 w-1.5 flex-none rounded-full ${toneBg[card.tone]}`} />
              {card.sub}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
