import { useState } from "react";
import { cn } from "../../lib/cn";
import { PaginaRh, Painel, Aviso } from "../../components/rh/blocos";
import { fmtDec, fmtInt, fmtMoeda, fmtPct } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

type Tipo = "moeda" | "horas" | "percentual" | "quantidade";

interface Dre extends RespostaBase {
  meses: { mes: string; rotulo: string }[];
  linhas: { grupo: string; rotulo: string; tipo: Tipo; valores: Record<string, number | null>; total: number | null; totalDe: "soma" | "ultimo" | "razao" }[];
  definicoes: { totais: string; origem: string };
}

function formatar(tipo: Tipo, v: number | null): string {
  if (v == null) return "—";
  switch (tipo) {
    case "moeda": return fmtMoeda(v);
    case "horas": return `${fmtDec(v)} h`;
    case "percentual": return fmtPct(v, 1);
    default: return fmtInt(v);
  }
}

const ROTULO_TOTAL = { soma: "Total", ultimo: "Último mês", razao: "Período" } as const;

export function DreRh() {
  const { dados: d, carregando, erro } = useRh<Dre>("dre");
  const [colapsados, setColapsados] = useState<Record<string, boolean>>({});

  const grupos: { grupo: string; linhas: Dre["linhas"] }[] = [];
  for (const l of d?.linhas ?? []) {
    const g = grupos.find((x) => x.grupo === l.grupo);
    if (g) g.linhas.push(l);
    else grupos.push({ grupo: l.grupo, linhas: [l] });
  }

  return (
    <PaginaRh
      titulo="DRE de RH"
      pergunta="Os números do RH lado a lado, mês a mês: folha, jornada, quadro e rescisões numa só matriz."
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && (
        <>
          <Aviso tom="info">{d.definicoes.totais}</Aviso>
          <Painel titulo="Matriz mensal" descricao="Cada linha vem da tela correspondente; clique no nome do grupo para recolher.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 z-[1] bg-surface px-2 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Indicador</th>
                    {d.meses.map((m) => (
                      <th key={m.mes} className="px-2 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        {m.rotulo}
                      </th>
                    ))}
                    <th className="sticky right-0 z-[1] bg-surface-2 px-2 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.35)]">Período</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g) => (
                    <GrupoLinhas key={g.grupo} grupo={g.grupo} linhas={g.linhas} meses={d.meses} colapsado={!!colapsados[g.grupo]} alternar={() => setColapsados((c) => ({ ...c, [g.grupo]: !c[g.grupo] }))} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11.5px] text-muted">
              Total: fluxos (folha, horas, admissões, rescisões) somam; headcount mostra o último mês; índices e custo médio são recalculados sobre o período.
              {" "}{d.definicoes.origem}
            </p>
          </Painel>
        </>
      )}
    </PaginaRh>
  );
}

function GrupoLinhas({
  grupo,
  linhas,
  meses,
  colapsado,
  alternar,
}: {
  grupo: string;
  linhas: Dre["linhas"];
  meses: Dre["meses"];
  colapsado: boolean;
  alternar: () => void;
}) {
  return (
    <>
      <tr className="bg-surface-2/70">
        <td colSpan={meses.length + 2} className="sticky left-0 px-2 py-1.5">
          <button type="button" onClick={alternar} className="flex items-center gap-1.5 font-display text-[12.5px] font-semibold text-foreground" aria-expanded={!colapsado}>
            <svg width="9" height="9" viewBox="0 0 10 10" className={cn("transition-transform", colapsado && "-rotate-90")} aria-hidden="true">
              <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {grupo}
          </button>
        </td>
      </tr>
      {!colapsado &&
        linhas.map((l) => {
          const destaque = l.rotulo === "Folha líquida" || l.rotulo === "Índice de absenteísmo" || l.rotulo === "Turnover";
          return (
            <tr key={l.rotulo} className="border-b border-border/60 hover:bg-surface-2/50">
              <td className={cn("sticky left-0 z-[1] whitespace-nowrap bg-surface px-2 py-1.5 pl-5", destaque ? "font-semibold text-foreground" : "text-foreground/90")}>{l.rotulo}</td>
              {meses.map((m) => (
                <td key={m.mes} className={cn("px-2 py-1.5 text-right tabular-nums", destaque ? "font-semibold" : "", l.valores[m.mes] == null && "text-muted")}>
                  {formatar(l.tipo, l.valores[m.mes])}
                </td>
              ))}
              <td className="sticky right-0 z-[1] bg-surface-2 px-2 py-1.5 text-right font-semibold tabular-nums shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.35)]" title={ROTULO_TOTAL[l.totalDe]}>
                {formatar(l.tipo, l.total)}
              </td>
            </tr>
          );
        })}
    </>
  );
}
