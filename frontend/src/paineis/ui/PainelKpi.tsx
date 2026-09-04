import { kpiToneClasses, KpiTone } from "../../components/ui/KpiCard";

// Cartão de número grande em escala de TV — reaproveita SÓ o mapa de cores
// (kpiToneClasses) do KpiCard normal, pra nunca divergir da paleta do app, mas
// com markup e tipografia próprios: o KpiCard da tela normal usa `text-2xl`/
// `text-[11px]` fixos, ilegíveis a 3-4 metros, e não tem espaço pra crescer
// sem quebrar as ~15 telas que já o usam.
export function PainelKpi({ label, valor, tone }: { label: string; valor: number | string; tone: KpiTone }) {
  const cores = kpiToneClasses[tone];
  return (
    <div className={`min-w-0 rounded-2xl border-2 bg-surface p-8 ${cores.borda}`}>
      <p className={`font-mono text-2xl uppercase tracking-wide ${cores.texto}`}>{label}</p>
      {/* text-6xl, não text-8xl: um valor de 3-4 dígitos em text-8xl (96px) estourava a
          largura do card e sobrepunha o vizinho — não tem quantidade de dígito que um
          painel real não vá produzir mais cedo ou mais tarde (backlog de um
          departamento grande passa de 3 dígitos fácil). Sem truncate no valor —
          esconder o número derrota o propósito do painel; a defesa real é o grid do
          chamador dar largura suficiente (ver PainelAtividadesSetor, grid-cols-2). */}
      <p className="mt-3 font-mono text-6xl font-bold tabular-nums text-foreground">{valor}</p>
    </div>
  );
}
