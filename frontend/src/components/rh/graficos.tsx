import { ReactNode, useState } from "react";
import { cn } from "../../lib/cn";
import { fmtCompacto, fmtInt, fmtPct } from "./formato";
import { VazioRh } from "./blocos";

// Gráficos das telas de RH, em SVG/HTML puro (o projeto não tem biblioteca de gráfico) e com as
// cores do tema, claro e escuro. Todos aceitam dado vazio e mostram "Sem dados" em vez de um eixo
// vazio, e todos têm o valor exato ao alcance do mouse (tooltip) e na legenda.

export const PALETA = [
  "var(--primary)",
  "var(--warning)",
  "var(--destructive)",
  "color-mix(in srgb, var(--primary) 55%, var(--foreground))",
  "color-mix(in srgb, var(--warning) 50%, var(--surface))",
  "color-mix(in srgb, var(--destructive) 50%, var(--surface))",
  "color-mix(in srgb, var(--primary) 40%, var(--surface))",
  "var(--muted)",
];

export type CorSerie = "primary" | "warning" | "destructive" | "muted" | "foreground" | "success";

const COR: Record<CorSerie, string> = {
  primary: "var(--primary)",
  warning: "var(--warning)",
  destructive: "var(--destructive)",
  muted: "color-mix(in srgb, var(--muted) 55%, var(--surface))",
  foreground: "var(--foreground)",
  success: "var(--success)",
};

// ---------------------------------------------------------------------------------------------
// Barras horizontais: ranking, distribuição.
// ---------------------------------------------------------------------------------------------

export interface ItemBarra {
  rotulo: string;
  valor: number | null;
  /** Texto à direita da barra; padrão: o valor formatado. */
  texto?: string;
  /** Linha pequena sob o rótulo (ex.: "12 pessoas"). */
  detalhe?: string;
  cor?: CorSerie;
}

