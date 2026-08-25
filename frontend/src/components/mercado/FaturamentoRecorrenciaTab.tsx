import axios from "axios";
import { useEffect, useState } from "react";
import { KpiCard, KpiTone } from "../ui/KpiCard";
import { Skeleton } from "../ui/Skeleton";
import { SerieTemporalBarra } from "../ui/SerieTemporalBarra";

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const currency = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);

interface PontoAno {
  ano: number;
  recorrente: number;
  avulso: number;
  pctRecorrente: number | null;
}

interface PontoMes {
  mes: number;
  recorrente: number;
  avulso: number;
}

interface RecorrenciaResposta {
  anoBase: number;
  porAno: PontoAno[];
  mensalAnoBase: PontoMes[];
}

function toneRecorrencia(pct: number | null): KpiTone {
  if (pct == null) return "neutral";
  if (pct >= 70) return "success";
  if (pct >= 50) return "warning";
  return "destructive";
}

export function FaturamentoRecorrenciaTab({ ano }: { ano: number }) {
  const [dados, setDados] = useState<RecorrenciaResposta | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios
      .get("/api/analise-faturamento/recorrencia", { params: { ano } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar recorrência"))
      .finally(() => setLoading(false));
  }, [ano]);

  if (erro) {
    return <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>;
  }

  if (loading || !dados) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-5">
            <Skeleton className="mb-2 h-3.5 w-24" />
            <Skeleton className="h-6 w-28" />
          </div>
        ))}
      </div>
    );
  }

  const anoAtual = dados.porAno.find((p) => p.ano === dados.anoBase) ?? null;
  const totalRecorrente = anoAtual?.recorrente ?? 0;
  const totalAvulso = anoAtual?.avulso ?? 0;

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="% Recorrente (Ano Base)"
          tone={toneRecorrencia(anoAtual?.pctRecorrente ?? null)}
          quantidade={Math.round(anoAtual?.pctRecorrente ?? 0)}
          total={100}
          valor={fmtPct(anoAtual?.pctRecorrente ?? null)}
          rodape="Faturamento com NF vinculada a contrato"
        />
        <KpiCard label="Faturamento Recorrente" tone="primary" quantidade={0} total={1} valor={fmtMoney(totalRecorrente)} rodape="Com contrato (numctr)" />
        <KpiCard label="Faturamento Avulso" tone="neutral" quantidade={0} total={1} valor={fmtMoney(totalAvulso)} rodape="Sem contrato vinculado" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SerieTemporalBarra
          titulo="Recorrente x Avulso — por Ano"
          pontos={dados.porAno.map((p) => ({ label: String(p.ano), valores: [p.recorrente, p.avulso] }))}
          series={[
            { nome: "Recorrente", cor: "primary" },
            { nome: "Avulso", cor: "muted" },
          ]}
          formatarValor={fmtMoney}
        />
        <SerieTemporalBarra
          titulo={`Recorrente x Avulso — Mensal (${dados.anoBase})`}
          pontos={dados.mensalAnoBase.map((p) => ({ label: MESES_ABREV[p.mes - 1], valores: [p.recorrente, p.avulso] }))}
          series={[
            { nome: "Recorrente", cor: "primary" },
            { nome: "Avulso", cor: "muted" },
          ]}
          formatarValor={fmtMoney}
        />
      </div>

      <p className="mt-4 text-[11px] text-muted">
        "Recorrente" = itens de NF vinculados a um contrato (numctr preenchido); o restante é considerado "Avulso". Migração de receita: a
        participação recorrente vem subindo ano a ano.
      </p>
    </>
  );
}
