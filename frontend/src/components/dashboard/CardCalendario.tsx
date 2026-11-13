import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { MESES } from "../../lib/feriasCalendario";
import { useToast } from "../ui/Toast";
import { GradeDoMes, ModalDia, horas, useCalendarioMes } from "../calendario/pecas";

interface CardCalendarioProps {
  /** O período da Home (multi-seleção): o card mostra um mês por vez, navegando entre os meses selecionados. */
  anos: number[];
  meses: number[];
  /** Ausente = o próprio usuário; presente = gestor/admin olhando o painel de outro consultor. */
  codfor?: number;
  /** Chamado depois de lançar/remover uma folga: a meta e o progresso da Home mudam, então a Home recarrega o resumo. */
  aoMudar: () => void;
}

// Card "Calendário" da Home (13/11/2026), no lugar de "Feriados no período": o calendário de trabalho do consultor (férias, folgas e feriados) do período
// escolhido no topo da Home. Clicar num dia abre o mesmo modal da página /projetos/calendario para marcar ou remover folga.
export function CardCalendario({ anos, meses, codfor, aoMudar }: CardCalendarioProps) {
  const toast = useToast();
  // Os meses do período, em ordem cronológica.
  const combos = useMemo(
    () => [...anos].sort((a, b) => a - b).flatMap((ano) => [...meses].sort((a, b) => a - b).map((mes) => ({ ano, mes }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anos.join(","), meses.join(",")],
  );
  const hoje = new Date();
  const indiceDeHoje = combos.findIndex((c) => c.ano === hoje.getFullYear() && c.mes === hoje.getMonth() + 1);
  // Começa no mês corrente se ele está no período; senão no último mês do período (o mais recente).
  const [escolhido, setEscolhido] = useState<{ chave: string; indice: number } | null>(null);
  const chave = combos.map((c) => `${c.ano}-${c.mes}`).join(",");
  const indice = Math.min(escolhido && escolhido.chave === chave ? escolhido.indice : indiceDeHoje >= 0 ? indiceDeHoje : combos.length - 1, combos.length - 1);
  const atual = combos[Math.max(0, indice)] ?? { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };

  const { dados, loading, erro, feriados, recarregar } = useCalendarioMes(atual.ano, atual.mes, codfor ?? null);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const diaSelecionado = dados?.dias.find((d) => d.data === diaAberto) ?? null;
  const abonado = dados ? dados.totais.abonadoFeriasMinutos + dados.totais.abonadoFolgaMinutos : 0;

  const ir = (delta: number) => setEscolhido({ chave, indice: Math.max(0, Math.min(combos.length - 1, indice + delta)) });

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Calendário</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => ir(-1)}
            disabled={indice <= 0}
            aria-label="Mês anterior do período"
            className="rounded-md border border-border p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-28 text-center font-display text-sm font-semibold text-foreground">
            {MESES[atual.mes - 1]} {atual.ano}
          </span>
          <button
            type="button"
            onClick={() => ir(1)}
            disabled={indice >= combos.length - 1}
            aria-label="Próximo mês do período"
            className="rounded-md border border-border p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {erro && <p className="mb-3 text-sm text-destructive">{erro}</p>}

      <GradeDoMes dados={dados} loading={loading} feriados={feriados} onDia={setDiaAberto} compacto />

      <p className={cn("mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted")}>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-primary/40" /> Férias
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-warning/40" /> Folga
        </span>
        <span>
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-muted" /> Feriado
        </span>
        {abonado > 0 && <span className="ml-auto font-mono">{horas(abonado)} fora da meta no mês</span>}
      </p>

      {diaSelecionado && dados && (
        <ModalDia
          dia={diaSelecionado}
          dados={dados}
          feriado={feriados[diaSelecionado.data]}
          onFechar={() => setDiaAberto(null)}
          onMudou={() => {
            recarregar();
            aoMudar();
          }}
          toast={toast.mostrar}
        />
      )}
    </section>
  );
}
