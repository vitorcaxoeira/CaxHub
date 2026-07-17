import axios from "axios";
import { Fragment, useState } from "react";
import { Pagination } from "../ui/Pagination";

export interface RepresentanteRow {
  codrep: number;
  nomrep: string;
  propostasAbertas: number;
  valorPipeline: number;
  winRatePct: number | null;
  cicloMedioDias: number | null;
}

interface PropostaAbertaDrillDown {
  codpro: number;
  codcli: number;
  nomcli: string;
  datpro: string | null;
  valor: number;
  situacaoLabel: string;
  situacaoTone: "success" | "warning" | "destructive" | "neutral";
}

interface RankingRepresentantesProps {
  rows: RepresentanteRow[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  sort: string;
  dir: "asc" | "desc";
  onSortChange: (sort: string, dir: "asc" | "desc") => void;
  empFiltroParams: Record<string, string | undefined>;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const toneBadge: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

const COLUNAS: { chave: string; label: string; alinhar?: "right" }[] = [
  { chave: "nomrep", label: "Representante" },
  { chave: "propostasAbertas", label: "Propostas Abertas", alinhar: "right" },
  { chave: "valorPipeline", label: "Valor Pipeline", alinhar: "right" },
  { chave: "winRate", label: "Win Rate", alinhar: "right" },
  { chave: "cicloMedio", label: "Ciclo Médio", alinhar: "right" },
];

export function RankingRepresentantes({
  rows,
  page,
  pageSize,
  total,
  loading,
  onPageChange,
  sort,
  dir,
  onSortChange,
  empFiltroParams,
}: RankingRepresentantesProps) {
  const [expandido, setExpandido] = useState<number | null>(null);
  const [propostasPorRep, setPropostasPorRep] = useState<Map<number, PropostaAbertaDrillDown[]>>(new Map());
  const [carregandoDrillDown, setCarregandoDrillDown] = useState(false);

  function handleSort(coluna: string) {
    if (coluna === "nomrep") return;
    if (sort === coluna) {
      onSortChange(coluna, dir === "asc" ? "desc" : "asc");
    } else {
      onSortChange(coluna, "desc");
    }
  }

  function handleExpandir(codrep: number) {
    if (expandido === codrep) {
      setExpandido(null);
      return;
    }
    setExpandido(codrep);
    if (!propostasPorRep.has(codrep)) {
      setCarregandoDrillDown(true);
      axios
        .get(`/api/projetos/propostas/representantes-ranking/${codrep}/propostas-abertas`, { params: empFiltroParams })
        .then(({ data }) => {
          setPropostasPorRep((atual) => new Map(atual).set(codrep, data.rows));
        })
        .catch(() => {})
        .finally(() => setCarregandoDrillDown(false));
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-8 bg-surface-2" />
              {COLUNAS.map((col) => (
                <th
                  key={col.chave}
                  onClick={() => handleSort(col.chave)}
                  className={`bg-surface-2 px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-muted ${
                    col.alinhar === "right" ? "text-right" : "text-left"
                  } ${col.chave !== "nomrep" ? "cursor-pointer select-none hover:text-foreground" : ""}`}
                >
                  {col.label}
                  {sort === col.chave && <span className="ml-1">{dir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.codrep}>
                <tr
                  onClick={() => handleExpandir(row.codrep)}
                  className="cursor-pointer border-t border-border/60 transition hover:bg-surface-2"
                >
                  <td className="px-2 text-center text-muted">{expandido === row.codrep ? "▾" : "▸"}</td>
                  <td className="px-5 py-3.5 text-sm text-foreground">{row.nomrep}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
                    {row.propostasAbertas.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">{fmtMoney(row.valorPipeline)}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
                    {row.winRatePct === null ? "—" : `${row.winRatePct.toFixed(1)}%`}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                    {row.cicloMedioDias === null ? "—" : `${Math.round(row.cicloMedioDias)} dias`}
                  </td>
                </tr>
                {expandido === row.codrep && (
                  <tr key={`${row.codrep}-detalhe`} className="border-t border-border/60 bg-surface-2/40">
                    <td colSpan={COLUNAS.length + 1} className="px-5 py-3">
                      {carregandoDrillDown && !propostasPorRep.has(row.codrep) ? (
                        <p className="text-[11.5px] text-muted">Carregando propostas...</p>
                      ) : (
                        <table className="w-full border-collapse text-[12.5px]">
                          <thead>
                            <tr className="text-left text-muted">
                              <th className="pb-1.5 pr-4 font-medium">Proposta</th>
                              <th className="pb-1.5 pr-4 font-medium">Cliente</th>
                              <th className="pb-1.5 pr-4 font-medium">Data</th>
                              <th className="pb-1.5 pr-4 text-right font-medium">Valor</th>
                              <th className="pb-1.5 font-medium">Situação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(propostasPorRep.get(row.codrep) ?? []).map((p) => (
                              <tr key={p.codpro} className="border-t border-border/40">
                                <td className="py-1.5 pr-4 font-mono text-foreground">{p.codpro}</td>
                                <td className="py-1.5 pr-4 text-foreground">
                                  {p.codcli} - {p.nomcli}
                                </td>
                                <td className="py-1.5 pr-4 font-mono text-muted">{p.datpro ? dateFormatter.format(new Date(p.datpro)) : "—"}</td>
                                <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-foreground">{fmtMoney(p.valor)}</td>
                                <td className="py-1.5">
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneBadge[p.situacaoTone]}`}>
                                    {p.situacaoLabel}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {(propostasPorRep.get(row.codrep) ?? []).length === 0 && (
                              <tr>
                                <td colSpan={5} className="py-2 text-center text-muted">
                                  Sem propostas abertas.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={COLUNAS.length + 1} className="px-5 py-8 text-center text-sm text-muted">
                  Nenhum representante encontrado com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={onPageChange} label="representantes" />
    </div>
  );
}
