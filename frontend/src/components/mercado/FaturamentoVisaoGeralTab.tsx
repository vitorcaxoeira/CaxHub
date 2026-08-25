import axios from "axios";
import { useEffect, useState } from "react";
import { KpiCard, KpiTone } from "../ui/KpiCard";
import { Skeleton } from "../ui/Skeleton";
import { GaugeChart } from "../ui/GaugeChart";
import { EvolucaoFaturamentoChart, PontoEvolucaoAnual } from "./EvolucaoFaturamentoChart";

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const currency = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtMoney = (v: number | null) => (v == null ? "—" : `R$ ${currency.format(v)}`);
const fmtNumero = (v: number | null) => (v == null ? "—" : currency.format(v));
const fmtPct = (v: number | null, casas = 2) => (v == null ? "—" : `${v.toFixed(casas).replace(".", ",")}%`);

interface KpisResposta {
  crescimento5AnosCompletos: number | null;
  faturamentoMedio5Anos: number;
  metaAno: number | null;
  faturamentoAno: number;
  percMetaAtingido: number | null;
  faturamentoDesejado: number | null;
  faturamento12Meses: number;
  percCrescimentoEsperado: number | null;
}

interface LinhaMensal {
  mes: number;
  valoresPorAno: Record<string, number>;
  total: number;
}

interface LinhaComparativo {
  mes: number;
  anoAnt: number;
  anoAtual: number | null;
  percCre: number | null;
  anoAntAc: number;
  anoAtualAc: number;
  percAc: number | null;
  esperado: number | null;
}

interface DashboardResposta {
  anoBase: number;
  kpis: KpisResposta;
  gauge: { percCrescimentoComparavel: number | null; percReferenciaAnoAnterior: number | null };
  evolucaoAnual: PontoEvolucaoAnual[];
  tabelaMensal: LinhaMensal[];
  tabelaMensalTotal: { valoresPorAno: Record<string, number>; total: number };
  comparativoMensal: LinhaComparativo[];
  comparativoMensalTotal: Omit<LinhaComparativo, "mes">;
}

function toneMetaAtingido(pct: number | null): KpiTone {
  if (pct == null) return "neutral";
  if (pct >= 90) return "success";
  if (pct >= 60) return "warning";
  return "destructive";
}

function toneCrescimento(pct: number | null): KpiTone {
  if (pct == null) return "neutral";
  return pct >= 0 ? "success" : "destructive";
}

