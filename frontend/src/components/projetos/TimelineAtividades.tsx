import { useMemo } from "react";
import { AtividadeKanban, DetalheInfo } from "./KanbanBoard";

interface TimelineAtividadesProps {
  atividades: AtividadeKanban[];
  onAbrirDetalhe: (atividadeId: number, info: DetalheInfo) => void;
}

const DIA_MS = 24 * 60 * 60 * 1000;
const DIA_PX = 28;

function diasEntre(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DIA_MS);
}

// Gantt simplificado — usa dataPrevistaInicio/dataPrevistaFim (conceito só do CaxHub,
// definido manualmente pelo Líder Técnico/Consultor), não o prazo da proposta (datval).
// Atividades sem as duas datas definidas ficam de fora do gráfico (não há o que desenhar).
export function TimelineAtividades({ atividades, onAbrirDetalhe }: TimelineAtividadesProps) {
  const agendadas = useMemo(
    () =>
      atividades
        .filter((a) => a.dataPrevistaInicio && a.dataPrevistaFim)
        .map((a) => ({
          atividade: a,
          inicio: new Date(a.dataPrevistaInicio as string),
          fim: new Date(a.dataPrevistaFim as string),
        }))
        .sort((a, b) => a.inicio.getTime() - b.inicio.getTime()),
    [atividades]
  );

  const semPlanejamento = atividades.length - agendadas.length;

  if (agendadas.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        <p className="text-sm text-muted">
          Nenhuma atividade com datas de planejamento definidas ainda. Abra os detalhes de uma atividade no Quadro ou na
          Lista para definir início/fim previstos e alimentar a Timeline.
        </p>
      </div>
    );
  }

  const inicioRange = agendadas.reduce((min, a) => (a.inicio < min ? a.inicio : min), agendadas[0].inicio);
  const fimRange = agendadas.reduce((max, a) => (a.fim > max ? a.fim : max), agendadas[0].fim);
  const totalDias = Math.max(1, diasEntre(inicioRange, fimRange)) + 1;
  const hoje = new Date();
  const offsetHoje = diasEntre(inicioRange, hoje);

  const marcos: { offset: number; label: string }[] = [];
  const cursor = new Date(Date.UTC(inicioRange.getUTCFullYear(), inicioRange.getUTCMonth(), 1));
  while (cursor <= fimRange) {
    marcos.push({
      offset: diasEntre(inicioRange, cursor),
      label: new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(cursor),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Timeline (Gantt simplificado)</p>
        {semPlanejamento > 0 && (
          <p className="text-[11px] text-muted">{semPlanejamento} atividade(s) sem planejamento não exibida(s)</p>
        )}
      </div>
      <div className="overflow-x-auto">
        <div style={{ width: totalDias * DIA_PX + 220, position: "relative" }}>
          <div className="relative mb-1 h-6 border-b border-border" style={{ marginLeft: 220 }}>
            {marcos.map((m) => (
              <span
                key={m.label + m.offset}
                className="absolute top-0 whitespace-nowrap font-mono text-[10px] capitalize text-muted"
                style={{ left: m.offset * DIA_PX }}
              >
                {m.label}
              </span>
            ))}
          </div>
          <div className="space-y-1.5">
            {agendadas.map(({ atividade, inicio, fim }) => {
              const offset = diasEntre(inicioRange, inicio);
              const largura = Math.max(1, diasEntre(inicio, fim) + 1);
              return (
                <div key={atividade.id} className="flex items-center" style={{ height: 30 }}>
                  <div className="w-[220px] flex-none truncate pr-3 text-[12px] text-foreground" title={atividade.cliente}>
                    Proposta {atividade.codpro} · {atividade.cliente}
                  </div>
                  <div className="relative flex-1" style={{ height: 22 }}>
                    {offsetHoje >= 0 && offsetHoje <= totalDias && (
                      <div className="absolute top-0 h-full w-px bg-destructive/40" style={{ left: offsetHoje * DIA_PX }} />
                    )}
                    <button
                      onClick={() =>
                        onAbrirDetalhe(atividade.id, {
                          titulo: `Proposta ${atividade.codpro} · Projeto ${atividade.numprj}`,
                          podeEditar: atividade.podeEditar,
                          dataPrevistaInicio: atividade.dataPrevistaInicio,
                          dataPrevistaFim: atividade.dataPrevistaFim,
                        })
                      }
                      title={`${atividade.cliente} · ${atividade.depexeLabel}`}
                      className={`absolute top-0 h-full truncate rounded px-2 text-left text-[10.5px] leading-[22px] text-white hover:opacity-85 ${
                        atividade.atrasada ? "bg-destructive" : "bg-primary"
                      }`}
                      style={{ left: offset * DIA_PX, width: largura * DIA_PX }}
                    >
                      {atividade.consultorNome}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
