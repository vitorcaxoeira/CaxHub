import { Skeleton } from "../ui/Skeleton";

export interface RecebimentoRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  codcli: number;
  nomcli: string;
  datpgt: string;
  vlrliq: number;
  codpor: string | null;
  despor: string | null;
  descco: string | null;
}

interface RecebimentosTableProps {
  rows: RecebimentoRow[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function RecebimentosTable({ rows, page, pageSize, total, loading, onPageChange }: RecebimentosTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="whitespace-nowrap bg-surface-2 px-3 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Data
              </th>
              <th className="hidden whitespace-nowrap bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                Título
              </th>
              <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Cliente
              </th>
              <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                Portador
              </th>
              <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                Conta
              </th>
              <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-3 py-3.5">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="hidden px-5 py-3.5 sm:table-cell">
                    <Skeleton className="h-4 w-20" />
                  </td>
                  <td className="px-5 py-3.5">
                    <Skeleton className="h-4 w-36" />
                  </td>
                  <td className="hidden px-5 py-3.5 md:table-cell">
                    <Skeleton className="h-4 w-20" />
                  </td>
                  <td className="hidden px-5 py-3.5 md:table-cell">
                    <Skeleton className="h-4 w-20" />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Skeleton className="ml-auto h-4 w-20" />
                  </td>
                </tr>
              ))}
            {!loading &&
              rows.map((row, i) => (
              <tr key={`${row.codemp}-${row.codfil}-${row.numtit}-${i}`} className="border-t border-border/60 transition hover:bg-surface-2">
                <td className="whitespace-nowrap px-3 py-3.5 font-mono text-sm text-muted">
                  {dateFormatter.format(new Date(row.datpgt))}
                </td>
                <td className="hidden whitespace-nowrap px-5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                  {row.numtit} - {row.codtpt}
                </td>
                <td className="px-5 py-3.5 text-sm text-foreground">
                  {row.codcli} - {row.nomcli}
                </td>
                <td className="hidden px-5 py-3.5 text-sm text-muted md:table-cell">{row.despor ?? "—"}</td>
                <td className="hidden px-5 py-3.5 text-sm text-muted md:table-cell">{row.descco ?? "—"}</td>
                <td className="px-5 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                  {currency.format(row.vlrliq)}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                  Nenhum recebimento encontrado com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-5 py-3">
        <p className="text-[11.5px] text-muted">
          {total.toLocaleString("pt-BR")} recebimentos · página {page} de {totalPages}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="rounded-md border border-border px-3 py-1.5 text-[11.5px] text-muted transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="rounded-md border border-border px-3 py-1.5 text-[11.5px] text-muted transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
