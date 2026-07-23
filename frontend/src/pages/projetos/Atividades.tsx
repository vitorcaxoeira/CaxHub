import axios from "axios";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AtividadeKanban, ColunaKanban, DetalheInfo, KanbanBoard } from "../../components/projetos/KanbanBoard";
import { AtividadesTable, FiltrosAtividades } from "../../components/projetos/AtividadesTable";
import { AtividadesFiltros } from "../../components/projetos/AtividadesFiltros";
import { IndicadoresProjetos, IndicadoresProjetosData, KpisAtividades, SituacaoKpi } from "../../components/projetos/IndicadoresProjetos";
import { AtividadeDetalhe } from "../../components/projetos/AtividadeDetalhe";
import { CalendarioAtividades } from "../../components/projetos/CalendarioAtividades";
import { TimelineAtividades } from "../../components/projetos/TimelineAtividades";
import { WorkloadConsultores } from "../../components/projetos/WorkloadConsultores";
import { useToast } from "../../components/ui/Toast";
import { RAIA_A_FAZER, RAIA_EM_ANDAMENTO } from "../../lib/atividade-acoes";

type Visao = "quadro" | "lista" | "calendario" | "timeline" | "workload";
const VISOES: Visao[] = ["quadro", "lista", "calendario", "timeline", "workload"];
const SITUACOES_VALIDAS: SituacaoKpi[] = ["backlog", "atrasadas", "concluidas"];
const PAGE_SIZE = 25;

interface OpcaoFiltro {
  value: number;
  label: string;
}

interface DetalheSelecionado extends DetalheInfo {
  id: number;
}

interface FiltrosPatch {
  visao?: Visao;
  busca?: string;
  depexe?: string;
  colunaId?: string;
  pripro?: string;
  codfor?: string;
  atrasada?: boolean;
  situacao?: SituacaoKpi | null;
  page?: number;
}

