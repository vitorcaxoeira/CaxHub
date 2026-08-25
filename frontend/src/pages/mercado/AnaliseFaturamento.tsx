import axios from "axios";
import { useEffect, useState } from "react";
import { KpiCard, KpiTone } from "../../components/ui/KpiCard";
import { Skeleton } from "../../components/ui/Skeleton";
import { GaugeChart } from "../../components/ui/GaugeChart";
import { EvolucaoFaturamentoChart, PontoEvolucaoAnual } from "../../components/mercado/EvolucaoFaturamentoChart";

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

export function AnaliseFaturamento() {
  const [anosDisponiveis, setAnosDisponiveis] = useState<number[]>([]);
  const [anoBase, setAnoBase] = useState<number>(new Date().getFullYear());
  const [dados, setDados] = useState<DashboardResposta | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get("/api/analise-faturamento/opcoes-filtro")
      .then(({ data }) => {
        const anos: number[] = data.anos ?? [];
        setAnosDisponiveis(anos);
        if (anos.length > 0) setAnoBase((atual) => (anos.includes(atual) ? atual : anos[0]));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    axios
      .get("/api/analise-faturamento/dashboard", { params: { ano: anoBase } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a análise de faturamento"))
      .finally(() => setLoading(false));
  }, [anoBase]);

  const anosTabela = dados?.evolucaoAnual.map((e) => e.ano) ?? [];

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Mercado · Análise de Faturamento</p>
          <h1 className="font-display text-2xl font-bold text-foreground">Análise de Faturamento</h1>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Ano Base
          <select
            value={anoBase}
            onChange={(e) => setAnoBase(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(anosDisponiveis.includes(anoBase) ? anosDisponiveis : [anoBase, ...anosDisponiveis]).map((ano) => (
              <option key={ano} value={ano}>
                {ano}
              </option>
            ))}
          </select>
        </label>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>
      )}

      {loading || !dados ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      ) : (
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Mês</th>
                    {anosTabela.map((ano) => (
                      <th key={ano} className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                        {ano}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.tabelaMensal.map((linha) => (
                    <tr key={linha.mes} className="border-b border-border/50">
                      <td className="px-3 py-1.5 text-[12.5px] text-foreground">{MESES_ABREV[linha.mes - 1]}</td>
                      {anosTabela.map((ano) => (
                        <td key={ano} className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                          {fmtNumero(linha.valoresPorAno[String(ano)] ?? 0)}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-mono text-[12px] font-medium tabular-nums text-foreground">{fmtNumero(linha.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-surface-2 font-semibold">
                    <td className="px-3 py-1.5 text-[12.5px] text-foreground">Total</td>
                    {anosTabela.map((ano) => (
                      <td key={ano} className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                        {fmtNumero(dados.tabelaMensalTotal.valoresPorAno[String(ano)] ?? 0)}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.tabelaMensalTotal.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Mês</th>
                    <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">$ Ano Ant.</th>
                    <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">$ Ano Atual</th>
                    <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">% Cre.</th>
                    <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">$ Ano Ant. Ac.</th>
                    <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">$ Ano Atual Ac.</th>
                    <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">% Ac.</th>
                    <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">$ Esperado</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.comparativoMensal.map((linha) => (
                    <tr key={linha.mes} className="border-b border-border/50">
                      <td className="px-3 py-1.5 text-[12.5px] text-foreground">{MESES_ABREV[linha.mes - 1]}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.anoAnt)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.anoAtual)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono text-[12px] tabular-nums ${linha.percCre != null && linha.percCre < 0 ? "text-destructive" : "text-success"}`}>
                        {fmtPct(linha.percCre)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.anoAntAc)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.anoAtualAc)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono text-[12px] tabular-nums ${linha.percAc != null && linha.percAc < 0 ? "text-destructive" : "text-success"}`}>
                        {fmtPct(linha.percAc)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.esperado)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-surface-2 font-semibold">
                    <td className="px-3 py-1.5 text-[12.5px] text-foreground">Total</td>
                    <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.anoAnt)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.anoAtual)}</td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono text-[12px] tabular-nums ${
                        dados.comparativoMensalTotal.percCre != null && dados.comparativoMensalTotal.percCre < 0 ? "text-destructive" : "text-success"
                      }`}
                    >
                      {fmtPct(dados.comparativoMensalTotal.percCre)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.anoAntAc)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.anoAtualAc)}</td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono text-[12px] tabular-nums ${
                        dados.comparativoMensalTotal.percAc != null && dados.comparativoMensalTotal.percAc < 0 ? "text-destructive" : "text-success"
                      }`}
                    >
                      {fmtPct(dados.comparativoMensalTotal.percAc)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(dados.comparativoMensalTotal.esperado)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-4 text-[11px] text-muted">
            Faturamento = soma dos rateios de NF de venda com situação "Fechada" (sitnfv=2). "Cresc. Últ. 5 anos" usa os 5 anos completos
            anteriores ao Ano Base (exclui o ano corrente, parcial). Colunas "Ac." acumulam de janeiro até o último mês com dado no Ano Base.
          </p>
        </>
      )}
    </div>
  );
}
