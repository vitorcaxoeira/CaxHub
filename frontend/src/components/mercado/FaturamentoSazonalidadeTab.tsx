import axios from "axios";
import { useEffect, useState } from "react";
import { Skeleton } from "../ui/Skeleton";
import { SerieTemporalBarra } from "../ui/SerieTemporalBarra";

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const currency = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtNumero = (v: number) => v.toLocaleString("pt-BR");

interface PontoIndice {
  mes: number;
  indice: number;
}

interface PontoAno {
  ano: number;
  nfs: number;
  clientesAtivos: number;
  ticketMedioNf: number;
}

interface SazonalidadeResposta {
  anoBase: number;
  indiceSazonal: PontoIndice[];
  porAno: PontoAno[];
}

export function FaturamentoSazonalidadeTab({ ano }: { ano: number }) {
  const [dados, setDados] = useState<SazonalidadeResposta | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios
      .get("/api/analise-faturamento/sazonalidade", { params: { ano } })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar sazonalidade"))
      .finally(() => setLoading(false));
  }, [ano]);

  if (erro) {
    return <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>;
  }

  if (loading || !dados) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <Skeleton className="mb-3 h-3.5 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <SerieTemporalBarra
          titulo="Índice Sazonal (100 = mês médio, últimos 5 anos completos)"
          pontos={dados.indiceSazonal.map((p) => ({ label: MESES_ABREV[p.mes - 1], valores: [p.indice] }))}
          series={[{ nome: "Índice", cor: "primary" }]}
          formatarValor={(v) => v.toFixed(0)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <p className="px-4 pt-4 font-mono text-[10px] uppercase tracking-widest text-muted">Métricas Operacionais por Ano</p>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Ano</th>
              <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Nº de NFs</th>
              <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Clientes Ativos</th>
              <th className="px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Ticket Médio / NF</th>
            </tr>
          </thead>
          <tbody>
            {dados.porAno.map((linha) => (
              <tr key={linha.ano} className="border-b border-border/50">
                <td className="px-3 py-1.5 text-[12.5px] text-foreground">{linha.ano}</td>
                <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.nfs)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtNumero(linha.clientesAtivos)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{fmtMoney(linha.ticketMedioNf)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11px] text-muted">
        Índice sazonal usa a média de cada mês nos 5 anos completos anteriores ao Ano Base (exclui o ano corrente, parcial) sobre a média mensal
        geral do período — acima de 100 é alta temporada, abaixo é baixa. A tabela de métricas operacionais inclui o Ano Base (parcial).
      </p>
    </>
  );
}
