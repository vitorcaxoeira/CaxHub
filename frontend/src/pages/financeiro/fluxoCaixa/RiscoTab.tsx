import axios from "axios";
import { useEffect, useState } from "react";
import { AgingBucketsChart, AgingBucket } from "../../../components/financeiro/AgingBucketsChart";
import { DonutChart, DonutItem } from "../../../components/ui/DonutChart";
import { ClientesRiscoTable } from "../../../components/financeiro/ClientesRiscoTable";

const API_BASE = "/api/financeiro/fluxo-caixa";

interface RiscoTabProps {
  empFilIds?: string;
  refreshKey: number;
}

export function RiscoTab({ empFilIds, refreshKey }: RiscoTabProps) {
  const [buckets, setBuckets] = useState<AgingBucket[]>([]);
  const [erroAging, setErroAging] = useState<string | null>(null);
  const [loadingAging, setLoadingAging] = useState(true);
  const [bucketSelecionado, setBucketSelecionado] = useState<string | null>(null);

  const [concentracao, setConcentracao] = useState<{ top5: DonutItem[]; demais: DonutItem; alerta: boolean } | null>(null);
  const [erroConcentracao, setErroConcentracao] = useState<string | null>(null);
  const [loadingConcentracao, setLoadingConcentracao] = useState(true);


  useEffect(() => {
    setLoadingAging(true);
    axios
      .get(`${API_BASE}/aging`, { params: { empFil: empFilIds } })
      .then(({ data }) => {
        setBuckets(data.buckets);
        setErroAging(null);
      })
      .catch((err) => setErroAging(err.response?.data?.error ?? "Falha ao carregar o aging"))
      .finally(() => setLoadingAging(false));
  }, [empFilIds, refreshKey]);

  useEffect(() => {
    setLoadingConcentracao(true);
    axios
      .get(`${API_BASE}/concentracao`, { params: { empFil: empFilIds } })
      .then(({ data }) => {
        setConcentracao({
          top5: data.top5.map((r: { codcli: number; nomcli: string; valor: number; pct: number }) => ({
            chave: r.codcli,
            nome: r.nomcli,
            valor: r.valor,
            pct: r.pct,
          })),
          demais: { chave: "demais", nome: "Demais clientes", valor: data.demais.valor, pct: data.demais.pct },
          alerta: data.alertaConcentracao,
        });
        setErroConcentracao(null);
      })
      .catch((err) => setErroConcentracao(err.response?.data?.error ?? "Falha ao carregar a concentração"))
      .finally(() => setLoadingConcentracao(false));
  }, [empFilIds, refreshKey]);

  function handleSelectBucket(bucket: string | null) {
    setBucketSelecionado(bucket);
  }

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          {erroAging ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">{erroAging}</div>
          ) : loadingAging && buckets.length === 0 ? (
            <p className="text-sm text-muted">Carregando aging...</p>
          ) : (
            <AgingBucketsChart buckets={buckets} selecionado={bucketSelecionado} onSelectBucket={handleSelectBucket} />
          )}
        </div>

        <div>
          {erroConcentracao ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
              {erroConcentracao}
            </div>
          ) : loadingConcentracao && !concentracao ? (
            <p className="text-sm text-muted">Carregando concentração...</p>
          ) : (
            concentracao && (
              <DonutChart
                titulo="Concentração de carteira (top 5 vs. demais)"
                itens={[...concentracao.top5, concentracao.demais]}
                alerta={concentracao.alerta ? "Um único cliente concentra mais de 25% da carteira em aberto." : undefined}
              />
            )
          )}
        </div>
      </div>

      <ClientesRiscoTable url={`${API_BASE}/clientes-risco`} params={{ empFil: empFilIds, bucket: bucketSelecionado ?? undefined }} empFilIds={empFilIds} recarga={refreshKey} />
    </div>
  );
}
