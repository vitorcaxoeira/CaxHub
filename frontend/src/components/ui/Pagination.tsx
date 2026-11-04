interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  label?: string;
  /** Com as duas props abaixo aparece o seletor "Por página" (a pessoa escolhe quanto carregar, em vez de um teto fixo). */
  opcoesPorPagina?: number[];
  onPageSizeChange?: (pageSize: number) => void;
}

export function Pagination({ page, pageSize, total, loading, onPageChange, label = "registros", opcoesPorPagina, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex items-center justify-between border-t border-border px-5 py-3">
      <p className="text-[11.5px] text-muted">
        {total.toLocaleString("pt-BR")} {label} · página {page} de {totalPages}
      </p>
      <div className="flex items-center gap-2">
        {opcoesPorPagina && onPageSizeChange && (
          <label className="mr-2 flex items-center gap-1.5 text-[11.5px] text-muted">
            Por página
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-md border border-border bg-surface px-1.5 py-1 text-[11.5px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {opcoesPorPagina.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
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
  );
}
