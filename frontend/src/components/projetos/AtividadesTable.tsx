import axios from "axios";
import { useEffect, useState } from "react";
import { Pagination } from "../ui/Pagination";
import { ColunaKanban } from "./KanbanBoard";

interface AtividadeRow {
  id: number;
  codpro: number;
  numprj: number;
  cliente: string;
  pripro: number | null;
  priproLabel: string;
  datval: string | null;
  depexe: number;
  depexeLabel: string;
  consultorNome: string;
  qtdhorPrevisto: number | null;
  colunaId: number | null;
  atrasada: boolean;
  podeMover: boolean;
}

interface OpcaoFiltro {
  value: number;
  label: string;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const horasFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function formatQtdHor(minutos: number | null): string {
  if (minutos == null) return "—";
  const totalMinutos = Math.round(minutos);
  const horas = Math.trunc(totalMinutos / 60);
  const resto = Math.abs(totalMinutos % 60);
  return `${horasFormatter.format(horas)}:${String(resto).padStart(2, "0")} h`;
}

const corBadgePrioridade: Record<number, string> = {
  1: "bg-destructive/15 text-destructive",
  2: "bg-warning/15 text-warning",
  3: "bg-muted/15 text-muted",
};

const PAGE_SIZE = 25;

interface AtividadesTableProps {
  onMovido?: () => void;
}

export function AtividadesTable({ onMovido }: AtividadesTableProps) {
  const [rows, setRows] = useState<AtividadeRow[]>([]);
  const [colunas, setColunas] = useState<ColunaKanban[]>([]);
  const [departamentos, setDepartamentos] = useState<OpcaoFiltro[]>([]);
  const [prioridades, setPrioridades] = useState<OpcaoFiltro[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [depexe, setDepexe] = useState("");
  const [colunaId, setColunaId] = useState("");
  const [pripro, setPripro] = useState("");
  const [atrasada, setAtrasada] = useState(false);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    Promise.all([axios.get("/api/atividades/opcoes-filtro"), axios.get("/api/atividades/quadro-colunas")]).then(
      ([opcoesRes, colunasRes]) => {
        setDepartamentos(opcoesRes.data.departamentos);
        setPrioridades(opcoesRes.data.prioridades);
        setColunas(colunasRes.data.colunas);
      }
    );
  }, []);

  useEffect(() => {
    setLoading(true);
    axios
      .get("/api/atividades", {
        params: {
          depexe: depexe || undefined,
          colunaId: colunaId || undefined,
          pripro: pripro || undefined,
          atrasada: atrasada || undefined,
          busca: busca || undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      })
      .then(({ data }) => {
        setRows(data.rows);
        setTotal(data.total);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar atividades"))
      .finally(() => setLoading(false));
  }, [depexe, colunaId, pripro, atrasada, busca, page]);

  function atualizarFiltro(setter: (v: string) => void) {
    return (valor: string) => {
      setter(valor);
      setPage(1);
    };
  }

  async function moverAtividade(atividadeId: number, novaColunaId: number) {
    const anterior = rows;
    setRows((atual) => atual.map((a) => (a.id === atividadeId ? { ...a, colunaId: novaColunaId } : a)));
    try {
      await axios.patch(`/api/atividades/${atividadeId}/mover`, { colunaId: novaColunaId });
      onMovido?.();
    } catch (err: any) {
      setRows(anterior);
      setErro(err.response?.data?.error ?? "Falha ao mover atividade");
    }
  }

  const selectClass =
    "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar cliente ou proposta..."
          value={busca}
          onChange={(e) => atualizarFiltro(setBusca)(e.target.value)}
          className={`${selectClass} w-56`}
        />
        <select value={depexe} onChange={(e) => atualizarFiltro(setDepexe)(e.target.value)} className={selectClass}>
          <option value="">Todos os departamentos</option>
          {departamentos.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <select value={colunaId} onChange={(e) => atualizarFiltro(setColunaId)(e.target.value)} className={selectClass}>
          <option value="">Todas as situações</option>
          {colunas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        <select value={pripro} onChange={(e) => atualizarFiltro(setPripro)(e.target.value)} className={selectClass}>
          <option value="">Todas as prioridades</option>
          {prioridades.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={atrasada}
            onChange={(e) => {
              setAtrasada(e.target.checked);
              setPage(1);
            }}
          />
          Só atrasadas
        </label>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

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
                <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                  Departamento
                </th>
                <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                  Consultor
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Horas
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Prioridade
                </th>
                <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                  Prazo
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Situação
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border/60 transition hover:bg-surface-2">
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground">
                    {row.codpro}
                    {row.numprj != null && <div className="mt-0.5 font-mono text-[11px] text-muted">Projeto {row.numprj}</div>}
                  </td>
                  <td className="max-w-[220px] truncate px-5 py-3.5 text-sm text-foreground" title={row.cliente}>
                    {row.cliente}
                  </td>
                  <td className="hidden px-5 py-3.5 text-sm text-muted md:table-cell">{row.depexeLabel}</td>
                  <td className="hidden px-5 py-3.5 text-sm text-muted lg:table-cell">{row.consultorNome}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                    {formatQtdHor(row.qtdhorPrevisto)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {row.pripro !== null && (
                      <span
                        className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                          corBadgePrioridade[row.pripro] ?? "bg-muted/15 text-muted"
                        }`}
                      >
                        {row.priproLabel}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-5 py-3.5 font-mono text-sm sm:table-cell">
                    <span className={row.atrasada ? "font-semibold text-destructive" : "text-muted"}>
                      {row.datval ? dateFormatter.format(new Date(row.datval)) : "—"}
                      {row.atrasada ? " · Atrasado" : ""}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <select
                      value={row.colunaId ?? ""}
                      disabled={!row.podeMover}
                      onChange={(e) => moverAtividade(row.id, Number(e.target.value))}
                      className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {colunas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted">
                    Nenhuma atividade encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} label="atividades" />
      </div>
    </div>
  );
}
