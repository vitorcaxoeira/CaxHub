import { useEffect, useState } from "react";
import { useDashboardConsultor, ResumoConsultor } from "../../hooks/useDashboardConsultor";
import { formatHorasCompacto } from "../../lib/cronograma";
import { carregarFeriadosDoPeriodo, Feriado } from "../../lib/feriados";
import { DonutChart, DonutItem } from "../ui/DonutChart";
import { SerieTemporalBarra, SeriePonto } from "../ui/SerieTemporalBarra";
import { IndicadorProgresso } from "../cronograma/IndicadorProgresso";
import { Skeleton } from "../ui/Skeleton";
import { CardValorHora } from "./CardValorHora";

const dateFormatterCurto = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dateFormatterLongo = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", timeZone: "UTC" });

function formatarDiaCurto(iso: string): string {
  return dateFormatterCurto.format(new Date(`${iso}T00:00:00Z`));
}

// Tom da barra de meta — inverso do `tomConsumo` usado no Cronograma/Lista de Atividades:
// lá passar de 100% é estouro (ruim); aqui é a meta de produtividade batida (bom). Por isso
// não reaproveita aquela função, mesmo parecendo a mesma conta.
function tomMeta(avanco: number): string {
  if (avanco >= 1) return "bg-success";
  if (avanco >= 0.7) return "bg-primary";
  return "bg-warning";
}

