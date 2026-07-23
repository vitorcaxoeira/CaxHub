import axios from "axios";
import { Fragment, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { Pagination } from "../../components/ui/Pagination";
import { KpiCard } from "../../components/ui/KpiCard";
import { Skeleton } from "../../components/ui/Skeleton";
import { toneBadge } from "../../components/ui/badges";
import { formatHoras } from "../../utils/horas";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

interface OpcaoFiltro {
  value: number;
  label: string;
}

interface PropostaRow {
  codemp: number;
  codpro: number;
  numprj: number;
  cliente: string;
  sitpro: number | null;
  sitproLabel: string;
  sitproTone: "success" | "warning" | "destructive" | "neutral";
  depexeLabel: string;
  modproLabel: string;
  totalItens: number;
  qtdhorTotal: number;
  horasAlocadas: number;
  saldo: number;
}

interface ConsultorResumo {
  codfor: number;
  nome: string;
  depexeLabel: string;
  horasAlocadas: number;
}

interface KpiValor {
  quantidade: number;
  horas: number;
}

interface KpisResumo {
  totalNoEscopo: number;
  semAlocacao: KpiValor;
  saldoPendente: KpiValor;
  totalmenteAlocadas: KpiValor;
  compartilhadasEmAberto: KpiValor;
}

type Situacao = "semAlocacao" | "saldoPendente" | "totalmenteAlocadas" | "compartilhadasEmAberto";

const PAGE_SIZE = 20;

// Ponto de entrada da área de Alocação: controle sempre por proposta (uma proposta com
// muitos itens ficava perdida num feed único de itens misturados de propostas
// diferentes) — aqui cada linha é uma proposta, com o total/alocado/saldo agregado;
// o detalhe item-a-item fica na tela seguinte (AlocacaoPropostaDetalhe.tsx).
export function Alocacao() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Filtros ficam sincronizados na URL — assim, ao voltar da tela de detalhe da
  // proposta (via histórico do navegador), a lista reaparece com os mesmos filtros
  // em vez de resetar.
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<PropostaRow[]>([]);
  const [kpis, setKpis] = useState<KpisResumo | null>(null);
  const [departamentos, setDepartamentos] = useState<OpcaoFiltro[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(Number(searchParams.get("page")) || 1);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);

  // Number("") é 0 (não NaN) — sem o parâmetro na URL, split(",") vira [""] e viraria
  // erroneamente [0] ("Diretoria" selecionado) em vez de "todos" se não checar antes.
  const depexeParam = searchParams.get("depexe");
  const depexeInicial = depexeParam
    ? depexeParam
        .split(",")
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n))
    : [];
  const [depexe, setDepexeState] = useState<number[]>(depexeInicial);
  const [busca, setBuscaState] = useState(searchParams.get("busca") ?? "");
  // Digitar atualiza a caixa na hora; a busca pesada (2 queries sem filtro seletivo no
  // banco) só dispara 350ms depois de parar de digitar — sem isso, cada tecla repetia
  // o carregamento completo do escopo do usuário.
  const [buscaInput, setBuscaInput] = useState(busca);
  const buscaDebounced = useDebouncedValue(buscaInput, 350);
  const [apenasComSaldo, setApenasComSaldoState] = useState(searchParams.get("apenasComSaldo") !== "false");
  const [compartilhadas, setCompartilhadasState] = useState(searchParams.get("compartilhadas") === "true");
  const situacoesValidas: Situacao[] = ["semAlocacao", "saldoPendente", "totalmenteAlocadas", "compartilhadasEmAberto"];
  const situacaoInicial = situacoesValidas.includes(searchParams.get("situacao") as Situacao)
    ? (searchParams.get("situacao") as Situacao)
    : null;
  const [situacao, setSituacaoState] = useState<Situacao | null>(situacaoInicial);

  function atualizarFiltros(
    patch: Partial<{
      depexe: number[];
      busca: string;
      apenasComSaldo: boolean;
      compartilhadas: boolean;
      situacao: Situacao | null;
      page: number;
    }>
  ) {
    const mudouFiltro =
      patch.depexe !== undefined ||
      patch.busca !== undefined ||
      patch.apenasComSaldo !== undefined ||
      patch.compartilhadas !== undefined ||
      patch.situacao !== undefined;
    const proximo = {
      depexe: patch.depexe ?? depexe,
      busca: patch.busca ?? busca,
      apenasComSaldo: patch.apenasComSaldo ?? apenasComSaldo,
      compartilhadas: patch.compartilhadas ?? compartilhadas,
      situacao: patch.situacao !== undefined ? patch.situacao : situacao,
      page: patch.page ?? (mudouFiltro ? 1 : page),
    };
    setDepexeState(proximo.depexe);
    setBuscaState(proximo.busca);
    setApenasComSaldoState(proximo.apenasComSaldo);
    setCompartilhadasState(proximo.compartilhadas);
    setSituacaoState(proximo.situacao);
    setPageState(proximo.page);

    const params = new URLSearchParams();
    if (proximo.depexe.length > 0) params.set("depexe", proximo.depexe.join(","));
    if (proximo.busca) params.set("busca", proximo.busca);
    if (!proximo.apenasComSaldo) params.set("apenasComSaldo", "false");
    if (proximo.compartilhadas) params.set("compartilhadas", "true");
    if (proximo.situacao) params.set("situacao", proximo.situacao);
    if (proximo.page > 1) params.set("page", String(proximo.page));
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    if (buscaDebounced !== busca) atualizarFiltros({ busca: buscaDebounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced]);

  // Clicar num KPI vira o único critério de "situação" da tabela abaixo (substitui os
  // checkboxes de saldo/compartilhadas enquanto ativo) — clicar de novo no mesmo KPI
  // desliga o filtro e volta pros checkboxes manuais. Também realinha o checkbox
  // "só com saldo pendente" com o KPI escolhido, pra não ficarem contraditórios quando
  // o filtro do KPI for desligado depois (ex.: "100% alocadas" implica saldo=0, mas o
  // checkbox pede saldo>0).
  function clicarKpi(tipo: Situacao) {
    if (situacao === tipo) {
      atualizarFiltros({ situacao: null });
      return;
    }
    atualizarFiltros({ situacao: tipo, apenasComSaldo: tipo !== "totalmenteAlocadas" });
  }

  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [consultoresPorProposta, setConsultoresPorProposta] = useState<
    Record<string, ConsultorResumo[] | "carregando" | "erro">
  >({});

  useEffect(() => {
    if (!user) return;
    const carregarDepartamentos =
      user.role === "admin"
        ? axios.get("/api/atividades/opcoes-filtro").then(({ data }) => data.departamentos as OpcaoFiltro[])
        : axios
            .get("/api/dashboard/meu-perfil")
            .then(
              ({ data }) =>
                (data.departamentosGerenciados ?? []).map((d: any) => ({ value: d.depexe, label: d.depexeLabel })) as OpcaoFiltro[]
            );

    carregarDepartamentos.then(setDepartamentos).catch(() => {});
  }, [user]);

  function carregar() {
    setLoading(true);
    axios
      .get("/api/alocacao/propostas", {
        params: {
          depexe: depexe.length > 0 ? depexe.join(",") : undefined,
          busca: busca || undefined,
          apenasComSaldo: apenasComSaldo || undefined,
          compartilhadas: compartilhadas || undefined,
          situacao: situacao || undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      })
      .then(({ data }) => {
        setRows(data.rows);
        setTotal(data.total);
        setKpis(data.kpis);
        setErro(null);
        setSemAcesso(false);
      })
      .catch((err) => {
        if (err.response?.status === 403) {
          setSemAcesso(true);
        } else {
          setErro(err.response?.data?.error ?? "Falha ao carregar propostas");
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depexe, busca, apenasComSaldo, compartilhadas, situacao, page]);

  function toggleExpandir(row: PropostaRow) {
    const chave = `${row.codemp}-${row.codpro}`;
    setExpandidas((atual) => {
      const next = new Set(atual);
      if (next.has(chave)) {
        next.delete(chave);
      } else {
        next.add(chave);
        if (!consultoresPorProposta[chave]) {
          setConsultoresPorProposta((c) => ({ ...c, [chave]: "carregando" }));
          axios
            .get(`/api/alocacao/propostas/${row.codemp}/${row.codpro}/consultores`)
            .then(({ data }) => setConsultoresPorProposta((c) => ({ ...c, [chave]: data.consultores })))
            .catch(() => setConsultoresPorProposta((c) => ({ ...c, [chave]: "erro" })));
        }
      }
      return next;
    });
  }

  const selectClass =
    "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (semAcesso) {
    return (
      <div>
        <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
          Gestão de Projetos · Alocação
        </p>
        <p className="rounded-md border border-border bg-surface p-6 text-sm text-muted">
          Esta área é só para quem gerencia algum departamento. Fale com um administrador se você acha que deveria ter
          acesso.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Alocação
      </p>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Alocação de Atividades</h1>
        <p className="mt-1 text-sm text-muted">
          Escolha uma proposta pra distribuir as horas dos itens dela entre os consultores do seu time.
        </p>
      </div>

      {loading ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-24" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="mt-2 h-1 w-full" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          ))}
        </div>
      ) : (
        kpis && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <KpiCard
            label="Sem alocação"
            tone="destructive"
            quantidade={kpis.semAlocacao.quantidade}
            total={kpis.totalNoEscopo}
            horas={kpis.semAlocacao.horas}
            horasLabel="previstas"
            ativo={situacao === "semAlocacao"}
            onClick={() => clicarKpi("semAlocacao")}
          />
          <KpiCard
            label="Saldo pendente"
            tone="warning"
            quantidade={kpis.saldoPendente.quantidade}
            total={kpis.totalNoEscopo}
            horas={kpis.saldoPendente.horas}
            horasLabel="restantes"
            ativo={situacao === "saldoPendente"}
            onClick={() => clicarKpi("saldoPendente")}
          />
          <KpiCard
            label="100% alocadas"
            tone="success"
            quantidade={kpis.totalmenteAlocadas.quantidade}
            total={kpis.totalNoEscopo}
            horas={kpis.totalmenteAlocadas.horas}
            horasLabel="alocadas"
            ativo={situacao === "totalmenteAlocadas"}
            onClick={() => clicarKpi("totalmenteAlocadas")}
          />
          <KpiCard
            label="Compartilhadas em aberto"
            tone="primary"
            quantidade={kpis.compartilhadasEmAberto.quantidade}
            total={kpis.totalNoEscopo}
            horas={kpis.compartilhadasEmAberto.horas}
            horasLabel="em aberto"
            ativo={situacao === "compartilhadasEmAberto"}
            onClick={() => clicarKpi("compartilhadasEmAberto")}
          />
        </div>
        )
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar cliente ou proposta..."
          value={buscaInput}
          onChange={(e) => setBuscaInput(e.target.value)}
          className={`${selectClass} w-56`}
        />
        {departamentos.length > 1 && (
          <MultiSelectDropdown
            opcoes={departamentos}
            selecionados={depexe}
            onChange={(selecionados) => atualizarFiltros({ depexe: selecionados })}
            labelTodos="Todos os departamentos"
            labelSufixo="departamentos"
          />
        )}
        {situacao ? (
          <button
            onClick={() => atualizarFiltros({ situacao: null })}
            className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/25"
          >
            Filtro do KPI ativo <span aria-hidden>✕</span>
          </button>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={apenasComSaldo}
                onChange={(e) => atualizarFiltros({ apenasComSaldo: e.target.checked })}
              />
              Só propostas com saldo pendente
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={compartilhadas}
                onChange={(e) => atualizarFiltros({ compartilhadas: e.target.checked })}
              />
              Compartilhadas com meu departamento
            </label>
          </>
        )}
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
                  Modalidade
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Itens
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Total
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Alocado
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Saldo
                </th>
                <th className="bg-surface-2 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="mt-1.5 h-3 w-16" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-40" />
                    </td>
                    <td className="hidden px-5 py-3.5 md:table-cell">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="hidden px-5 py-3.5 lg:table-cell">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="ml-auto h-4 w-8" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="ml-auto h-4 w-14" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="ml-auto h-4 w-14" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="ml-auto h-4 w-14" />
                    </td>
                    <td className="px-5 py-3.5" />
                  </tr>
                ))}
              {!loading &&
                rows.map((row) => {
                const chave = `${row.codemp}-${row.codpro}`;
                const expandida = expandidas.has(chave);
                const consultoresResumo = consultoresPorProposta[chave];
                return (
                  <Fragment key={chave}>
                    <tr
                      onClick={() => toggleExpandir(row)}
                      className={`cursor-pointer transition ${
                        expandida ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                      }`}
                    >
                      <td className={`px-5 py-3.5 ${expandida ? "border-l border-primary" : ""}`}>
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="text-muted">{expandida ? "▾" : "▸"}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/projetos/proposta/${row.codemp}/${row.codpro}`);
                            }}
                            className="text-primary hover:underline"
                          >
                            {row.codpro}
                          </button>
                          <span
                            className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium ${toneBadge[row.sitproTone]}`}
                          >
                            {row.sitproLabel}
                          </span>
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted">Projeto {row.numprj}</p>
                      </td>
                      <td className="max-w-[240px] truncate px-5 py-3.5 text-sm text-foreground" title={row.cliente}>
                        {row.cliente}
                      </td>
                      <td className="hidden px-5 py-3.5 md:table-cell">
                        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>
                          {row.depexeLabel}
                        </span>
                      </td>
                      <td className="hidden px-5 py-3.5 lg:table-cell">
                        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>
                          {row.modproLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">{row.totalItens}</td>
                      <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                        {formatHoras(row.qtdhorTotal / 60)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                        {formatHoras(row.horasAlocadas / 60)}
                      </td>
                      <td
                        className={`px-5 py-3.5 text-right font-mono text-sm tabular-nums ${row.saldo < 0 ? "text-destructive" : "text-foreground"}`}
                      >
                        {formatHoras(row.saldo / 60)}
                      </td>
                      <td className={`px-5 py-3.5 text-right ${expandida ? "border-r border-primary" : ""}`}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/projetos/alocacao/${row.codemp}/${row.codpro}`);
                          }}
                          className="text-sm text-primary hover:underline"
                        >
                          Ver itens →
                        </button>
                      </td>
                    </tr>
                    {expandida && (
                      <tr className="border-t border-border/60 bg-surface-2/40">
                        <td colSpan={9} className="border-b border-l border-r border-primary px-5 py-3">
                          {consultoresResumo === "carregando" && (
                            <p className="py-2 text-sm text-muted">Carregando consultores...</p>
                          )}
                          {consultoresResumo === "erro" && (
                            <p className="py-2 text-sm text-destructive">Falha ao carregar consultores desta proposta.</p>
                          )}
                          {Array.isArray(consultoresResumo) && consultoresResumo.length === 0 && (
                            <p className="py-2 text-sm text-muted">Ninguém alocado ainda nesta proposta.</p>
                          )}
                          {Array.isArray(consultoresResumo) && consultoresResumo.length > 0 && (
                            <table className="w-full border-collapse">
                              <thead>
                                <tr>
                                  <th className="py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                    Consultor
                                  </th>
                                  <th className="py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                    Nome Consultor
                                  </th>
                                  <th className="py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                    Departamento
                                  </th>
                                  <th className="py-1.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                    Horas Alocada
                                  </th>
                                  <th className="py-1.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                    % do Alocado
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {consultoresResumo.map((c) => {
                                  const pct = row.horasAlocadas > 0 ? Math.round((c.horasAlocadas / row.horasAlocadas) * 100) : 0;
                                  return (
                                    <tr key={c.codfor} className="border-t border-border/40">
                                      <td className="py-1.5 font-mono text-[12.5px] tabular-nums text-muted">{c.codfor}</td>
                                      <td className="py-1.5 text-[12.5px] text-foreground">{c.nome}</td>
                                      <td className="py-1.5">
                                        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>
                                          {c.depexeLabel}
                                        </span>
                                      </td>
                                      <td className="py-1.5 text-right font-mono text-[12.5px] tabular-nums text-foreground">
                                        {formatHoras(c.horasAlocadas / 60)}
                                      </td>
                                      <td className="py-1.5 pl-4">
                                        <div className="flex items-center justify-end gap-2">
                                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted/20">
                                            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                                          </div>
                                          <span className="w-9 font-mono text-[11px] tabular-nums text-muted">{pct}%</span>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
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
                  <td colSpan={9} className="px-5 py-8 text-center text-sm text-muted">
                    Nenhuma proposta encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          loading={loading}
          onPageChange={(p) => atualizarFiltros({ page: p })}
          label="propostas"
        />
      </div>
    </div>
  );
}
