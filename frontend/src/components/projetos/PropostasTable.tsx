import axios from "axios";
import { Fragment, useState } from "react";
import { formatHoras } from "../../utils/horas";
import { Skeleton } from "../ui/Skeleton";

export interface PropostaRow {
  codemp: number;
  codpro: number;
  codcli: number;
  nomcli: string;
  datpro: string | null;
  datret: string | null;
  sitpro: number | null;
  numprj: number | null;
  valor: number;
  horas: number;
  pripro: number | null;
  depexeLabel: string;
  modproLabel: string;
  forfatLabel: string;
  despro: string | null;
  situacaoLabel: string;
  situacaoTone: "success" | "warning" | "destructive" | "neutral";
}

interface PropostaItemDrillDown {
  seqite: number;
  codser: string;
  despro: string | null;
  horas: number;
  valhor: number;
  valor: number;
  depexeLabel: string;
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
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

const toneTag: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

function chaveProposta(codemp: number, codpro: number): string {
  return `${codemp}-${codpro}`;
}

export function PropostasTable({ rows, page, pageSize, total, loading, onPageChange }: PropostasTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [expandida, setExpandida] = useState<string | null>(null);
  const [itensPorProposta, setItensPorProposta] = useState<Map<string, PropostaItemDrillDown[]>>(new Map());
  const [carregandoItens, setCarregandoItens] = useState(false);

  function handleExpandir(codemp: number, codpro: number) {
    const chave = chaveProposta(codemp, codpro);
    if (expandida === chave) {
      setExpandida(null);
      return;
    }
    setExpandida(chave);
    if (!itensPorProposta.has(chave)) {
      setCarregandoItens(true);
      axios
        .get(`/api/projetos/propostas/${codemp}/${codpro}/itens`)
        .then(({ data }) => {
          setItensPorProposta((atual) => new Map(atual).set(chave, data.rows));
        })
        .catch(() => {})
        .finally(() => setCarregandoItens(false));
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-8 bg-surface-2" />
              <th className="bg-surface-2 px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Proposta
              </th>
              <th className="bg-surface-2 px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Cliente
              </th>
              <th className="hidden bg-surface-2 px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                Data
              </th>
              <th className="hidden bg-surface-2 px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                Aprovação
              </th>
              <th className="hidden bg-surface-2 px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted xl:table-cell">
                Descrição
              </th>
              <th className="hidden bg-surface-2 px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                Depto. Executor
              </th>
              <th className="hidden bg-surface-2 px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                Forma Fat.
              </th>
              <th className="bg-surface-2 px-2 py-1.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Horas
              </th>
              <th className="bg-surface-2 px-2 py-1.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Valor
              </th>
              <th className="bg-surface-2 px-2 py-1.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-1" />
                  <td className="px-2 py-1.5">
                    <Skeleton className="h-4 w-14" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Skeleton className="h-4 w-32" />
                  </td>
                  <td className="hidden px-2 py-1.5 sm:table-cell">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="hidden px-2 py-1.5 lg:table-cell">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="hidden px-2 py-1.5 xl:table-cell">
                    <Skeleton className="h-4 w-24" />
                  </td>
                  <td className="hidden px-2 py-1.5 md:table-cell">
                    <Skeleton className="h-4 w-20" />
                  </td>
                  <td className="hidden px-2 py-1.5 lg:table-cell">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Skeleton className="ml-auto h-4 w-10" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Skeleton className="ml-auto h-4 w-16" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Skeleton className="ml-auto h-5 w-16 rounded" />
                  </td>
                </tr>
              ))}
            {!loading &&
              rows.map((row) => {
              const chave = chaveProposta(row.codemp, row.codpro);
              const expandido = expandida === chave;
              return (
                <Fragment key={chave}>
                  <tr
                    onClick={() => handleExpandir(row.codemp, row.codpro)}
                    className={`cursor-pointer transition ${
                      expandido ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                    }`}
                  >
                    <td className={`px-1 text-center text-muted ${expandido ? "border-l border-primary" : ""}`}>
                      {expandido ? "▾" : "▸"}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="text-sm font-semibold text-foreground">{row.codpro}</div>
                      {row.numprj != null && (
                        <div className="mt-0.5 font-mono text-[11px] text-muted">Projeto {row.numprj}</div>
                      )}
                    </td>
                    <td className="max-w-[150px] px-2 py-1.5">
                      <div className="truncate text-sm text-foreground" title={`${row.codcli} - ${row.nomcli}`}>
                        {row.codcli} - {row.nomcli}
                      </div>
                    </td>
                    <td className="hidden px-2 py-1.5 font-mono text-sm text-muted sm:table-cell">
                      {row.datpro ? dateFormatter.format(new Date(row.datpro)) : "—"}
                    </td>
                    <td className="hidden px-2 py-1.5 font-mono text-sm text-muted lg:table-cell">
                      {row.datret ? dateFormatter.format(new Date(row.datret)) : "—"}
                    </td>
                    <td className="hidden max-w-[130px] truncate px-2 py-1.5 text-sm text-muted xl:table-cell" title={row.despro ?? undefined}>
                      {row.despro ?? "—"}
                    </td>
                    <td className="hidden px-2 py-1.5 text-sm text-muted md:table-cell">
                      <div>{row.depexeLabel}</div>
                      <div className="mt-0.5 font-mono text-[10.5px] text-muted/70">{row.modproLabel}</div>
                    </td>
                    <td
                      className="hidden max-w-[95px] truncate px-2 py-1.5 text-sm text-muted lg:table-cell"
                      title={row.forfatLabel}
                    >
                      {row.forfatLabel}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-sm tabular-nums text-muted">{formatHoras(row.horas)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                      {fmtMoney(row.valor)}
                    </td>
                    <td className={`px-2 py-1.5 text-right ${expandido ? "border-r border-primary" : ""}`}>
                      <span
                        className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                          toneTag[row.situacaoTone]
                        }`}
                      >
                        {row.situacaoLabel}
                      </span>
                    </td>
                  </tr>
                  {expandido && (
                    <tr className="border-t border-border/60 bg-surface-2/40">
                      <td colSpan={11} className="border-b border-l border-r border-primary px-5 py-3">
                        {carregandoItens && !itensPorProposta.has(chave) ? (
                          <p className="text-[11.5px] text-muted">Carregando itens...</p>
                        ) : (
                          <table className="w-full border-collapse text-[12.5px]">
                            <thead>
                              <tr className="text-left text-muted">
                                <th className="pb-1.5 pr-4 font-medium">Seq.</th>
                                <th className="pb-1.5 pr-4 font-medium">Serviço</th>
                                <th className="pb-1.5 pr-4 font-medium">Descrição</th>
                                <th className="pb-1.5 pr-4 font-medium">Depto. Executor</th>
                                <th className="pb-1.5 pr-4 text-right font-medium">Horas</th>
                                <th className="pb-1.5 pr-4 text-right font-medium">Valor/Hora</th>
                                <th className="pb-1.5 text-right font-medium">Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(itensPorProposta.get(chave) ?? []).map((item) => (
                                <tr key={item.seqite} className="border-t border-border/40">
                                  <td className="py-1.5 pr-4 font-mono text-muted">{item.seqite}</td>
                                  <td className="py-1.5 pr-4 font-mono text-foreground">{item.codser}</td>
                                  <td className="py-1.5 pr-4 text-foreground">{item.despro ?? "—"}</td>
                                  <td className="py-1.5 pr-4 text-muted">{item.depexeLabel}</td>
                                  <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-muted">{formatHoras(item.horas)}</td>
                                  <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-muted">{fmtMoney(item.valhor)}</td>
                                  <td className="py-1.5 text-right font-mono tabular-nums text-foreground">{fmtMoney(item.valor)}</td>
                                </tr>
                              ))}
                              {(itensPorProposta.get(chave) ?? []).length === 0 && (
                                <tr>
                                  <td colSpan={7} className="py-2 text-center text-muted">
                                    Sem itens cadastrados.
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
              );
            })}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={11} className="px-5 py-8 text-center text-sm text-muted">
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