export function BarrasH({
  itens,
  formato = fmtInt,
  limite,
  vazio = "Sem dados no período.",
  maximo,
}: {
  itens: ItemBarra[];
  formato?: (v: number) => string;
  limite?: number;
  vazio?: string;
  maximo?: number;
}) {
  const lista = (limite ? itens.slice(0, limite) : itens).filter((i) => i.valor != null || i.texto);
  if (!lista.length) return <VazioRh>{vazio}</VazioRh>;
  const max = maximo ?? Math.max(...lista.map((i) => Math.abs(i.valor ?? 0)), 1);
  return (
    <ul className="space-y-2">
      {lista.map((i) => {
        const pct = Math.min(100, (Math.abs(i.valor ?? 0) / max) * 100);
        return (
          <li key={i.rotulo} className="grid grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-3 text-[12.5px]" title={`${i.rotulo}: ${i.texto ?? (i.valor == null ? "—" : formato(i.valor))}`}>
            <div className="min-w-0">
              <p className="truncate text-foreground">{i.rotulo}</p>
              {i.detalhe && <p className="truncate text-[11px] text-muted">{i.detalhe}</p>}
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: COR[i.cor ?? "primary"] }} />
            </div>
            <span className="min-w-14 text-right font-medium tabular-nums text-foreground">{i.texto ?? (i.valor == null ? "—" : formato(i.valor))}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// Rosca com legenda.
// ---------------------------------------------------------------------------------------------

export function Rosca({
  itens,
  centro,
  formato = fmtInt,
  vazio = "Sem dados no período.",
}: {
  itens: { rotulo: string; valor: number }[];
  centro?: { valor: string; rotulo: string };
  formato?: (v: number) => string;
  vazio?: string;
}) {
  const lista = itens.filter((i) => i.valor > 0);
  const total = lista.reduce((s, i) => s + i.valor, 0);
  const [destaque, setDestaque] = useState<number | null>(null);
  if (!lista.length) return <VazioRh>{vazio}</VazioRh>;

  const R = 15.9155; // circunferência 100
  let acumulado = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative h-40 w-40 flex-none">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img" aria-label="Distribuição">
          <circle cx="21" cy="21" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="6" />
          {lista.map((i, idx) => {
            const frac = (i.valor / total) * 100;
            const dash = `${Math.max(frac - (lista.length > 1 ? 0.6 : 0), 0.01)} ${100 - Math.max(frac - (lista.length > 1 ? 0.6 : 0), 0.01)}`;
            const offset = -acumulado;
            acumulado += frac;
            return (
              <circle
                key={i.rotulo}
                cx="21"
                cy="21"
                r={R}
                fill="none"
                strokeWidth={destaque === idx ? 7 : 6}
                strokeDasharray={dash}
                strokeDashoffset={offset}
                style={{ stroke: PALETA[idx % PALETA.length], transition: "stroke-width .15s" }}
                onMouseEnter={() => setDestaque(idx)}
                onMouseLeave={() => setDestaque(null)}
              >
                <title>{`${i.rotulo}: ${formato(i.valor)} (${fmtPct((i.valor / total) * 100)})`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-xl font-bold text-foreground">{destaque != null ? fmtPct((lista[destaque].valor / total) * 100) : (centro?.valor ?? formato(total))}</span>
          <span className="max-w-[6rem] text-[10.5px] leading-tight text-muted">{destaque != null ? lista[destaque].rotulo : (centro?.rotulo ?? "total")}</span>
        </div>
      </div>
      <ul className="min-w-[10rem] flex-1 space-y-1.5 text-[12.5px]">
        {lista.map((i, idx) => (
          <li
            key={i.rotulo}
            className={cn("flex items-center gap-2 rounded px-1", destaque === idx && "bg-surface-2")}
            onMouseEnter={() => setDestaque(idx)}
            onMouseLeave={() => setDestaque(null)}
          >
            <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: PALETA[idx % PALETA.length] }} />
            <span className="min-w-0 flex-1 truncate text-foreground" title={i.rotulo}>
              {i.rotulo}
            </span>
            <span className="tabular-nums text-muted">{formato(i.valor)}</span>
            <span className="w-12 text-right font-medium tabular-nums text-foreground">{fmtPct((i.valor / total) * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Colunas mensais (agrupadas ou empilhadas) com linhas opcionais em eixo próprio.
// ---------------------------------------------------------------------------------------------

export interface SerieColuna {
  nome: string;
  cor: CorSerie;
  /** "coluna" (padrão) ou "linha". */
  tipo?: "coluna" | "linha";
  /** Linhas usam eixo próprio à direita (ex.: percentual sobre colunas de quantidade). */
  eixoDireito?: boolean;
  formato?: (v: number) => string;
}

export interface PontoColuna {
  rotulo: string;
  valores: (number | null)[];
}

const L = 820;
const A = 250;
const M = { t: 18, r: 70, b: 30, l: 52 };

function escalaBonita(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const f = max / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

export function Colunas({
  pontos,
  series,
  empilhado = false,
  formato = fmtInt,
  formatoDireito = (v) => fmtPct(v),
  vazio = "Sem dados no período.",
  mostrarValores = true,
}: {
  pontos: PontoColuna[];
  series: SerieColuna[];
  empilhado?: boolean;
  formato?: (v: number) => string;
  formatoDireito?: (v: number) => string;
  vazio?: string;
  mostrarValores?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const colunas = series.map((s, i) => ({ s, i })).filter(({ s }) => (s.tipo ?? "coluna") === "coluna");
  const linhas = series.map((s, i) => ({ s, i })).filter(({ s }) => s.tipo === "linha");
  const temDado = pontos.some((p) => p.valores.some((v) => v != null && v !== 0));
  if (!pontos.length || !temDado) return <VazioRh>{vazio}</VazioRh>;

  const larg = L - M.l - M.r;
  const alt = A - M.t - M.b;
  const passo = larg / pontos.length;

  const somaPorPonto = (p: PontoColuna) => colunas.reduce((s, { i }) => s + Math.max(p.valores[i] ?? 0, 0), 0);
  const maxEsq = escalaBonita(Math.max(...pontos.map((p) => (empilhado ? somaPorPonto(p) : Math.max(...colunas.map(({ i }) => p.valores[i] ?? 0), 0))), 0.0001));
  const valoresDir = linhas.filter(({ s }) => s.eixoDireito).flatMap(({ i }) => pontos.map((p) => p.valores[i]).filter((v): v is number => v != null));
  // O eixo direito aceita valores negativos (variação % pode ser negativa): vai de -N a +M, e a linha de
  // zero dele é desenhada à parte quando fica acima da base do gráfico.
  const topoDir = valoresDir.length ? escalaBonita(Math.max(...valoresDir, 0.0001)) : 1;
  const minNeg = valoresDir.length ? Math.min(...valoresDir, 0) : 0;
  const baseDir = minNeg < 0 ? -escalaBonita(-minNeg) : 0;
  const maxDir = topoDir;
  const linhasNoDireito = linhas.some(({ s }) => s.eixoDireito);

  const yEsq = (v: number) => M.t + alt - (Math.max(v, 0) / maxEsq) * alt;
  const yDir = (v: number) => M.t + alt - ((v - baseDir) / (maxDir - baseDir)) * alt;
  const yLinha = (s: SerieColuna, v: number) => (s.eixoDireito ? yDir(v) : yEsq(v));

  const larguraGrupo = Math.min(passo * 0.7, 56);
  const larguraBarra = empilhado ? larguraGrupo : larguraGrupo / Math.max(colunas.length, 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  // Valor sobre a barra só quando cabe sem encavalar: 1 série, ou 2 séries com colunas largas.
  const cabeValor = mostrarValores && (colunas.length <= 1 ? passo >= 36 : colunas.length === 2 ? passo >= 92 : false);
  const pulaRotulo = Math.ceil(pontos.length / Math.max(Math.floor(larg / 52), 1));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={L - M.r} y1={M.t + alt - t * alt} y2={M.t + alt - t * alt} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={M.l - 6} y={M.t + alt - t * alt + 3.5} textAnchor="end" fontSize="10.5" fill="var(--muted)">
              {fmtCompacto(maxEsq * t)}
            </text>
            {linhasNoDireito && (
              <text x={L - M.r + 6} y={M.t + alt - t * alt + 3.5} textAnchor="start" fontSize="10.5" fill="var(--muted)">
                {formatoDireito(baseDir + (maxDir - baseDir) * t)}
              </text>
            )}
          </g>
        ))}

        {linhasNoDireito && baseDir < 0 && (
          <line x1={M.l} x2={L - M.r} y1={yDir(0)} y2={yDir(0)} stroke="var(--warning)" strokeOpacity="0.5" strokeDasharray="5 4" />
        )}

        {pontos.map((p, idx) => {
          const x0 = M.l + idx * passo + (passo - larguraGrupo) / 2;
          let acum = 0;
          return (
            <g key={p.rotulo + idx} onMouseEnter={() => setHover(idx)}>
              <rect x={M.l + idx * passo} y={M.t} width={passo} height={alt} fill={hover === idx ? "var(--surface-2)" : "transparent"} opacity={0.6} />
              {colunas.map(({ s, i }, k) => {
                const v = Math.max(p.valores[i] ?? 0, 0);
                if (v <= 0) return null;
                const topo = empilhado ? yEsq(acum + v) : yEsq(v);
                const h = empilhado ? yEsq(acum) - yEsq(acum + v) : yEsq(0) - yEsq(v);
                const x = empilhado ? x0 : x0 + k * larguraBarra;
                acum += v;
                return (
                  <g key={s.nome}>
                    <rect x={x + 0.5} y={topo} width={Math.max(larguraBarra - 1, 1)} height={Math.max(h, 0.5)} rx="2" style={{ fill: COR[s.cor] }} />
                    {cabeValor && !empilhado && colunas.length <= 2 && (
                      <text x={x + larguraBarra / 2} y={topo - 4} textAnchor="middle" fontSize="10" fill="var(--foreground)">
                        {(s.formato ?? formato)(v)}
                      </text>
                    )}
                  </g>
                );
              })}
              {cabeValor && empilhado && somaPorPonto(p) > 0 && (
                <text x={x0 + larguraGrupo / 2} y={yEsq(somaPorPonto(p)) - 4} textAnchor="middle" fontSize="10" fill="var(--foreground)">
                  {formato(somaPorPonto(p))}
                </text>
              )}
              {idx % pulaRotulo === 0 && (
                <text x={M.l + idx * passo + passo / 2} y={A - 10} textAnchor="middle" fontSize="10.5" fill="var(--muted)">
                  {p.rotulo}
                </text>
              )}
            </g>
          );
        })}

        {linhas.map(({ s, i }) => {
          const pts = pontos.map((p, idx) => ({ v: p.valores[i], x: M.l + idx * passo + passo / 2 })).filter((q): q is { v: number; x: number } => q.v != null);
          if (!pts.length) return null;
          return (
            <g key={s.nome}>
              <polyline points={pts.map((q) => `${q.x},${yLinha(s, q.v)}`).join(" ")} fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: COR[s.cor] }} />
              {pts.map((q) => (
                <circle key={q.x} cx={q.x} cy={yLinha(s, q.v)} r="3" style={{ fill: COR[s.cor] }} stroke="var(--surface)" strokeWidth="1.2" />
              ))}
            </g>
          );
        })}
      </svg>

      {hover != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border border-border bg-surface px-3 py-2 text-[12px] shadow-lg"
          style={{ left: `clamp(0px, calc(${((M.l + hover * passo + passo / 2) / L) * 100}% - 4.5rem), calc(100% - 9.5rem))` }}
        >
          <p className="mb-1 font-semibold text-foreground">{pontos[hover].rotulo}</p>
          {series.map((s, i) => {
            const v = pontos[hover].valores[i];
            const f = s.formato ?? (s.tipo === "linha" && s.eixoDireito ? formatoDireito : formato);
            return (
              <p key={s.nome} className="flex items-center justify-between gap-3 text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: COR[s.cor] }} />
                  {s.nome}
                </span>
                <span className="font-medium tabular-nums text-foreground">{v == null ? "—" : f(v)}</span>
              </p>
            );
          })}
        </div>
      )}

      <Legenda series={series} />
    </div>
  );
}

export function Legenda({ series }: { series: { nome: string; cor: CorSerie; tipo?: "coluna" | "linha" }[] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
      {series.map((s) => (
        <span key={s.nome} className="flex items-center gap-1.5">
          {s.tipo === "linha" ? <span className="h-0.5 w-3.5 rounded" style={{ background: COR[s.cor] }} /> : <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR[s.cor] }} />}
          {s.nome}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Matriz com cor por intensidade (coortes de retenção, calor por dia).
// ---------------------------------------------------------------------------------------------

export function MatrizCalor({
  colunas,
  linhas,
  formato = (v) => fmtPct(v, 0),
  /** Valor que vira a cor cheia (padrão 100, para percentuais). */
  maximo = 100,
  /** true: valor alto é ruim (vermelho); false: valor alto é bom (verde). */
  altoEhRuim = false,
  vazio = "Sem dados no período.",
}: {
  colunas: string[];
  linhas: { rotulo: string; detalhe?: string; celulas: (number | null)[] }[];
  formato?: (v: number) => string;
  maximo?: number;
  altoEhRuim?: boolean;
  vazio?: string;
}) {
  if (!linhas.length) return <VazioRh>{vazio}</VazioRh>;
  const cor = altoEhRuim ? "var(--destructive)" : "var(--primary)";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[12px]">
        <thead>
          <tr>
            <th />
            {colunas.map((c) => (
              <th key={c} className="px-1 pb-1 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo}>
              <td className="whitespace-nowrap pr-2 text-left text-foreground">
                {l.rotulo}
                {l.detalhe && <span className="ml-1.5 text-[11px] text-muted">{l.detalhe}</span>}
              </td>
              {l.celulas.map((v, i) => (
                <td
                  key={i}
                  className="min-w-14 rounded px-2 py-1.5 text-center font-medium tabular-nums"
                  style={v == null ? { background: "var(--surface-2)", color: "var(--muted)" } : { background: `color-mix(in srgb, ${cor} ${Math.round(Math.min(v / maximo, 1) * 80 + 8)}%, var(--surface))`, color: "var(--foreground)" }}
                  title={v == null ? "Coorte ainda não completou este horizonte" : formato(v)}
                >
                  {v == null ? "—" : formato(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Ponte (cascata) entre dois valores.
// ---------------------------------------------------------------------------------------------

export function Ponte({
  inicio,
  passos,
  fim,
  formato,
}: {
  inicio: { rotulo: string; valor: number };
  passos: { rotulo: string; valor: number }[];
  fim: { rotulo: string; valor: number };
  formato: (v: number) => string;
}) {
  const etapas: { rotulo: string; de: number; ate: number; tipo: "total" | "sobe" | "desce"; valor: number }[] = [{ rotulo: inicio.rotulo, de: 0, ate: inicio.valor, tipo: "total", valor: inicio.valor }];
  let corrente = inicio.valor;
  for (const p of passos) {
    etapas.push({ rotulo: p.rotulo, de: corrente, ate: corrente + p.valor, tipo: p.valor >= 0 ? "sobe" : "desce", valor: p.valor });
    corrente += p.valor;
  }
  etapas.push({ rotulo: fim.rotulo, de: 0, ate: fim.valor, tipo: "total", valor: fim.valor });

  const minV = Math.min(0, ...etapas.flatMap((e) => [e.de, e.ate]));
  const maxV = Math.max(...etapas.flatMap((e) => [e.de, e.ate]), 1);
  // Eixo começando perto do menor total deixa as variações visíveis (a variação é ~3% do total).
  const base = Math.max(minV, Math.min(inicio.valor, fim.valor, corrente) * 0.9);
  const faixa = Math.max(maxV - base, 1);
  const H = 190;
  const W = 560;
  const margem = 24;
  const passo = (W - margem * 2) / etapas.length;
  const y = (v: number) => H - 28 - ((Math.max(v, base) - base) / faixa) * (H - 56);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {etapas.map((e, i) => {
        const x = margem + i * passo + passo * 0.15;
        const w = passo * 0.7;
        const topo = Math.min(y(e.de), y(e.ate));
        const h = Math.max(Math.abs(y(e.de) - y(e.ate)), 2);
        const cor = e.tipo === "total" ? "var(--primary)" : e.tipo === "sobe" ? "var(--warning)" : "var(--success)";
        return (
          <g key={e.rotulo + i}>
            <rect x={x} y={topo} width={w} height={h} rx="2" style={{ fill: cor }}>
              <title>{`${e.rotulo}: ${formato(e.valor)}`}</title>
            </rect>
            <text x={x + w / 2} y={topo - 5} textAnchor="middle" fontSize="10.5" fill="var(--foreground)">
              {e.tipo === "total" ? formato(e.valor) : `${e.valor > 0 ? "+" : ""}${formato(e.valor)}`}
            </text>
            <text x={x + w / 2} y={H - 10} textAnchor="middle" fontSize="10.5" fill="var(--muted)">
              {e.rotulo}
            </text>
            {i < etapas.length - 1 && <line x1={x + w} x2={x + passo} y1={y(e.ate)} y2={y(e.ate)} stroke="var(--border)" strokeDasharray="2 3" />}
          </g>
        );
      })}
    </svg>
  );
}

export function GradeDePaineis({ children, colunas = 2 }: { children: ReactNode; colunas?: 1 | 2 | 3 }) {
  return <div className={cn("grid gap-5", colunas === 2 && "lg:grid-cols-2", colunas === 3 && "lg:grid-cols-3")}>{children}</div>;
}
