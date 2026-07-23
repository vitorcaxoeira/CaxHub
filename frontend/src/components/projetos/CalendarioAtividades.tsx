import { useMemo, useState } from "react";
import { AtividadeKanban, DetalheInfo } from "./KanbanBoard";

interface CalendarioAtividadesProps {
  atividades: AtividadeKanban[];
  onAbrirDetalhe: (atividadeId: number, info: DetalheInfo) => void;
}

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function chaveDia(data: Date): string {
  return `${data.getUTCFullYear()}-${data.getUTCMonth()}-${data.getUTCDate()}`;
}

// datval vem do ERP como prazo da proposta — o calendário organiza atividades por
// esse prazo, não pela data de planejamento (que alimenta a Timeline/Gantt).
export function CalendarioAtividades({ atividades, onAbrirDetalhe }: CalendarioAtividadesProps) {
  const hoje = useMemo(() => new Date(), []);
  const [mesRef, setMesRef] = useState(() => new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)));

  const porDia = useMemo(() => {
    const mapa = new Map<string, AtividadeKanban[]>();
    for (const a of atividades) {
      if (!a.datval) continue;
      const data = new Date(a.datval);
      mapa.set(chaveDia(data), [...(mapa.get(chaveDia(data)) ?? []), a]);
    }
    return mapa;
  }, [atividades]);

  const ano = mesRef.getUTCFullYear();
  const mes = mesRef.getUTCMonth();
  const primeiroDiaSemana = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
  const totalDias = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();

  const celulas: (Date | null)[] = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let dia = 1; dia <= totalDias; dia++) celulas.push(new Date(Date.UTC(ano, mes, dia)));

  const tituloMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(mesRef);

  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold capitalize text-foreground">{tituloMes}</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setMesRef(new Date(Date.UTC(ano, mes - 1, 1)))}
            className="rounded-md border border-border px-2.5 py-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
          >
            ← Anterior
          </button>
          <button
            onClick={() => setMesRef(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)))}
            className="rounded-md border border-border px-2.5 py-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
          >
            Hoje
          </button>
          <button
            onClick={() => setMesRef(new Date(Date.UTC(ano, mes + 1, 1)))}
            className="rounded-md border border-border px-2.5 py-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
          >
            Próximo →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="bg-surface-2 py-2 text-center font-mono text-[10.5px] uppercase tracking-wide text-muted">
            {d}
          </div>
        ))}
        {celulas.map((data, i) => {
          if (!data) return <div key={`vazio-${i}`} className="min-h-[110px] bg-surface" />;
          const itens = porDia.get(chaveDia(data)) ?? [];
          const ehHoje = chaveDia(data) === chaveDia(hoje);
          return (
            <div key={chaveDia(data)} className="min-h-[110px] bg-surface p-1.5">
              <span
                className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] ${
                  ehHoje ? "bg-primary text-primary-foreground" : "text-muted"
                }`}
              >
                {data.getUTCDate()}
              </span>
              <div className="mt-1 space-y-1">
                {itens.slice(0, 3).map((a) => (
                  <button
                    key={a.id}
                    onClick={() =>
                      onAbrirDetalhe(a.id, {
                        titulo: `Proposta ${a.codpro} · Projeto ${a.numprj}`,
                        podeEditar: a.podeEditar,
                        dataPrevistaInicio: a.dataPrevistaInicio,
                        dataPrevistaFim: a.dataPrevistaFim,
                        codemp: a.codemp,
                        codpro: a.codpro,
                        seqite: a.seqite,
                        itemDescricao: a.itemDescricao,
                        itemQtdhor: a.itemQtdhor,
                        itemAlocado: a.itemAlocado,
                        estruturaNome: a.estruturaNome,
                        itemRealizado: a.itemRealizado,
                        horasRealizadas: a.horasRealizadas,
                        estruturaPercentual: a.estruturaPercentual,
                        podeVerCronograma: a.podeVerCronograma,
                      })
                    }
                    title={`${a.cliente} · ${a.depexeLabel}`}
                    className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10.5px] ${
                      a.atrasada ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary"
                    } hover:opacity-80`}
                  >
                    {a.cliente}
                  </button>
                ))}
                {itens.length > 3 && <p className="px-1.5 text-[10px] text-muted">+{itens.length - 3} mais</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
