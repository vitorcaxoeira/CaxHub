import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { formatHorasCompacto } from "../../lib/cronograma";
import { cn } from "../../lib/cn";
import { IndicadorProgresso } from "../cronograma/IndicadorProgresso";

/** A conta da meta do período (vem de /dashboard/meu-resumo, `metaPeriodo`). */
export interface MetaPeriodoDto {
  jornadaMinutos: number;
  feriasMinutos: number;
  folgaMinutos: number;
  metaMinutos: number;
  diasComJornada: number;
  diasFerias: number;
  diasFolgaInteira: number;
  metaAteHojeMinutos: number;
  realizadoAteHojeMinutos: number;
  diasComMetaRestantes: number;
  semJornadaMinutos: number;
}

const horas = (minutos: number) => `${formatHorasCompacto(Math.abs(minutos))} h`;
const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

function tomMeta(avanco: number): string {
  if (avanco >= 1) return "bg-success";
  if (avanco >= 0.7) return "bg-primary";
  return "bg-warning";
}

const CHAVE_DETALHES = "caxhub.home.progressoMeta.detalhes";

/** Detalhes abertos por padrão; a escolha do consultor fica neste navegador (sem storage, ou no servidor/teste, vale o padrão). */
function lerDetalhesAbertos(): boolean {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(CHAVE_DETALHES) !== "fechado";
  } catch {
    return true;
  }
}

function LinhaConta({ rotulo, valor, destaque, dica }: { rotulo: string; valor: string; destaque?: boolean; dica?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", destaque && "border-t border-border pt-1 font-semibold text-foreground")} title={dica}>
      <span>{rotulo}</span>
      <span className="font-mono tabular-nums">{valor}</span>
    </div>
  );
}

/**
 * Cartão "Progresso da meta": a meta do período inteiro (jornada − férias − folgas), o realizado sobre ela, a marca de onde deveria estar hoje e as horas
 * trabalhadas em dia sem jornada (fim de semana). Puro (só recebe os números), exportado para o teste de renderização.
 */
export function CardProgressoMeta({
  meta,
  totalMinutos,
  rotuloPeriodo,
}: {
  meta: MetaPeriodoDto;
  /** Horas realizadas no período inteiro (inclui fim de semana). */
  totalMinutos: number;
  rotuloPeriodo: string;
}) {
  const temJornada = meta.diasComJornada > 0;
  const deducoes = meta.feriasMinutos + meta.folgaMinutos;
  const avanco = meta.metaMinutos > 0 ? totalMinutos / meta.metaMinutos : null;
  const esperado = meta.metaMinutos > 0 ? meta.metaAteHojeMinutos / meta.metaMinutos : null;
  const ritmo = meta.realizadoAteHojeMinutos - meta.metaAteHojeMinutos;
  const falta = Math.max(0, meta.metaMinutos - totalMinutos);
  const [aberto, setAberto] = useState(lerDetalhesAbertos);

  function alternar() {
    const proximo = !aberto;
    setAberto(proximo);
    try {
      window.localStorage.setItem(CHAVE_DETALHES, proximo ? "aberto" : "fechado");
    } catch {
      // sem storage: a escolha vale só nesta tela
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Progresso da meta · {rotuloPeriodo}</p>

      {!temJornada ? (
        <p className="mt-3 text-sm text-muted">Sem jornada cadastrada no período — meta não configurada.</p>
      ) : avanco == null ? (
        <p className="mt-3 text-sm text-muted">Período todo em férias ou folga: sem meta para cumprir.</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="font-mono text-2xl font-semibold text-foreground">
              {formatHorasCompacto(totalMinutos)} <span className="text-base font-normal text-muted">h de {formatHorasCompacto(meta.metaMinutos)} h</span>
            </p>
            <p className="font-mono text-2xl font-semibold text-foreground">{Math.round(avanco * 100)}%</p>
          </div>
          <div className="mt-2">
            <IndicadorProgresso avanco={avanco} cor={tomMeta(avanco)} alturaPx={8} marcador={esperado != null ? { percentual: esperado, cor: "bg-foreground" } : undefined} />
          </div>
          <p className="mt-1 text-[11.5px] text-muted">Traço na barra: esperado até hoje, {horas(meta.metaAteHojeMinutos)}</p>
        </>
      )}

      {temJornada && (
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          title={aberto ? "Recolher a conta da meta" : "Expandir a conta da meta"}
          className="mt-3 flex w-full items-center justify-between rounded-md px-1 py-1 font-mono text-[10px] uppercase tracking-widest text-muted transition hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>Meta do período · detalhes</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", !aberto && "-rotate-90")} aria-hidden />
        </button>
      )}

      {temJornada && aberto && (
        <div className="mt-1 space-y-0.5 text-[12px] text-muted">
          <LinhaConta rotulo={`Jornada (${dias(meta.diasComJornada)})`} valor={horas(meta.jornadaMinutos)} dica="Soma da jornada cadastrada nos dias úteis do período, sem abonos." />
          {meta.feriasMinutos > 0 && <LinhaConta rotulo={`− Férias (${dias(meta.diasFerias)})`} valor={`− ${horas(meta.feriasMinutos)}`} dica="Férias lançadas pelo gestor: saem da meta." />}
          {meta.folgaMinutos > 0 && (
            <LinhaConta
              rotulo={`− Folgas${meta.diasFolgaInteira > 0 ? ` (${dias(meta.diasFolgaInteira)} inteiros)` : ""}`}
              valor={`− ${horas(meta.folgaMinutos)}`}
              dica="Folgas marcadas no calendário (dia inteiro ou parcial): saem da meta."
            />
          )}
          {deducoes === 0 && <p className="text-[11.5px]">Sem férias nem folgas no período.</p>}
          <LinhaConta rotulo="= Meta do período" valor={horas(meta.metaMinutos)} destaque />
        </div>
      )}

      {temJornada && aberto && avanco != null && (
        <div className="mt-3 space-y-0.5 text-[12px]">
          <p className={cn("font-medium", ritmo >= 0 ? "text-success" : "text-warning")}>
            {ritmo === 0 ? "No ritmo esperado até hoje" : `Ritmo: ${horas(ritmo)} ${ritmo > 0 ? "adiantado" : "abaixo do esperado"} até hoje`}
          </p>
          <p className="text-muted">
            {falta > 0 ? `Faltam ${horas(falta)}` : "Meta do período cumprida"}
            {meta.diasComMetaRestantes > 0 && ` · ${dias(meta.diasComMetaRestantes)} com meta restantes`}
          </p>
        </div>
      )}

      {meta.semJornadaMinutos > 0 && (
        <p className="mt-2 text-[11.5px] text-muted" title="Horas apontadas em dias sem jornada (fim de semana). Entram no realizado; esses dias não têm meta.">
          Fim de semana / dia sem jornada: <span className="font-mono font-semibold text-foreground">{horas(meta.semJornadaMinutos)}</span> trabalhadas (já no realizado)
        </p>
      )}
    </section>
  );
}
