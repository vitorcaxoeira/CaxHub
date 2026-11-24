import { Percentuais, SENSOS, TipoArea, formatarDiaIso, rotuloMesLongo } from "../../utils/gestao5s";
import { Celula } from "./ResultadoSecoes";

export interface AvaliacaoResumo5S {
  id: number;
  areaNome: string;
  areaTipo: TipoArea;
  quantidadeAmbientes: number;
  avaliadorNome: string | null;
  data: string;
  percentuais: Percentuais;
}

// Avaliações que compõem o último mês do período (mesma tabela do Histórico em /5s/avaliacoes), usada
// na impressão "Detalhada" do resultado geral. Só finalizadas, que são as que entram nos percentuais.
// `comLinks`: o nome do setor aponta pro detalhe da avaliação na própria página (#avaliacao-ID).
export function AvaliacoesDoMes({ mes, itens, comLinks = false }: { mes: string; itens: AvaliacaoResumo5S[]; comLinks?: boolean }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm print:break-before-page">
      <p className="px-4 pt-4 font-mono text-[10px] uppercase tracking-widest text-muted sm:px-6 sm:pt-6 print:px-4 print:pt-4">
        Avaliações de {rotuloMesLongo(mes)} · {itens.length}
      </p>
      <div className="overflow-x-auto p-2 sm:p-4 print:overflow-visible print:p-2">
        {itens.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted">Nenhuma avaliação finalizada neste mês.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                <th className="px-3 py-2 print:px-2">Nº</th>
                <th className="px-3 py-2 print:px-2">Data</th>
                <th className="px-3 py-2 print:px-2">Setor / ambiente</th>
                <th className="px-3 py-2 print:px-2">Avaliador</th>
                {SENSOS.map((s) => (
                  <th key={s.chave} className="px-2 py-2 text-center print:px-1" title={s.rotulo}>
                    {s.curto}
                  </th>
                ))}
                <th className="px-2 py-2 text-center print:px-1">Geral</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((a) => (
                <tr key={a.id} className="break-inside-avoid border-t border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted print:px-2">#{a.id}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-foreground print:px-2">{formatarDiaIso(a.data)}</td>
                  <td className="px-3 py-2 text-sm font-medium text-foreground print:px-2">
                    {comLinks ? (
                      <a href={`#avaliacao-${a.id}`} className="hover:text-primary hover:underline">
                        {a.areaNome}
                      </a>
                    ) : (
                      a.areaNome
                    )}
                    {a.areaTipo === "comum" && <span className="ml-2 text-[10px] font-normal text-primary">ambiente</span>}
                    {a.quantidadeAmbientes > 0 && <span className="ml-2 text-[11px] font-normal text-muted">{a.quantidadeAmbientes} ambientes</span>}
                  </td>
                  <td className="px-3 py-2 text-sm text-muted print:px-2">{a.avaliadorNome ?? "—"}</td>
                  {SENSOS.map((s) => (
                    <td key={s.chave} className="px-2 py-2 text-center print:px-1">
                      <Celula valor={a.percentuais.porSenso[s.chave]} />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center print:px-1">
                    <Celula valor={a.percentuais.geral} negrito />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
