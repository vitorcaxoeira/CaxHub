import axios from "axios";
import { useState } from "react";
import { Pagination } from "../ui/Pagination";

export interface ClienteRiscoRow {
  codcli: number;
  nomcli: string;
  valorAberto: number;
  valorVencido: number;
  atrasoMedio: number;
  maiorAtraso: number;
  score: number;
}

interface TituloDrillDown {
  numtit: string;
  codtpt: string;
  vctpro: string;
  valor: number;
  diasAtraso: number;
  situacaoLabel: string;
  situacaoTone: "success" | "warning" | "destructive";
}

interface ClientesRiscoTableProps {
  rows: ClienteRiscoRow[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  sort: string;
  dir: "asc" | "desc";
  onSortChange: (sort: string, dir: "asc" | "desc") => void;
  empFilIds?: string;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const toneBadge: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

function toneScore(score: number): "success" | "warning" | "destructive" {
  if (score < 34) return "success";
  if (score <= 66) return "warning";
  return "destructive";
}

const COLUNAS: { chave: string; label: string; alinhar?: "right" }[] = [
  { chave: "nomcli", label: "Cliente" },
  { chave: "valorAberto", label: "Valor Aberto", alinhar: "right" },
  { chave: "valorVencido", label: "Valor Vencido", alinhar: "right" },
  { chave: "atrasoMedio", label: "Atraso Médio", alinhar: "right" },
  { chave: "maiorAtraso", label: "Maior Atraso", alinhar: "right" },
  { chave: "score", label: "Score", alinhar: "right" },
];

export function ClientesRiscoTable({
  rows,
  page,
  pageSize,
  total,
  loading,
  onPageChange,
  sort,
  dir,
  onSortChange,
  empFilIds,
}: ClientesRiscoTableProps) {
  const [expandido, setExpandido] = useState<number | null>(null);
  const [titulosPorCliente, setTitulosPorCliente] = useState<Map<number, TituloDrillDown[]>>(new Map());
  const [carregandoDrillDown, setCarregandoDrillDown] = useState(false);

  function handleSort(coluna: string) {
    if (coluna === "nomcli") return; // cliente não é ordenável no backend
    if (sort === coluna) {
      onSortChange(coluna, dir === "asc" ? "desc" : "asc");
    } else {
      onSortChange(coluna, "desc");
    }
  }

  function handleExpandir(codcli: number) {
    if (expandido === codcli) {
      setExpandido(null);
      return;
    }
    setExpandido(codcli);
    if (!titulosPorCliente.has(codcli)) {
      setCarregandoDrillDown(true);
      axios
        .get(`/api/financeiro/fluxo-caixa/clientes-risco/${codcli}/titulos`, { params: { empFil: empFilIds } })
        .then(({ data }) => {
          setTitulosPorCliente((atual) => new Map(atual).set(codcli, data.rows));
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
                  } ${col.chave !== "nomcli" ? "cursor-pointer select-none hover:text-foreground" : ""}`}
                >
                  {col.label}
                  {sort === col.chave && <span className="ml-1">{dir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <>
                <tr
                  key={row.codcli}
                  onClick={() => handleExpandir(row.codcli)}
                  className="cursor-pointer border-t border-border/60 transition hover:bg-surface-2"
                >
                  <td className="px-2 text-center text-muted">{expandido === row.codcli ? "▾" : "▸"}</td>
                  <td className="px-5 py-3.5 text-sm text-foreground">
                    {row.codcli} - {row.nomcli}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">{fmtMoney(row.valorAberto)}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-destructive">{fmtMoney(row.valorVencido)}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">{Math.round(row.atrasoMedio)} dias</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">{row.maiorAtraso} dias</td>
                  <td className="px-5 py-3.5 text-right">
                    <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-semibold ${toneBadge[toneScore(row.score)]}`}>
                      {row.score}
                    </span>
                  </td>
                </tr>
                {expandido === row.codcli && (
                  <tr key={`${row.codcli}-detalhe`} className="border-t border-border/60 bg-surface-2/40">
                    <td colSpan={COLUNAS.length + 1} className="px-5 py-3">
                      {carregandoDrillDown && !titulosPorCliente.has(row.codcli) ? (
                        <p className="text-[11.5px] text-muted">Carregando títulos...</p>
                      ) : (
                        <table className="w-full border-collapse text-[12.5px]">
                          <thead>
                            <tr className="text-left text-muted">
                              <th className="pb-1.5 pr-4 font-medium">Título</th>
                              <th className="pb-1.5 pr-4 font-medium">Vencimento</th>
                              <th className="pb-1.5 pr-4 text-right font-medium">Valor</th>
                              <th className="pb-1.5 pr-4 text-right font-medium">Dias Atraso</th>
                              <th className="pb-1.5 font-medium">Situação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(titulosPorCliente.get(row.codcli) ?? []).map((t) => (
                              <tr key={`${t.numtit}-${t.codtpt}`} className="border-t border-border/40">
                                <td className="py-1.5 pr-4 font-mono text-foreground">
                                  {t.numtit} - {t.codtpt}
                                </td>
                                <td className="py-1.5 pr-4 font-mono text-muted">{dateFormatter.format(new Date(t.vctpro))}</td>
                                <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-foreground">{fmtMoney(t.valor)}</td>
                                <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-destructive">{t.diasAtraso}</td>
                                <td className="py-1.5">
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneBadge[t.situacaoTone]}`}>
                                    {t.situacaoLabel}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={COLUNAS.length + 1} className="px-5 py-8 text-center text-sm text-muted">
                  Nenhum cliente em risco encontrado com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={onPageChange} label="clientes" />
    </div>
  );
}
