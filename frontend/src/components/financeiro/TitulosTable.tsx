import { Skeleton } from "../ui/Skeleton";

export interface TituloRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  abrtpt: string;
  codcli: number;
  nomcli: string;
  nomemp: string;
  nomfil: string;
  datemi: string;
  vctpro: string;
  vlrori: number;
  vlrabe: number;
  sittit: string;
  dias_atraso: number;
  situacaoLabel: string;
  situacaoTone: "success" | "warning" | "destructive";
}

interface TitulosTableProps {
  rows: TituloRow[];
  page: number;
  pageSize: number;
  total: number;
  totalVencido: number;
  totalAVencer: number;
  totalPago: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const toneTag: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

export function TitulosTable({
  rows,
  page,
  pageSize,
  total,
  totalVencido,
  totalAVencer,
  totalPago,
  loading,
  onPageChange,
}: TitulosTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="whitespace-nowrap bg-surface-2 px-3 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Emp./Fil.
              </th>
              <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                Título
              </th>
              <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Cliente
              </th>
              <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                Emissão
              </th>
              <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                Vencimento
              </th>
              <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Valor Original
              </th>
              <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Valor em Aberto
              </th>
              <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-3 py-3.5">
                    <Skeleton className="h-4 w-10" />
                  </td>
                  <td className="hidden px-5 py-3.5 sm:table-cell">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="px-5 py-3.5">
                    <Skeleton className="h-4 w-36" />
                  </td>
                  <td className="hidden px-5 py-3.5 sm:table-cell">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="hidden px-5 py-3.5 sm:table-cell">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Skeleton className="ml-auto h-4 w-20" />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Skeleton className="ml-auto h-4 w-20" />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Skeleton className="ml-auto h-5 w-16 rounded" />
                  </td>
                </tr>
              ))}
            {!loading &&
              rows.map((row) => (
              <tr key={`${row.codemp}-${row.codfil}-${row.numtit}-${row.codtpt}`} className="border-t border-border/60 transition hover:bg-surface-2">
                <td className="whitespace-nowrap px-3 py-3.5 font-mono text-sm text-muted">
                  {row.codemp}/{row.codfil}
                </td>
                <td className="hidden whitespace-nowrap px-5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                  {row.numtit}·{row.abrtpt}
                </td>
                <td className="px-5 py-3.5">
                  <div className="text-sm font-semibold text-foreground">
                    {row.codcli} - {row.nomcli}
                  </div>
                </td>
                <td className="hidden px-5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                  {dateFormatter.format(new Date(row.datemi))}
                </td>
                <td className="hidden px-5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                  {dateFormatter.format(new Date(row.vctpro))}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                  {currencyFormatter.format(row.vlrori)}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                  {currencyFormatter.format(row.vlrabe)}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <span
                    className={`inline-block whitespace-nowrap rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                      toneTag[row.situacaoTone]
                    }`}
                  >
                    {row.situacaoLabel}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted">
                  Nenhum título encontrado com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-px border-t border-border bg-border sm:grid-cols-3">
        <div className="bg-surface px-5 py-3">
          <p className="text-[10.5px] text-muted">Total Vencido (filtro atual)</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-destructive">
            R$ {currencyFormatter.format(totalVencido)}
          </p>
        </div>
        <div className="bg-surface px-5 py-3">
          <p className="text-[10.5px] text-muted">Total A Vencer (filtro atual)</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-success">
            R$ {currencyFormatter.format(totalAVencer)}
          </p>
        </div>
        <div className="bg-surface px-5 py-3">
          <p className="text-[10.5px] text-muted">Total Pago (filtro atual)</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
            R$ {currencyFormatter.format(totalPago)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border px-5 py-3">
        <p className="text-[11.5px] text-muted">
          {total.toLocaleString("pt-BR")} títulos · página {page} de {totalPages}
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