export function FaturamentoVisaoGeralTab({ ano }: { ano: number }) {
  const [dados, setDados] = useState<DashboardResposta | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios
      .get("/api/analise-faturamento/dashboard", { params: { ano } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a análise de faturamento"))
      .finally(() => setLoading(false));
  }, [ano]);

  const anosTabela = dados?.evolucaoAnual.map((e) => e.ano) ?? [];

  if (erro) {
    return <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>;
  }

  if (loading || !dados) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-5">
            <Skeleton className="mb-2 h-3.5 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Cresc. Últ. 5 anos"
          tone={toneCrescimento(dados.kpis.crescimento5AnosCompletos)}
          quantidade={0}
          total={1}
          valor={fmtPct(dados.kpis.crescimento5AnosCompletos)}
          rodape=""
        />
        <KpiCard
          label="Fat. Médio 5 Anos"
          tone="primary"
          quantidade={0}
          total={1}
          valor={fmtMoney(dados.kpis.faturamentoMedio5Anos)}
          rodape=""
        />
        <KpiCard label="Meta Ano" tone="primary" quantidade={0} total={1} valor={fmtMoney(dados.kpis.metaAno)} rodape="" />
        <KpiCard
          label="Faturamento Ano"
          tone="primary"
          quantidade={0}
          total={1}
          valor={fmtMoney(dados.kpis.faturamentoAno)}
          rodape=""
        />
        <KpiCard
          label="% Meta Atingido"
          tone={toneMetaAtingido(dados.kpis.percMetaAtingido)}
          quantidade={Math.round(dados.kpis.percMetaAtingido ?? 0)}
          total={100}
          valor={fmtPct(dados.kpis.percMetaAtingido)}
          rodape=""
        />
        <KpiCard
          label="Faturamento Desejado"
          tone="primary"
          quantidade={0}
          total={1}
          valor={fmtMoney(dados.kpis.faturamentoDesejado)}
          rodape=""
        />
        <KpiCard
          label="Faturamento 12 Meses"
          tone="primary"
          quantidade={0}
          total={1}
          valor={fmtMoney(dados.kpis.faturamento12Meses)}
          rodape=""
        />
        <KpiCard
          label="% Crescimento Esperado"
          tone="primary"
          quantidade={0}
          total={1}
          valor={fmtPct(dados.kpis.percCrescimentoEsperado, 1)}
          rodape=""
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EvolucaoFaturamentoChart titulo="Evolução do Valor Orçado x Realizado de Receitas" pontos={dados.evolucaoAnual} formatarValor={fmtNumero} />
        </div>
        <GaugeChart
          titulo="% Meta Atingido"
          valor={dados.gauge.percCrescimentoComparavel ?? 0}
          referencia={dados.gauge.percReferenciaAnoAnterior}
        />
      </div>

      {/* flex-wrap em vez de grid 50/50: cada tabela ocupa só a largura que o próprio
          conteúdo pede (sem `w-full` na <table>) — a Comparativo (8 colunas, cabeçalhos
          compostos como "$ Ant. Ac.") tem mais colunas que a Mensal (7) e uma proporção fixa
          sempre sobra pra uma e falta pra outra. Se não couberem lado a lado, a 2ª quebra pra
          linha de baixo (cada uma ocupando a largura toda) em vez de espremer/gerar scroll. */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <p className="px-4 pt-4 font-mono text-[10px] uppercase tracking-widest text-muted">Faturamento Mensal por Ano</p>
          <table className="border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Mês</th>
                {anosTabela.map((ano2) => (
                  <th key={ano2} className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                    {ano2}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Total</th>
              </tr>
            </thead>
            <tbody>
              {dados.tabelaMensal.map((linha) => (
                <tr key={linha.mes} className="border-b border-border/50">
                  <td className="px-3 py-1.5 text-[12.5px] text-foreground">{MESES_ABREV[linha.mes - 1]}</td>
                  {anosTabela.map((ano2) => (
                    <td key={ano2} className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                      {fmtNumero(linha.valoresPorAno[String(ano2)] ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-mono text-[12px] font-medium tabular-nums text-foreground">{fmtNumero(linha.total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-surface-2 font-semibold">
                <td className="px-3 py-1.5 text-[12.5px] text-foreground">Total</td>
                {anosTabela.map((ano2) => (
                  <td key={ano2} className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                    {fmtNumero(dados.tabelaMensalTotal.valoresPorAno[String(ano2)] ?? 0)}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.tabelaMensalTotal.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <p className="px-4 pt-4 font-mono text-[10px] uppercase tracking-widest text-muted">Comparativo Mensal — Ano Atual x Ano Anterior</p>
          <table className="border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="whitespace-nowrap px-2 py-2 text-left font-mono text-[11px] font-medium uppercase text-muted">Mês</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] font-medium uppercase text-muted">$ Ant.</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] font-medium uppercase text-muted">$ Atual</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] font-medium uppercase text-muted">% Cre.</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] font-medium uppercase text-muted">$ Ant. Ac.</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] font-medium uppercase text-muted">$ Atual Ac.</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] font-medium uppercase text-muted">% Ac.</th>
                <th className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11px] font-medium uppercase text-muted">$ Esperado</th>
              </tr>
            </thead>
            <tbody>
              {dados.comparativoMensal.map((linha) => (
                <tr key={linha.mes} className="border-b border-border/50">
                  <td className="whitespace-nowrap px-2 py-1.5 text-[12.5px] text-foreground">{MESES_ABREV[linha.mes - 1]}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.anoAnt)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.anoAtual)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums ${linha.percCre != null && linha.percCre < 0 ? "text-destructive" : "text-success"}`}>
                    {fmtPct(linha.percCre)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.anoAntAc)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.anoAtualAc)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums ${linha.percAc != null && linha.percAc < 0 ? "text-destructive" : "text-success"}`}>
                    {fmtPct(linha.percAc)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.esperado)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-surface-2 font-semibold">
                <td className="whitespace-nowrap px-2 py-1.5 text-[12.5px] text-foreground">Total</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.anoAnt)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.anoAtual)}</td>
                <td
                  className={`whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums ${
                    dados.comparativoMensalTotal.percCre != null && dados.comparativoMensalTotal.percCre < 0 ? "text-destructive" : "text-success"
                  }`}
                >
                  {fmtPct(dados.comparativoMensalTotal.percCre)}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.anoAntAc)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.anoAtualAc)}</td>
                <td
                  className={`whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums ${
                    dados.comparativoMensalTotal.percAc != null && dados.comparativoMensalTotal.percAc < 0 ? "text-destructive" : "text-success"
                  }`}
                >
                  {fmtPct(dados.comparativoMensalTotal.percAc)}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.esperado)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-muted">
        Faturamento = soma dos itens de serviço/produto da NF de venda com situação "Fechada" (sitnfv=2). "Cresc. Últ. 5 anos" usa os 5 anos completos
        anteriores ao Ano Base (exclui o ano corrente, parcial). Colunas "Ac." acumulam de janeiro até o último mês com dado no Ano Base.
      </p>
    </>
  );
}
