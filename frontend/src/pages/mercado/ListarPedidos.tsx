import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { Pagination } from "../../components/ui/Pagination";
import { Skeleton } from "../../components/ui/Skeleton";
import { toneBadge, type Tone } from "../../components/ui/badges";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { PedidosDashboard, PedidosIndicadoresData } from "../../components/mercado/PedidosDashboard";

type Visao = "lista" | "dash";

interface PedidoRow {
  codemp: number;
  codfil: number;
  numped: number;
  cliente: string;
  datemi: string;
  datprv: string | null;
  obsped: string | null;
  pedcli: string | null;
  sitped: number;
  sitpedLabel: string;
  sitpedTone: Tone;
  numrat: string | null;
  // Resolvidos a partir da RAT vinculada (Pedido.numrat -> Rat -> Proposta) — nulos
  // quando o pedido não tem RAT vinculada ou a RAT ainda não tem proposta associada.
  propostaCodpro: number | null;
  faturamentoLabel: string | null;
  faturamentoRdvLabel: string | null;
}

const SITPED_OPCOES: MultiSelectOption<number>[] = [
  { value: 1, label: "Aberto Total" },
  { value: 2, label: "Aberto Parcial" },
  { value: 3, label: "Suspenso" },
  { value: 4, label: "Liquidado" },
  { value: 5, label: "Cancelado" },
  { value: 6, label: "Aguardando Integração WMS" },
  { value: 7, label: "Em Transmissão" },
  { value: 8, label: "Preparação Análise ou NF" },
  { value: 9, label: "Não Fechado" },
];

const PAGE_SIZE = 30;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

export function ListarPedidos() {
  const navigate = useNavigate();
  const [visao, setVisao] = useState<Visao>("lista");
  const [indicadores, setIndicadores] = useState<PedidosIndicadoresData | null>(null);
  const [loadingIndicadores, setLoadingIndicadores] = useState(true);
  const [clienteInput, setClienteInput] = useState("");
  const clienteDebounced = useDebouncedValue(clienteInput, 350);
  const [numpedInput, setNumpedInput] = useState("");
  const numpedDebounced = useDebouncedValue(numpedInput, 350);
  // Pré-marcado só com "Não Fechado" (9) — decisão do usuário, não existe valor
  // "Digitado" no domínio real LSitPed.
  const [sitpedFiltro, setSitpedFiltro] = useState<number[]>([9]);
  const [page, setPage] = useState(1);

  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    axios
      .get("/api/pedidos", {
        params: {
          cliente: clienteDebounced || undefined,
          numped: numpedDebounced || undefined,
          sitped: sitpedFiltro.length > 0 ? sitpedFiltro.join(",") : undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      })
      .then(({ data }) => {
        setPedidos(data.pedidos);
        setTotal(data.total);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar pedidos"))
      .finally(() => setLoading(false));
  }

  function carregarIndicadores() {
    setLoadingIndicadores(true);
    axios
      .get("/api/pedidos/indicadores")
      .then(({ data }) => setIndicadores(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar indicadores"))
      .finally(() => setLoadingIndicadores(false));
  }

  // Indicadores do "Dash" refletem sempre a base inteira, não os filtros da aba Lista
  // (mesmo comportamento de /atividades/indicadores em relação à lista de Atividades)
  // — por isso carrega só uma vez ao montar, fora do effect de filtros abaixo.
  useEffect(() => {
    carregarIndicadores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteDebounced, numpedDebounced, sitpedFiltro, page]);

  // Digitar ou trocar a situação reseta pra página 1 — senão a busca pode "sumir" numa
  // página que não existe mais no resultado filtrado.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteDebounced, numpedDebounced, sitpedFiltro]);

  const tabClass = (ativa: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      ativa ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Mercado · Listar Pedidos</p>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Listar Pedidos</h1>
          <p className="mt-1 text-sm text-muted">Pedidos importados do Senior (E120PED).</p>
        </div>
        <div className="flex flex-wrap gap-2 rounded-md border border-border p-1">
          <button onClick={() => setVisao("lista")} className={tabClass(visao === "lista")}>
            Lista
          </button>
          <button onClick={() => setVisao("dash")} className={tabClass(visao === "dash")}>
            Dash
          </button>
        </div>
      </div>

      {erro && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {erro}
        </div>
      )}

      {visao === "dash" ? (
        <PedidosDashboard dados={indicadores} loading={loadingIndicadores} />
      ) : (
        <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={clienteInput}
          onChange={(e) => setClienteInput(e.target.value)}
          placeholder="Buscar cliente..."
          className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          value={numpedInput}
          onChange={(e) => setNumpedInput(e.target.value)}
          placeholder="Nro. do pedido..."
          className="w-40 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <MultiSelectDropdown
          opcoes={SITPED_OPCOES}
          selecionados={sitpedFiltro}
          onChange={setSitpedFiltro}
          labelTodos="Todas as situações"
          labelSufixo="situações"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Pedido
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Cliente
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Emissão
                </th>
                <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                  Previsão
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Situação
                </th>
                <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                  RAT vinculada
                </th>
                <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                  Proposta
                </th>
                <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted xl:table-cell">
                  Faturamento
                </th>
                <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted xl:table-cell">
                  Faturamento RDV
                </th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-40" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="hidden px-2.5 py-3.5 md:table-cell">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-5 w-24 rounded-full" />
                    </td>
                    <td className="hidden px-2.5 py-3.5 lg:table-cell">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="hidden px-2.5 py-3.5 lg:table-cell">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="hidden px-2.5 py-3.5 xl:table-cell">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="hidden px-2.5 py-3.5 xl:table-cell">
                      <Skeleton className="h-4 w-32" />
                    </td>
                  </tr>
                ))}
              {!loading &&
                pedidos.map((p) => (
                  <tr key={`${p.codemp}-${p.codfil}-${p.numped}`} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-2.5 py-3.5 font-mono text-sm font-semibold text-foreground">
                      {p.numped}
                    </td>
                    <td className="max-w-[280px] truncate px-2.5 py-3.5 text-sm text-foreground" title={p.cliente}>
                      {p.cliente}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted">
                      {dateFormatter.format(new Date(p.datemi))}
                    </td>
                    <td className="hidden whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted md:table-cell">
                      {p.datprv ? dateFormatter.format(new Date(p.datprv)) : "—"}
                    </td>
                    <td className="px-2.5 py-3.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[p.sitpedTone]}`}>
                        {p.sitpedLabel}
                      </span>
                    </td>
                    <td className="hidden px-2.5 py-3.5 font-mono text-sm text-muted lg:table-cell">{p.numrat ?? "—"}</td>
                    <td className="hidden px-2.5 py-3.5 lg:table-cell">
                      {p.propostaCodpro != null ? (
                        <button
                          onClick={() => navigate(`/projetos/proposta/${p.codemp}/${p.propostaCodpro}`)}
                          className="font-mono text-sm text-primary hover:underline"
                        >
                          {p.propostaCodpro}
                        </button>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </td>
                    <td className="hidden px-2.5 py-3.5 text-sm text-muted xl:table-cell">{p.faturamentoLabel ?? "—"}</td>
                    <td className="hidden px-2.5 py-3.5 text-sm text-muted xl:table-cell">{p.faturamentoRdvLabel ?? "—"}</td>
                  </tr>
                ))}
              {!loading && pedidos.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2.5 py-8 text-center text-sm text-muted">
                    Nenhum pedido encontrado com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} label="pedidos" />
      </div>
        </>
      )}
    </div>
  );
}
