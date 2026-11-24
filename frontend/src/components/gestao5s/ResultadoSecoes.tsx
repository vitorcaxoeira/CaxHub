import { cn } from "../../lib/cn";
import { CELULA_TOM, PorSenso, SENSOS, Tendencia, TipoArea, formatarPerc, rotuloMes, tomDaNota } from "../../utils/gestao5s";
import { TendenciaSeta } from "./TendenciaSeta";

// Seções do "Resultado geral 5S" (KPIs, ranking, desempenho por senso, evolução mensal) usadas
// pela tela (Dashboard5S) e pelo relatório impresso (RelatorioResultado5S) — mesma marcação nos
// dois, então o que se imprime é o que se vê na tela.

export interface MesBloco {
  mes: string;
  quantidade?: number;
  geral: number | null;
  porSenso: PorSenso;
}

export interface AreaResultado {
  areaId: number;
  nome: string;
  acumulado?: boolean;
  avaliacoes: number;
  geral: number | null;
  porSenso: PorSenso;
  meses: MesBloco[];
  tendencia: Tendencia;
}

export interface DashboardResultado {
  tipo: TipoArea;
  de: string;
  ate: string;
  meses: string[];
  ranking: { posicao: number; areaId: number; nome: string; acumulado?: boolean; geral: number | null; tendencia: Tendencia }[];
  areas: AreaResultado[];
  empresa: { geral: number | null; porSenso: PorSenso; meses: MesBloco[]; tendencia: Tendencia };
}

const MEDALHA = ["🥇", "🥈", "🥉"];

export function Celula({ valor, negrito = false, casas = 2 }: { valor: number | null; negrito?: boolean; casas?: number }) {
  return (
    <span className={cn("inline-block min-w-14 rounded px-1.5 print:min-w-12 print:px-1 py-0.5 text-center font-mono text-xs tabular-nums", CELULA_TOM[tomDaNota(valor)], negrito && "font-bold")}>
      {formatarPerc(valor, casas)}
    </span>
  );
}

function Kpi({ rotulo, valor, rodape, tom }: { rotulo: string; valor: string; rodape?: React.ReactNode; tom?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{rotulo}</p>
      <p className={cn("mt-1 font-display text-2xl font-bold tabular-nums", tom ?? "text-foreground")}>{valor}</p>
      {rodape && <div className="mt-1 text-[12px] text-muted">{rodape}</div>}
    </div>
  );
}

export function KpisResultado({ dados }: { dados: DashboardResultado }) {
  const { tipo } = dados;
  const melhor = dados.ranking[0];
  const pior = dados.ranking.length > 1 ? dados.ranking[dados.ranking.length - 1] : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
      <Kpi
        rotulo={tipo === "setor" ? "Geral da empresa" : "Geral dos ambientes"}
        valor={formatarPerc(dados.empresa.geral)}
        tom={CELULA_TOM[tomDaNota(dados.empresa.geral)].split(" ")[1]}
        rodape={<TendenciaSeta tendencia={dados.empresa.tendencia} comTexto />}
      />
      <Kpi rotulo="Melhor resultado" valor={formatarPerc(melhor?.geral ?? null)} rodape={melhor?.nome} />
      <Kpi rotulo="Menor resultado" valor={pior ? formatarPerc(pior.geral) : "—"} rodape={pior?.nome ?? "—"} />
      <Kpi rotulo="Avaliações no período" valor={String(dados.areas.reduce((a, x) => a + x.avaliacoes, 0))} rodape={`${dados.areas.length} ${tipo === "setor" ? "setor(es)" : "ambiente(s)"}`} />
    </div>
  );
}

