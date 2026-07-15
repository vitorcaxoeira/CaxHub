export interface PropostaRow {
  codemp: number;
  codpro: number;
  codcli: number;
  nomcli: string;
  datpro: string | null;
  sitpro: number | null;
  numprj: number | null;
  valor: number;
  pripro: number | null;
  gerente: string;
  situacaoLabel: string;
  situacaoTone: "success" | "warning" | "destructive" | "neutral";
}

interface PropostasTableProps {
  rows: PropostaRow[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toneTag: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

export function PropostasTable({ rows, page, pageSize, total, loading, onPageChange }: PropostasTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Proposta
              </th>
              <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Cliente
              </th>
              <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                Data
              </th>
              <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                Gerente
              </th>
              <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Valor
              </th>
              <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.codemp}-${row.codpro}`} className="border-t border-border/60 transition hover:bg-surface-2">
                <td className="px-5 py-3.5">
                  <div className="text-sm font-semibold text-foreground">{row.codpro}</div>
                  {row.numprj != null && (
                    <div className="mt-0.5 font-mono text-[11px] text-muted">Projeto {row.numprj}</div>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <div className="text-sm text-foreground">
                    {row.codcli} - {row.nomcli}
                  </div>
                </td>
                <td className="hidden px-5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                  {row.datpro ? dateFormatter.format(new Date(row.datpro)) : "—"}
                </td>
                <td className="hidden px-5 py-3.5 text-sm text-muted md:table-cell">{row.gerente}</td>
                <td className="px-5 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                  R$ {currency.format(row.valor)}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <span
                    className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                      toneTag[row.situacaoTone]
                    }`}
                  >
                    {row.situacaoLabel}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                  Nenhuma proposta encontrada com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-5 py-3">
        <p className="text-[11.5px] text-muted">
          {total.toLocaleString("pt-BR")} propostas · página {page} de {totalPages}
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
