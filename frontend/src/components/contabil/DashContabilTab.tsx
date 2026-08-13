import axios from "axios";
import { useEffect, useState } from "react";
import { KpiCard } from "../ui/KpiCard";
import { SerieTemporalBarra, SeriePonto } from "../ui/SerieTemporalBarra";
import { Skeleton } from "../ui/Skeleton";

interface DashContabilTabProps {
  ano: number;
  grupos: string[];
}

interface RespostaEvolucao {
  anoAtual: number;
  anoAnterior: number;
  kpis: {
    totalAtual: number;
    totalAnterior: number;
    variacaoPct: number | null;
    melhorGrupo: string | null;
    piorGrupo: string | null;
  };
  mensalYoY: { mes: number; atual: number; anterior: number }[];
  acumuladoPorGrupo: { grupo: string; valores: number[] }[];
}

const RESULTADO_VAZIO: RespostaEvolucao = {
  anoAtual: new Date().getFullYear(),
  anoAnterior: new Date().getFullYear() - 1,
  kpis: { totalAtual: 0, totalAnterior: 0, variacaoPct: null, melhorGrupo: null, piorGrupo: null },
  mensalYoY: [],
  acumuladoPorGrupo: [],
};

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const currency = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

export function DashContabilTab({ ano, grupos }: DashContabilTabProps) {
  const [evolucao, setEvolucao] = useState<RespostaEvolucao>(RESULTADO_VAZIO);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = { anos: String(ano) };
    if (grupos.length > 0) params.grupo = grupos.join(",");
    axios
      .get("/api/contabil/evolucao", { params })
      .then(({ data }) => {
        setEvolucao(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a evolução"))
      .finally(() => setLoading(false));
  }, [ano, grupos]);

  const pontos: SeriePonto[] = evolucao.mensalYoY.map((p) => ({
    label: MESES_ABREV[p.mes - 1],
    // Barras negativas não têm um bom desenho aqui (o componente assume valores positivos) —
    // mostra o valor absoluto na barra, o sinal real fica no tooltip via formatarValor.
    valores: [Math.abs(p.atual), Math.abs(p.anterior)],
  }));

  return (
    <div>
      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {loading ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-24" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={`Realizado ${evolucao.anoAtual}`}
              tone="primary"
              quantidade={0}
              total={1}
              valor={fmtMoney(evolucao.kpis.totalAtual)}
              rodape={`vs. ${fmtMoney(evolucao.kpis.totalAnterior)} em ${evolucao.anoAnterior}`}
            />
            <KpiCard
              label="Variação YoY"
              tone={evolucao.kpis.variacaoPct == null ? "neutral" : evolucao.kpis.variacaoPct >= 0 ? "success" : "destructive"}
              quantidade={0}
              total={1}
              valor={evolucao.kpis.variacaoPct == null ? "—" : `${evolucao.kpis.variacaoPct.toFixed(1)}%`}
              rodape={`${evolucao.anoAtual} vs. ${evolucao.anoAnterior}`}
            />
            <KpiCard
              label="Melhor grupo (acumulado)"
              tone="success"
              quantidade={0}
              total={1}
              valor={evolucao.kpis.melhorGrupo ?? "—"}
              rodape={`resultado acumulado em ${evolucao.anoAtual}`}
            />
            <KpiCard
              label="Grupo de atenção (acumulado)"
              tone="warning"
              quantidade={0}
              total={1}
              valor={evolucao.kpis.piorGrupo ?? "—"}
              rodape={`resultado acumulado em ${evolucao.anoAtual}`}
            />
          </div>

          <SerieTemporalBarra
            titulo={`Realizado mensal — ${evolucao.anoAtual} × ${evolucao.anoAnterior}`}
            pontos={pontos}
            series={[
              { nome: String(evolucao.anoAtual), cor: "primary" },
              { nome: String(evolucao.anoAnterior), cor: "muted" },
            ]}
            formatarValor={fmtMoney}
          />

          {evolucao.acumuladoPorGrupo.length > 0 && (
            <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="w-[200px] bg-surface-2 px-4 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                      Acumulado por grupo — {evolucao.anoAtual}
                    </th>
                    {MESES_ABREV.map((m) => (
                      <th key={m} className="min-w-[80px] px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {evolucao.acumuladoPorGrupo.map((linha) => (
                    <tr key={linha.grupo} className="border-b border-border/50">
                      <td className="w-[200px] px-4 py-1.5 text-[13px] text-foreground">{linha.grupo}</td>
                      {linha.valores.map((v, i) => (
                        <td
                          key={i}
                          className={`px-3 py-1.5 text-right font-mono text-[12.5px] tabular-nums ${
                            v < 0 ? "text-destructive" : "text-foreground"
                          }`}
                        >
                          {currency.format(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="mt-4 text-[11px] text-muted">
        Acumulado = soma corrente de janeiro até o mês (só {evolucao.anoAtual}). YoY compara o
        mesmo mês do ano anterior. Sem filtro de mês aqui: a evolução é sempre sobre o ano
        completo.
      </p>
    </div>
  );
}