export function RankingResultado({ dados }: { dados: DashboardResultado }) {
  return (
    <section className="break-inside-avoid rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">🏆 Ranking por {dados.tipo === "setor" ? "área" : "ambiente"}</p>
      <ol className="space-y-3">
        {dados.ranking.map((r) => (
          <li key={r.areaId}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-sm text-foreground">
                <span className="mr-2 inline-block w-7 font-mono text-xs text-muted">{MEDALHA[r.posicao - 1] ?? `${r.posicao}º`}</span>
                {r.nome}
                {r.acumulado && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" title="Soma das respostas dos ambientes vinculados">acumulado</span>}
              </span>
              <span className="flex flex-none items-center gap-2">
                <TendenciaSeta tendencia={r.tendencia} />
                <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatarPerc(r.geral)}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(2, r.geral ?? 0)}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DesempenhoPorSenso({ dados }: { dados: DashboardResultado }) {
  const { tipo } = dados;
  return (
    <section className="break-inside-avoid overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <p className="px-4 pt-4 font-mono text-[10px] uppercase tracking-widest text-muted sm:px-6 sm:pt-6">Desempenho por senso</p>
      <div className="overflow-x-auto p-2 sm:p-4 print:overflow-visible print:p-2">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
              <th className="px-3 py-2 print:px-2">{tipo === "setor" ? "Área" : "Ambiente"}</th>
              {SENSOS.map((s) => (
                <th key={s.chave} className="px-2 py-2 text-center print:px-1" title={s.rotulo}>
                  {s.curto}
                </th>
              ))}
              <th className="px-2 py-2 text-center print:px-1">Geral</th>
            </tr>
          </thead>
          <tbody>
            {dados.areas
              .slice()
              .sort((a, b) => (b.geral ?? -1) - (a.geral ?? -1))
              .map((a) => (
                <tr key={a.areaId} className="border-t border-border/60">
                  <td className="px-3 py-2 text-sm text-foreground print:px-2 sm:whitespace-nowrap print:whitespace-normal">
                    {a.nome}
                    {a.acumulado && <span className="ml-2 text-[10px] text-primary">acumulado</span>}
                  </td>
                  {SENSOS.map((s) => (
                    <td key={s.chave} className="px-2 py-2 text-center print:px-1">
                      <Celula valor={a.porSenso[s.chave]} />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center print:px-1">
                    <Celula valor={a.geral} negrito />
                  </td>
                </tr>
              ))}
            <tr className="border-t-2 border-border bg-surface-2">
              <td className="px-3 py-2 text-sm font-semibold text-foreground print:px-2">{tipo === "setor" ? "Média da empresa" : "Média geral"}</td>
              {SENSOS.map((s) => (
                <td key={s.chave} className="px-2 py-2 text-center print:px-1">
                  <Celula valor={dados.empresa.porSenso[s.chave]} />
                </td>
              ))}
              <td className="px-2 py-2 text-center print:px-1">
                <Celula valor={dados.empresa.geral} negrito />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EvolucaoMensalTabela({ dados }: { dados: DashboardResultado }) {
  return (
    <section className="break-inside-avoid overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <p className="px-4 pt-4 font-mono text-[10px] uppercase tracking-widest text-muted sm:px-6 sm:pt-6">Evolução mensal (%)</p>
      <div className="overflow-x-auto p-2 sm:p-4 print:overflow-visible print:p-2">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
              <th className="px-3 py-2 print:px-2">{dados.tipo === "setor" ? "Área" : "Ambiente"}</th>
              {dados.meses.map((m) => (
                <th key={m} className="px-2 py-2 text-center print:px-1">
                  {rotuloMes(m)}
                </th>
              ))}
              <th className="px-2 py-2 text-center print:px-1">Tendência</th>
            </tr>
          </thead>
          <tbody>
            {dados.areas.map((a) => (
              <tr key={a.areaId} className="border-t border-border/60">
                <td className="px-3 py-2 text-sm text-foreground print:px-2 sm:whitespace-nowrap print:whitespace-normal">{a.nome}</td>
                {a.meses.map((m) => (
                  <td key={m.mes} className="px-2 py-2 text-center print:px-1">
                    <Celula valor={m.geral} />
                  </td>
                ))}
                <td className="px-2 py-2 text-center print:px-1">
                  <TendenciaSeta tendencia={a.tendencia} comTexto />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
