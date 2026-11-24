import { useState } from "react";

export interface SerieLinha {
  nome: string;
  cor: string;
  valores: Array<number | null>;
}

interface LinhasMultiSerieProps {
  titulo: string;
  rotulos: string[];
  series: SerieLinha[];
  descricao?: string;
}

// Paleta categórica que funciona nos dois temas (contraste ok em fundo claro e escuro).
export const CORES_SERIE = ["#4C78A8", "#F58518", "#54A24B", "#B279A2", "#E45756", "#72B7B2", "#EECA3B", "#9D755D"];

const W = 640;
const H = 240;
const ML = 40;
const MR = 12;
const MT = 12;
const MB = 28;

// Evolução em linhas (0–100%). Ponto sem dado interrompe a linha em vez de cair pra zero.
export function LinhasMultiSerie({ titulo, rotulos, series, descricao }: LinhasMultiSerieProps) {
  const [foco, setFoco] = useState<number | null>(null);
  const n = rotulos.length;
  const x = (i: number) => ML + (n <= 1 ? (W - ML - MR) / 2 : (i * (W - ML - MR)) / (n - 1));
  const y = (v: number) => MT + (1 - v / 100) * (H - MT - MB);

  function caminho(valores: Array<number | null>): string {
    let d = "";
    let aberto = false;
    valores.forEach((v, i) => {
      if (v == null) {
        aberto = false;
        return;
      }
      d += `${aberto ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      aberto = true;
    });
    return d.trim();
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</p>
        {descricao && <p className="text-[11px] text-muted">{descricao}</p>}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={titulo}>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={ML} x2={W - MR} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={ML - 6} y={y(t) + 3} textAnchor="end" className="fill-muted" fontSize={10}>
              {t}%
            </text>
          </g>
        ))}
        {rotulos.map((r, i) => (
          <text key={r} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted" fontSize={10}>
            {r}
          </text>
        ))}
        {series.map((s, si) => (
          <g key={s.nome} opacity={foco == null || foco === si ? 1 : 0.2}>
            <path d={caminho(s.valores)} fill="none" stroke={s.cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.valores.map((v, i) =>
              v == null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill={s.cor}>
                  <title>{`${s.nome} · ${rotulos[i]}: ${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</title>
                </circle>
              )
            )}
          </g>
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s, si) => (
          <button
            key={s.nome}
            type="button"
            onMouseEnter={() => setFoco(si)}
            onMouseLeave={() => setFoco(null)}
            onFocus={() => setFoco(si)}
            onBlur={() => setFoco(null)}
            className="flex items-center gap-1.5 text-xs text-foreground"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.cor }} />
            {s.nome}
          </button>
        ))}
        {series.length === 0 && <p className="text-sm text-muted">Sem dados para os filtros atuais.</p>}
      </div>
    </section>
  );
}