function Estatistica({ label, valor, destaque }: { label: string; valor: string; destaque?: "success" | "warning" | "destructive" }) {
  const cor = destaque === "success" ? "text-success" : destaque === "warning" ? "text-warning" : destaque === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</p>
      <p className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${cor}`}>{valor}</p>
    </div>
  );
}

// Agrupa os dias do período em semanas (domingo–sábado, mesmo recorte do dashboard de
// referência) — mostra só os dias com apontamento dentro de cada semana expandida.
function inicioDaSemana(dataIso: string): string {
  const d = new Date(`${dataIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

function AcordeaoSemanal({ porDia }: { porDia: ResumoConsultor["porDia"] }) {
  const semanas = new Map<string, { total: number; dias: { data: string; minutos: number }[] }>();
  for (const ponto of porDia) {
    if (ponto.minutos <= 0) continue;
    const chave = inicioDaSemana(ponto.data);
    const semana = semanas.get(chave) ?? { total: 0, dias: [] };
    semana.total += ponto.minutos;
    semana.dias.push(ponto);
    semanas.set(chave, semana);
  }
  const linhas = [...semanas.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">Horas por semana</p>
      {linhas.length === 0 ? (
        <p className="text-sm text-muted">Sem apontamento no período.</p>
      ) : (
        <div className="space-y-2">
          {linhas.map(([inicio, semana]) => (
            <details key={inicio} className="rounded-md border border-border/60">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm">
                <span className="text-foreground">Semana de {dateFormatterLongo.format(new Date(`${inicio}T00:00:00Z`))}</span>
                <span className="font-mono text-[12.5px] tabular-nums text-muted">{formatHorasCompacto(semana.total)} h</span>
              </summary>
              <div className="space-y-1 border-t border-border/60 px-3 py-2">
                {semana.dias
                  .sort((a, b) => (a.data < b.data ? -1 : 1))
                  .map((dia) => (
                    <div key={dia.data} className="flex items-center justify-between text-[12.5px]">
                      <span className="text-muted">{formatarDiaCurto(dia.data)}</span>
                      <span className="font-mono tabular-nums text-foreground">{formatHorasCompacto(dia.minutos)} h</span>
                    </div>
                  ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function ListaFeriados({ feriados }: { feriados: Feriado[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">Feriados no período</p>
      {feriados.length === 0 ? (
        <p className="text-sm text-muted">Nenhum feriado nacional no período.</p>
      ) : (
        <ul className="space-y-1.5">
          {feriados.map((f) => (
            <li key={f.date} className="flex items-center justify-between text-[12.5px]">
              <span className="text-muted">{formatarDiaCurto(f.date)}</span>
              <span className="text-foreground">{f.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Dashboard inicial pro consultor comum (Home) — inspirado num dashboard pessoal de
// produtividade (extensão de Chrome, ver conversa de 17/08/2026), adaptado ao dado que o
// CaxHub já tem + valor-hora vindo do Senior (ContratoConsultor). Gestor/admin continuam
// vendo a Home padrão (ver Home.tsx) — esta tela é só pra quem não gerencia departamento
// nenhum.
export function DashboardConsultor() {
  const { resumo, semConsultor, loading, erro } = useDashboardConsultor();
  const [feriados, setFeriados] = useState<Feriado[]>([]);

  useEffect(() => {
    if (!resumo) return;
    let cancelado = false;
    carregarFeriadosDoPeriodo(resumo.periodo.de, resumo.periodo.ate).then((lista) => {
      if (!cancelado) setFeriados(lista);
    });
    return () => {
      cancelado = true;
    };
  }, [resumo?.periodo.de, resumo?.periodo.ate]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (erro) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{erro}</p>;
  }

  // Defensivo: Home.tsx só monta este componente quando `perfil.consultor` existe, mas a
  // API pode discordar (ex.: e-mail sem match na view de consultores mudou entre as duas
  // chamadas) — melhor um aviso curto do que uma tela quebrada.
  if (semConsultor || !resumo) {
    return <p className="text-sm text-muted">Não foi possível montar o painel — cadastro de consultor não encontrado.</p>;
  }

  const avancoMeta = resumo.metaTotalMinutos > 0 ? resumo.totalMinutos / resumo.metaTotalMinutos : null;

  const totalProjeto = resumo.porProjeto.reduce((soma, p) => soma + p.valor, 0);
  const itensDonut: DonutItem[] = resumo.porProjeto
    .slice(0, 8)
    .map((p) => ({ chave: p.chave, nome: p.nome, valor: p.valor, pct: totalProjeto > 0 ? (p.valor / totalProjeto) * 100 : 0 }));

  const pontosSerieDia: SeriePonto[] = resumo.porDia.map((p) => ({ label: formatarDiaCurto(p.data), valores: [p.minutos] }));

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-xl font-bold text-foreground">Meu painel</h1>
        <p className="font-mono text-[11px] text-muted">
          {formatarDiaCurto(resumo.periodo.de)} – {formatarDiaCurto(resumo.periodo.ate)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Estatistica label="Total de horas" valor={`${formatHorasCompacto(resumo.totalMinutos)} h`} />
        <Estatistica
          label="Saldo de horas"
          valor={resumo.saldoMinutos == null ? "—" : `${resumo.saldoMinutos >= 0 ? "+" : ""}${formatHorasCompacto(resumo.saldoMinutos)} h`}
          destaque={resumo.saldoMinutos == null ? undefined : resumo.saldoMinutos >= 0 ? "success" : "warning"}
        />
        <Estatistica label="Meta diária" valor={resumo.metaDiariaMinutos == null ? "Sem jornada" : `${formatHorasCompacto(resumo.metaDiariaMinutos)} h`} />
        <Estatistica
          label="Sessões pendentes"
          valor={String(resumo.sessoesPendentes)}
          destaque={resumo.sessoesPendentes > 0 ? "warning" : undefined}
        />
        <Estatistica label="RATs pendentes" valor={String(resumo.ratsPendentes)} destaque={resumo.ratsPendentes > 0 ? "warning" : undefined} />
        <Estatistica label="Notificações" valor={String(resumo.notificacoesNaoLidas)} destaque={resumo.notificacoesNaoLidas > 0 ? "warning" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardValorHora valorHora={resumo.valorHora} ganhoAteAgora={resumo.ganhoAteAgora} projecaoGanho={resumo.projecaoGanho} />

        <section className="rounded-lg border border-border bg-surface p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Progresso da meta</p>
          {avancoMeta == null ? (
            <p className="mt-3 text-sm text-muted">Sem jornada cadastrada no período — meta não configurada.</p>
          ) : (
            <>
              <p className="mt-2 font-mono text-2xl font-semibold text-foreground">{Math.round(avancoMeta * 100)}%</p>
              <p className="font-mono text-[12px] text-muted">
                {formatHorasCompacto(resumo.totalMinutos)} / {formatHorasCompacto(resumo.metaTotalMinutos)} h
              </p>
              <div className="mt-2">
                <IndicadorProgresso avanco={avancoMeta} cor={tomMeta(avancoMeta)} alturaPx={6} />
              </div>
            </>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SerieTemporalBarra
            titulo="Horas por dia"
            pontos={pontosSerieDia}
            series={[{ nome: "Horas", cor: "primary" }]}
            formatarValor={(v) => `${formatHorasCompacto(v)} h`}
          />
        </div>
        <DonutChart titulo="Horas por projeto" itens={itensDonut} formatarValor={(v) => `${formatHorasCompacto(v)} h`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AcordeaoSemanal porDia={resumo.porDia} />
        </div>
        <ListaFeriados feriados={feriados} />
      </div>
    </div>
  );
}
