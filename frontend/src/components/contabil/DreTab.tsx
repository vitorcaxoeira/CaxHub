import axios from "axios";
import { useEffect, useState } from "react";
import { Skeleton } from "../ui/Skeleton";

interface DreTabProps {
  anos: number[];
  meses: number[];
  grupos: string[];
  centrosCusto: string[];
}

interface LinhaBucket {
  chave: string;
  rotulo: string;
  valores: number[];
  total: number;
}

interface LinhaPorGrupo {
  grupo: string;
  valores: number[];
  total: number;
}

interface RespostaDre {
  meses: string[];
  buckets: LinhaBucket[];
  resultado: { valores: number[]; total: number };
  margemPct: (number | null)[];
  porGrupo: LinhaPorGrupo[];
}

const RESULTADO_VAZIO: RespostaDre = { meses: [], buckets: [], resultado: { valores: [], total: 0 }, margemPct: [], porGrupo: [] };

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function formatarMes(mes: string): string {
  const [ano, mesNum] = mes.split("-");
  return `${MESES_ABREV[Number(mesNum) - 1]}/${ano.slice(2)}`;
}

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
function Valor({ v }: { v: number }) {
  return <span className={`font-mono text-[12.5px] tabular-nums ${v < 0 ? "text-destructive" : "text-foreground"}`}>{numero.format(v)}</span>;
}

export function DreTab({ anos, meses, grupos, centrosCusto }: DreTabProps) {
  const [dre, setDre] = useState<RespostaDre>(RESULTADO_VAZIO);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (anos.length === 0) return;
    setLoading(true);
    const params: Record<string, string> = { anos: anos.join(",") };
    if (meses.length > 0) params.meses = meses.join(",");
    if (grupos.length > 0) params.grupo = grupos.join(",");
    if (centrosCusto.length > 0) params.codccu = centrosCusto.join(",");
    axios
      .get("/api/contabil/dre", { params })
      .then(({ data }) => {
        setDre(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar o DRE"))
      .finally(() => setLoading(false));
  }, [anos, meses, grupos, centrosCusto]);

  if (anos.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
        Selecione ao menos um ano pra ver o DRE.
      </p>
    );
  }

  return (
    <div>
      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {loading ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="sticky left-0 z-10 w-[260px] bg-surface-2 px-4 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                  DRE Gerencial
                </th>
                {dre.meses.map((mes) => (
                  <th key={mes} className="min-w-[92px] px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                    {formatarMes(mes)}
                  </th>
                ))}
                <th className="min-w-[100px] px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Total</th>
              </tr>
            </thead>
            <tbody>
              {dre.buckets.map((linha) => (
                <tr key={linha.chave} className="border-b border-border/50">
                  <td className="sticky left-0 z-10 w-[260px] bg-surface px-4 py-1.5 text-[13px] text-foreground">{linha.rotulo}</td>
                  {linha.valores.map((v, i) => (
                    <td key={i} className="px-3 py-1.5 text-right">
                      <Valor v={v} />
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right">
                    <Valor v={linha.total} />
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-surface-2">
                <td className="sticky left-0 z-10 w-[260px] bg-surface-2 px-4 py-2 font-semibold text-[13px] text-foreground">Resultado</td>
                {dre.resultado.valores.map((v, i) => (
                  <td key={i} className="px-3 py-2 text-right">
                    <Valor v={v} />
                  </td>
                ))}
                <td className="px-3 py-2 text-right">
                  <Valor v={dre.resultado.total} />
                </td>
              </tr>
              <tr>
                <td className="sticky left-0 z-10 w-[260px] bg-surface px-4 py-1.5 text-[11.5px] italic text-muted">Margem %</td>
                {dre.margemPct.map((v, i) => (
                  <td key={i} className="px-3 py-1.5 text-right font-mono text-[11.5px] italic text-muted">
                    {v == null ? "—" : `${v.toFixed(1)}%`}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!loading && dre.porGrupo.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="w-[260px] bg-surface-2 px-4 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                  Resultado por grupo
                </th>
                {dre.meses.map((mes) => (
                  <th key={mes} className="min-w-[92px] px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                    {formatarMes(mes)}
                  </th>
                ))}
                <th className="min-w-[100px] px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">Total</th>
              </tr>
            </thead>
            <tbody>
              {dre.porGrupo.map((linha) => (
                <tr key={linha.grupo} className="border-b border-border/50">
                  <td className="w-[260px] px-4 py-1.5 text-[13px] text-foreground">{linha.grupo}</td>
                  {linha.valores.map((v, i) => (
                    <td key={i} className="px-3 py-1.5 text-right">
                      <Valor v={v} />
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right">
                    <Valor v={linha.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[11px] text-muted">
        Receitas/Despesas são o mesmo bucket (defgru) usado na Matriz. Resultado = soma de todos os
        buckets no período; Margem % = Resultado / Receitas (— quando não há receita no recorte).
      </p>
    </div>
  );
}