export function Atividades() {
  // Filtros e visão ficam sincronizados na URL — mesmo padrão da Alocação: voltar de
  // uma navegação (ex.: detalhe da proposta) preserva o estado em vez de resetar.
  const [searchParams, setSearchParams] = useSearchParams();

  const visaoParam = searchParams.get("visao");
  const [visao, setVisaoState] = useState<Visao>(VISOES.includes(visaoParam as Visao) ? (visaoParam as Visao) : "quadro");
  const [busca, setBuscaState] = useState(searchParams.get("busca") ?? "");
  const [depexe, setDepexeState] = useState(searchParams.get("depexe") ?? "");
  const [colunaId, setColunaIdState] = useState(searchParams.get("colunaId") ?? "");
  const [pripro, setPriproState] = useState(searchParams.get("pripro") ?? "");
  const [codfor, setCodforState] = useState(searchParams.get("codfor") ?? "");
  const [atrasada, setAtrasadaState] = useState(searchParams.get("atrasada") === "true");
  const situacaoParam = searchParams.get("situacao");
  const [situacao, setSituacaoState] = useState<SituacaoKpi | null>(
    SITUACOES_VALIDAS.includes(situacaoParam as SituacaoKpi) ? (situacaoParam as SituacaoKpi) : null
  );
  // Number("") é 0 (não NaN) — sem o parâmetro na URL isso viraria erroneamente "página 0".
  const paginaParam = searchParams.get("page");
  const [page, setPageState] = useState(paginaParam ? Number(paginaParam) : 1);

  const [colunas, setColunas] = useState<ColunaKanban[]>([]);
  const [departamentos, setDepartamentos] = useState<OpcaoFiltro[]>([]);
  const [prioridades, setPrioridades] = useState<OpcaoFiltro[]>([]);
  const [consultores, setConsultores] = useState<OpcaoFiltro[]>([]);
  const [atividades, setAtividades] = useState<AtividadeKanban[]>([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState<KpisAtividades | null>(null);
  const [indicadores, setIndicadores] = useState<IndicadoresProjetosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheSelecionado | null>(null);
  const [processando, setProcessando] = useState<Set<number>>(new Set());
  const toast = useToast();

  function atualizarFiltros(patch: FiltrosPatch) {
    const mudouFiltro =
      patch.busca !== undefined ||
      patch.depexe !== undefined ||
      patch.colunaId !== undefined ||
      patch.pripro !== undefined ||
      patch.codfor !== undefined ||
      patch.atrasada !== undefined ||
      patch.situacao !== undefined;
    const proximo = {
      visao: patch.visao ?? visao,
      busca: patch.busca ?? busca,
      depexe: patch.depexe ?? depexe,
      colunaId: patch.colunaId ?? colunaId,
      pripro: patch.pripro ?? pripro,
      codfor: patch.codfor ?? codfor,
      atrasada: patch.atrasada ?? atrasada,
      situacao: patch.situacao !== undefined ? patch.situacao : situacao,
      page: patch.page ?? (mudouFiltro ? 1 : page),
    };
    setVisaoState(proximo.visao);
    setBuscaState(proximo.busca);
    setDepexeState(proximo.depexe);
    setColunaIdState(proximo.colunaId);
    setPriproState(proximo.pripro);
    setCodforState(proximo.codfor);
    setAtrasadaState(proximo.atrasada);
    setSituacaoState(proximo.situacao);
    setPageState(proximo.page);

    const params = new URLSearchParams();
    if (proximo.visao !== "quadro") params.set("visao", proximo.visao);
    if (proximo.busca) params.set("busca", proximo.busca);
    if (proximo.depexe) params.set("depexe", proximo.depexe);
    if (proximo.colunaId) params.set("colunaId", proximo.colunaId);
    if (proximo.pripro) params.set("pripro", proximo.pripro);
    if (proximo.codfor) params.set("codfor", proximo.codfor);
    if (proximo.atrasada) params.set("atrasada", "true");
    if (proximo.situacao) params.set("situacao", proximo.situacao);
    if (proximo.page > 1) params.set("page", String(proximo.page));
    setSearchParams(params, { replace: true });
  }

  // Clicar num KPI vira o único critério de "situação" da lista/quadro; clicar de novo
  // desliga. Também zera "só atrasadas" pra não ficarem contraditórios (ex.: KPI
  // "concluídas" + checkbox "atrasada" nunca bateria com nenhuma linha).
  function clicarKpi(tipo: SituacaoKpi) {
    if (situacao === tipo) {
      atualizarFiltros({ situacao: null });
      return;
    }
    atualizarFiltros({ situacao: tipo, atrasada: false });
  }

  function carregar() {
    setLoading(true);
    axios
      .get("/api/atividades", {
        params: {
          busca: busca || undefined,
          depexe: depexe || undefined,
          colunaId: colunaId || undefined,
          pripro: pripro || undefined,
          codfor: codfor || undefined,
          atrasada: atrasada || undefined,
          situacao: situacao || undefined,
          // Só a visão "lista" pagina — as demais precisam do conjunto completo já filtrado.
          page: visao === "lista" ? page : undefined,
          pageSize: visao === "lista" ? PAGE_SIZE : undefined,
        },
      })
      .then(({ data }) => {
        setAtividades(data.rows);
        setTotal(data.total);
        setKpis(data.kpis);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar atividades"))
      .finally(() => setLoading(false));
  }

  function carregarIndicadores() {
    axios.get("/api/atividades/indicadores").then(({ data }) => setIndicadores(data));
  }

  useEffect(() => {
    Promise.all([axios.get("/api/atividades/quadro-colunas"), axios.get("/api/atividades/opcoes-filtro")]).then(
      ([colunasRes, opcoesRes]) => {
        setColunas(colunasRes.data.colunas);
        setDepartamentos(opcoesRes.data.departamentos);
        setPrioridades(opcoesRes.data.prioridades);
        setConsultores(opcoesRes.data.consultores);
      }
    );
    carregarIndicadores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visao, busca, depexe, colunaId, pripro, codfor, atrasada, situacao, page]);

  async function moverAtividade(atividadeId: number, novaColunaId: number) {
    const anterior = atividades;
    setAtividades((atual) => atual.map((a) => (a.id === atividadeId ? { ...a, colunaId: novaColunaId } : a)));
    try {
      await axios.patch(`/api/atividades/${atividadeId}/mover`, { colunaId: novaColunaId });
      carregar();
      carregarIndicadores();
    } catch (err: any) {
      setAtividades(anterior);
      setErro(err.response?.data?.error ?? "Falha ao mover atividade");
    }
  }

  async function iniciarAtividade(atividadeId: number) {
    const colunaEmAndamento = colunas.find((c) => c.nome === RAIA_EM_ANDAMENTO) ?? null;
    const alvo = atividades.find((a) => a.id === atividadeId);
    const anterior = atividades;
    setProcessando((atual) => new Set(atual).add(atividadeId));
    // Otimista: já mostra o card em "Em Andamento" com o cronômetro começando agora;
    // se o servidor recusar (409/403) ou pausar outra atividade, `carregar()` corrige
    // tudo de qualquer forma — o rollback abaixo só cobre erro de rede/servidor fora do ar.
    if (colunaEmAndamento) {
      setAtividades((atual) =>
        atual.map((a) =>
          a.id === atividadeId
            ? { ...a, colunaId: colunaEmAndamento.id, coluna: colunaEmAndamento, sessaoAtualInicio: new Date().toISOString() }
            : a
        )
      );
    }
    try {
      const { data } = await axios.post(`/api/atividades/${atividadeId}/start`);
      if (data.pausada) {
        toast.mostrar(
          `Atividade ${data.pausada.titulo} foi pausada para iniciar a Proposta ${alvo?.codpro ?? atividadeId}`,
          "warning"
        );
      }
      carregar();
      carregarIndicadores();
    } catch (err: any) {
      setAtividades(anterior);
      toast.mostrar(err.response?.data?.error ?? "Falha ao iniciar atividade", "destructive");
    } finally {
      setProcessando((atual) => {
        const proximo = new Set(atual);
        proximo.delete(atividadeId);
        return proximo;
      });
    }
  }

  async function pararAtividade(atividadeId: number) {
    const colunaAFazer = colunas.find((c) => c.nome === RAIA_A_FAZER) ?? null;
    const anterior = atividades;
    setProcessando((atual) => new Set(atual).add(atividadeId));
    if (colunaAFazer) {
      setAtividades((atual) =>
        atual.map((a) =>
          a.id === atividadeId ? { ...a, colunaId: colunaAFazer.id, coluna: colunaAFazer, sessaoAtualInicio: null } : a
        )
      );
    }
    try {
      await axios.post(`/api/atividades/${atividadeId}/stop`);
      carregar();
      carregarIndicadores();
    } catch (err: any) {
      setAtividades(anterior);
      toast.mostrar(err.response?.data?.error ?? "Falha ao parar atividade", "destructive");
    } finally {
      setProcessando((atual) => {
        const proximo = new Set(atual);
        proximo.delete(atividadeId);
        return proximo;
      });
    }
  }

  function abrirDetalhe(atividadeId: number, info: DetalheInfo) {
    setDetalhe({ id: atividadeId, ...info });
  }

  const tabClass = (ativa: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      ativa ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

  const filtros: FiltrosAtividades = { busca, depexe, colunaId, pripro, codfor, atrasada };

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Atividades
      </p>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Atividades</h1>
          <p className="mt-1 text-sm text-muted">Acompanhe e movimente as atividades das propostas do seu time.</p>
        </div>
        <div className="flex flex-wrap gap-2 rounded-md border border-border p-1">
          <button onClick={() => atualizarFiltros({ visao: "quadro" })} className={tabClass(visao === "quadro")}>
            Quadro
          </button>
          <button onClick={() => atualizarFiltros({ visao: "lista" })} className={tabClass(visao === "lista")}>
            Lista
          </button>
          <button onClick={() => atualizarFiltros({ visao: "calendario" })} className={tabClass(visao === "calendario")}>
            Calendário
          </button>
          <button onClick={() => atualizarFiltros({ visao: "timeline" })} className={tabClass(visao === "timeline")}>
            Timeline
          </button>
          <button onClick={() => atualizarFiltros({ visao: "workload" })} className={tabClass(visao === "workload")}>
            Workload
          </button>
        </div>
      </div>

      <IndicadoresProjetos dados={indicadores} kpis={kpis} situacaoAtiva={situacao} onKpiClick={clicarKpi} loading={loading} />

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {visao === "lista" ? (
        <AtividadesTable
          rows={atividades}
          total={total}
          page={page}
          loading={loading}
          colunas={colunas}
          departamentos={departamentos}
          prioridades={prioridades}
          consultores={consultores}
          filtros={filtros}
          situacaoKpi={situacao}
          onFiltros={(patch) => atualizarFiltros(patch)}
          onPageChange={(novaPagina) => atualizarFiltros({ page: novaPagina })}
          onLimparKpi={() => atualizarFiltros({ situacao: null })}
          onMover={moverAtividade}
          onAbrirDetalhe={abrirDetalhe}
          onIniciar={iniciarAtividade}
          onParar={pararAtividade}
          processando={processando}
        />
      ) : loading && atividades.length === 0 ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : visao === "quadro" ? (
        <div>
          <AtividadesFiltros
            colunas={colunas}
            departamentos={departamentos}
            prioridades={prioridades}
            consultores={consultores}
            filtros={filtros}
            situacaoKpi={situacao}
            onFiltros={(patch) => atualizarFiltros(patch)}
            onLimparKpi={() => atualizarFiltros({ situacao: null })}
          />
          <KanbanBoard
            colunas={colunas}
            atividades={atividades}
            onMover={moverAtividade}
            onAbrirDetalhe={abrirDetalhe}
            onIniciar={iniciarAtividade}
            onParar={pararAtividade}
            processando={processando}
          />
        </div>
      ) : visao === "calendario" ? (
        <CalendarioAtividades atividades={atividades} onAbrirDetalhe={abrirDetalhe} />
      ) : visao === "timeline" ? (
        <TimelineAtividades atividades={atividades} onAbrirDetalhe={abrirDetalhe} />
      ) : (
        <WorkloadConsultores
          itens={indicadores?.porConsultor ?? []}
          porSituacao={indicadores?.porSituacao ?? []}
          porDepartamento={indicadores?.porDepartamento ?? []}
        />
      )}

      {detalhe && (
        <AtividadeDetalhe
          atividadeId={detalhe.id}
          titulo={detalhe.titulo}
          podeEditar={detalhe.podeEditar}
          dataPrevistaInicio={detalhe.dataPrevistaInicio}
          dataPrevistaFim={detalhe.dataPrevistaFim}
          codemp={detalhe.codemp}
          codpro={detalhe.codpro}
          itemDescricao={detalhe.itemDescricao}
          itemQtdhor={detalhe.itemQtdhor}
          itemAlocado={detalhe.itemAlocado}
          itemRealizado={detalhe.itemRealizado}
          estruturaNome={detalhe.estruturaNome}
          estruturaPercentual={detalhe.estruturaPercentual}
          podeVerCronograma={detalhe.podeVerCronograma}
          onClose={() => setDetalhe(null)}
        />
      )}
    </div>
  );
}
