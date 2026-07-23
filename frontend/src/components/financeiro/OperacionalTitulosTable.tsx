import axios from "axios";
import { useEffect, useState } from "react";
import { Pagination } from "../ui/Pagination";
import { Skeleton } from "../ui/Skeleton";

export interface OperacionalRow {
  numtit: string;
  codtpt: string;
  codcli: number;
  nomcli: string;
  datemi: string;
  vctpro: string;
  valor: number;
  diasAtraso: number;
  situacaoLabel: string;
  situacaoTone: "success" | "warning" | "destructive";
}

interface OperacionalTitulosTableProps {
  rows: OperacionalRow[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  onBuscaChange: (q: string) => void;
  corte: string;
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

export function OperacionalTitulosTable({
  rows,
  page,
  pageSize,
  total,
  loading,
  onPageChange,
  onBuscaChange,
  corte,
  empFilIds,
}: OperacionalTitulosTableProps) {
  const [query, setQuery] = useState("");
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => onBuscaChange(query), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function handleExportar() {
    setExportando(true);
    try {
      const { data } = await axios.get("/api/financeiro/fluxo-caixa/operacional/titulos", {
        params: { corte, empFil: empFilIds, q: query || undefined, formato: "csv" },
        responseType: "blob",
      });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fluxo-caixa-${corte}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por cliente ou número do título..."
          className="min-w-[240px] flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          onClick={handleExportar}
          disabled={exportando || total === 0}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-[11.5px] font-medium text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {exportando ? "Exportando..." : "Exportar CSV"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="whitespace-nowrap bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Título
              </th>
              <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Cliente
              </th>
              <th className="hidden whitespace-nowrap bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                Emissão
              </th>
              <th className="whitespace-nowrap bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Vencimento
              </th>
              <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Valor
              </th>
              <th className="hidden bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                Dias Atraso
              </th>
              <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-5 py-3.5">
                    <Skeleton className="h-4 w-20" />
                  </td>
                  <td className="px-5 py-3.5">
                    <Skeleton className="h-4 w-36" />
                  </td>
                  <td className="hidden px-5 py-3.5 sm:table-cell">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="px-5 py-3.5">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Skeleton className="ml-auto h-4 w-20" />
                  </td>
                  <td className="hidden px-5 py-3.5 text-right md:table-cell">
                    <Skeleton className="ml-auto h-4 w-8" />
                  </td>
                  <td className="px-5 py-3.5">
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </td>
                </tr>
              ))}
            {!loading &&
              rows.map((row, i) => (
              <tr key={`${row.numtit}-${row.codtpt}-${i}`} className="border-t border-border/60 transition hover:bg-surface-2">
                <td className="whitespace-nowrap px-5 py-3.5 font-mono text-sm text-muted">
                  {row.numtit} - {row.codtpt}
                </td>
                <td className="px-5 py-3.5 text-sm text-foreground">
                  {row.codcli} - {row.nomcli}
                </td>
                <td className="hidden whitespace-nowrap px-5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                  {dateFormatter.format(new Date(row.datemi))}
                </td>
                <td className="whitespace-nowrap px-5 py-3.5 font-mono text-sm text-muted">
                  {dateFormatter.format(new Date(row.vctpro))}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                  {fmtMoney(row.valor)}
                </td>
                <td className="hidden px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted md:table-cell">
                  {row.diasAtraso}
                </td>
                <td className="px-5 py-3.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneBadge[row.situacaoTone]}`}>
                    {row.situacaoLabel}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                  Nenhum título encontrado com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={onPageChange} label="títulos" />
    </div>
  );
}
