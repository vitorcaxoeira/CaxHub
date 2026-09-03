import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AtividadeKanban, ColunaKanban, DetalheInfo, KanbanBoard } from "../../components/projetos/KanbanBoard";
import { AtividadesTable, FiltrosAtividades } from "../../components/projetos/AtividadesTable";
import { AtividadesFiltros } from "../../components/projetos/AtividadesFiltros";
import { IndicadoresProjetos, IndicadoresProjetosData, KpisAtividades, SituacaoKpi } from "../../components/projetos/IndicadoresProjetos";
import { AtividadeDetalhe } from "../../components/projetos/AtividadeDetalhe";
import { ModalObservacaoAtividade } from "../../components/projetos/ModalObservacaoAtividade";
import { CalendarioAtividades } from "../../components/projetos/CalendarioAtividades";
import { TimelineAtividades } from "../../components/projetos/TimelineAtividades";
import { WorkloadConsultores } from "../../components/projetos/WorkloadConsultores";
import { useToast } from "../../components/ui/Toast";
import { RAIA_A_FAZER, RAIA_EM_ANDAMENTO } from "../../lib/atividade-acoes";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { EVENTO_SESSAO_ALTERADA, avisarSessaoAlterada } from "../../components/projetos/VigiaFimDeJornada";

type Visao = "quadro" | "lista" | "calendario" | "timeline" | "workload";
const VISOES: Visao[] = ["quadro", "lista", "calendario", "timeline", "workload"];
const SITUACOES_VALIDAS: SituacaoKpi[] = ["backlog", "atrasadas", "concluidas"];

interface OpcaoFiltro {
  value: number;
  label: string;
}

interface DetalheSelecionado extends DetalheInfo {
  id: number;
}

// Pedido de observação ao sair de "Em Andamento" (mover o card ou clicar Parar) — abre
// o ModalObservacaoAtividade antes de chamar a API de verdade, ver
// moverAtividade/pararAtividade abaixo.
interface PedidoObservacao {
  atividadeId: number;
  novaColunaId?: number; // presente só quando tipo === "mover"
  // "nota" (28/08/2026): salva progresso SEM parar — ver editarNotaEmAndamento abaixo.
  tipo: "mover" | "parar" | "nota";
  titulo: string;
  // Descrição da atividade (ou a nota de progresso já salva, se houver — o servidor decide
  // qual das duas), pra abrir o campo já preenchido. Vem do servidor na linha.
  descricaoPadrao: string | null;
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
  // Só o texto digitado é "vivo" (reflete na URL e no input a cada tecla); o disparo do
  // GET /api/atividades espera o debounce, senão cada tecla recalcula o quadro inteiro.
  const buscaDebounced = useDebouncedValue(busca, 400);
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
  // O padrão do filtro de consultor (só eu, ou sem recorte se sou gestor) vem do backend,
  // junto das opções — é lá que mora a definição de "gestor". Enquanto ele não chega o
  // GET /api/atividades fica segurado: disparar antes traria o quadro de todo mundo por
  // uma fração de segundo, pra logo depois encolher pro meu.
  const [padraoResolvido, setPadraoResolvido] = useState(false);
  // A URL manda no padrão: chegar em /projetos/atividades?codfor=... (link compartilhado,
  // voltar de um detalhe) tem que preservar a seleção. Lido uma vez, na montagem.
  const urlTinhaCodfor = useRef(searchParams.get("codfor") !== null);
  const [atividades, setAtividades] = useState<AtividadeKanban[]>([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState<KpisAtividades | null>(null);
  const [indicadores, setIndicadores] = useState<IndicadoresProjetosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheSelecionado | null>(null);
  const [processando, setProcessando] = useState<Set<number>>(new Set());
  const [pedidoObservacao, setPedidoObservacao] = useState<PedidoObservacao | null>(null);
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
          busca: buscaDebounced || undefined,
          depexe: depexe || undefined,
          colunaId: colunaId || undefined,
          pripro: pripro || undefined,
          codfor: codfor || undefined,
          atrasada: atrasada || undefined,
          situacao: situacao || undefined,
          // Nenhuma visão pagina no servidor: a Lista agrupa por proposta + consultor e
          // pagina por GRUPO, então precisa do conjunto completo — paginar por atividade
          // partiria um grupo ao meio entre duas páginas. As demais visões sempre
          // precisaram do conjunto inteiro.
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
    Promise.all([axios.get("/api/atividades/quadro-colunas"), axios.get("/api/atividades/opcoes-filtro")])
      .then(([colunasRes, opcoesRes]) => {
        setColunas(colunasRes.data.colunas);
        setDepartamentos(opcoesRes.data.departamentos);
        setPrioridades(opcoesRes.data.prioridades);
        setConsultores(opcoesRes.data.consultores);
        const padrao: number[] = opcoesRes.data.consultorPadrao ?? [];
        if (!urlTinhaCodfor.current && padrao.length > 0) atualizarFiltros({ codfor: padrao.join(",") });
      })
      // `finally`, não `then`: se as opções falharem o padrão não vem, mas a lista ainda
      // tem que carregar — segurar pra sempre deixaria a tela vazia por causa de um filtro.
      .finally(() => setPadraoResolvido(true));
    carregarIndicadores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!padraoResolvido) return;
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padraoResolvido, visao, buscaDebounced, depexe, colunaId, pripro, codfor, atrasada, situacao, page]);

  // O VigiaFimDeJornada vive no AppShell e não compartilha estado com esta tela. Quando
  // ele prorroga ou encerra uma sessão, o card aqui ainda está com o `sessaoLimite`
  // antigo — e o cronômetro fica congelado no limite vencido mesmo depois do consultor
  // confirmar que ia trabalhar mais. Este ouvinte é o que destrava.
  //
  // `iniciarAtividade` (Kanban e Lista) também dispara este mesmo evento ao iniciar com
  // sucesso — e é aí que o bug aparecia: com `[]` de dependência, o efeito assina o
  // listener UMA vez só, na montagem, e a função `recarregar` fechava sobre o `carregar`
  // daquele primeiro render — que por sua vez tinha fechado sobre `codfor` (e os demais
  // filtros) como estavam ANTES do padrão "só eu" ser aplicado (ele chega depois, via
  // GET /opcoes-filtro, assíncrono). Resultado: o chip do filtro e a URL mostravam o
  // consultor certo, mas cada início de atividade recarregava com os filtros de quando a
  // tela abriu, sem o `codfor`, e sobrescrevia a lista com a de todo mundo.
  //
  // Refs "ao vivo" em vez de por no array de dependências: `carregar`/`carregarIndicadores`
  // são funções simples, recriadas a cada render (não memoizadas), então guardar a mais
  // recente aqui e reassinar o listener sempre que o filtro mudar teria o mesmo efeito com
  // mais churn de addEventListener/removeEventListener — e, principal motivo, deixaria a
  // correção refém de alguém lembrar de incluir todo filtro novo nas duas listas de
  // dependência (a desta e a do efeito de cima) pra sempre ficarem em sincronia.
  const carregarRef = useRef(carregar);
  carregarRef.current = carregar;
  const carregarIndicadoresRef = useRef(carregarIndicadores);
  carregarIndicadoresRef.current = carregarIndicadores;
  useEffect(() => {
    function recarregar() {
      carregarRef.current();
      carregarIndicadoresRef.current();
    }
    window.addEventListener(EVENTO_SESSAO_ALTERADA, recarregar);
    return () => window.removeEventListener(EVENTO_SESSAO_ALTERADA, recarregar);
  }, []);

  // Baixa imediata da sessão que atingiu o limite (teto de horas ou fim do expediente).
  // Sem isto o card fica visivelmente correndo além do que vai contar até a varredura
  // passar, de 5 em 5 minutos — a varredura continua existindo como rede de segurança pra
  // quem fechou o navegador, e grava exatamente o mesmo instante.
  //
  // UM efeito pra todas as atividades, e não um por card: com N cards vencidos, um por
  // card dispararia N requisições concorrentes e cada `carregar()` remontaria a lista no
  // meio das outras. O tique é de 30s porque o instante gravado não depende de quando a
  // baixa sai — só a percepção na tela.
  const encerramentosDisparados = useRef<Set<string>>(new Set());
  useEffect(() => {
    // SÓ teto de horas. O limite de expediente passou a ser tratado pelo VigiaFimDeJornada,
    // que pergunta antes de encerrar; se este efeito continuasse pegando expediente,
    // encerraria a sessão sem esperar a resposta, competindo com o vigia.
    const vencidas = () =>
      atividades.filter(
        (a) =>
          a.sessaoAtualInicio &&
          a.sessaoLimite &&
          a.sessaoLimiteMotivo === "teto_atingido" &&
          new Date(a.sessaoLimite).getTime() <= Date.now()
      );

    async function encerrarVencidas() {
      for (const a of vencidas()) {
        // Chave inclui o início da sessão: uma sessão NOVA na mesma atividade precisa
        // poder ser encerrada de novo mais tarde.
        const chave = `${a.id}-${a.sessaoAtualInicio}`;
        if (encerramentosDisparados.current.has(chave)) continue;
        encerramentosDisparados.current.add(chave);
        try {
          const { data } = await axios.post(`/api/atividades/${a.id}/encerrar-automatico`);
          if (data?.encerrada) {
            toast.mostrar(`Proposta ${a.codpro}: ${data.mensagem}`, "warning");
            carregar();
            carregarIndicadores();
          }
        } catch {
          // 409 = o servidor recalculou e ainda não venceu (relógio do navegador
          // adiantado). Libera a chave pra tentar de novo no próximo tique.
          encerramentosDisparados.current.delete(chave);
        }
      }
    }

    encerrarVencidas();
    const intervalo = setInterval(encerrarVencidas, 30_000);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atividades]);

  async function executarMovimentacao(atividadeId: number, novaColunaId: number, observacao: string | null) {
    const anterior = atividades;
    const alvo = atividades.find((a) => a.id === atividadeId);
    setAtividades((atual) => atual.map((a) => (a.id === atividadeId ? { ...a, colunaId: novaColunaId } : a)));
    try {
      const { data } = await axios.patch(`/api/atividades/${atividadeId}/mover`, {
        colunaId: novaColunaId,
        observacao: observacao || undefined,
      });
      // Regra de 1 atividade em andamento por consultor: arrastar um card pra "Em Andamento"
      // com outro já lá pausa o outro automaticamente — mesmo aviso que o botão Iniciar já
      // mostra (ver iniciarAtividade), pra não sumir uma atividade sem explicação.
      if (data?.pausada) {
        toast.mostrar(
          `Atividade ${data.pausada.titulo} foi pausada para iniciar a Proposta ${alvo?.codpro ?? atividadeId}`,
          "warning"
        );
      }
      // Só vem preenchido quando o card ENTROU em execução perto do teto (ver
      // avaliarEntradaEmExecucao) — arrastar pra qualquer outra raia nunca avisa.
      if (data?.aviso) toast.mostrar(data.aviso, "warning");
      // Saiu de execução DEPOIS do limite: o servidor cortou o fim no teto/expediente e o
      // tempo além disso não foi registrado — sem este aviso ele sumiria sem explicação.
      if (data?.fimCortado) toast.mostrar(data.fimCortado, "warning");
      carregar();
      carregarIndicadores();
    } catch (err: any) {
      setAtividades(anterior);
      // Teto estourado volta 409 e é o caso mais provável aqui — o toast dá mais destaque
      // que a faixa de erro do topo, que passa despercebida depois de arrastar um card.
      const mensagem = err.response?.data?.error ?? "Falha ao mover atividade";
      if (err.response?.status === 409) toast.mostrar(mensagem, "destructive");
      else setErro(mensagem);
    }
  }

  // Sair de "Em Andamento" (mover pra qualquer outra coluna) pede uma observação rápida
  // antes de mover de verdade — ver PedidoObservacao/resolverPedidoObservacao.
  function moverAtividade(atividadeId: number, novaColunaId: number) {
    const alvo = atividades.find((a) => a.id === atividadeId);
    if (alvo?.coluna?.nome === RAIA_EM_ANDAMENTO && alvo.colunaId !== novaColunaId) {
      setPedidoObservacao({
        atividadeId,
        novaColunaId,
        tipo: "mover",
        titulo: `Proposta ${alvo.codpro}`,
        descricaoPadrao: alvo.descricaoPadrao,
      });
      return;
    }
    executarMovimentacao(atividadeId, novaColunaId, null);
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
      // Teto de horas perto do fim: a atividade iniciou, mas o consultor precisa saber
      // agora — descobrir só na hora de confirmar o apontamento seria tarde.
      if (data.aviso) toast.mostrar(data.aviso, "warning");
      // Iniciar fora do expediente cria uma sessao cujo limite ja nasce vencido: o vigia
      // precisa consultar AGORA pra abrir o alerta, em vez de so no proximo tique de 30s.
      avisarSessaoAlterada();
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

  async function executarParada(atividadeId: number, observacao: string | null) {
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
      const { data } = await axios.post(`/api/atividades/${atividadeId}/stop`, { observacao: observacao || undefined });
      // Parou depois do limite: o servidor cortou o fim no teto/expediente. Avisar é o que
      // impede o consultor de achar que o tempo todo foi registrado.
      if (data?.fimCortado) toast.mostrar(data.fimCortado, "warning");
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

  // "Parar" só existe quando a atividade já está em "Em Andamento" (podeParar), então
  // sempre pede a observação antes de parar de verdade.
  function pararAtividade(atividadeId: number) {
    const alvo = atividades.find((a) => a.id === atividadeId);
    setPedidoObservacao({
      atividadeId,
      tipo: "parar",
      titulo: `Proposta ${alvo?.codpro ?? atividadeId}`,
      descricaoPadrao: alvo?.descricaoPadrao ?? null,
    });
  }

  // Salva um rascunho do que está sendo feito SEM parar o cronômetro (28/08/2026) — mesmo
  // modal do "Parar", pergunta e rótulo de fechar diferentes (ver resolverPedidoObservacao e
  // o render do modal mais abaixo).
  function editarNotaEmAndamento(atividadeId: number) {
    const alvo = atividades.find((a) => a.id === atividadeId);
    setPedidoObservacao({
      atividadeId,
      tipo: "nota",
      titulo: `Proposta ${alvo?.codpro ?? atividadeId}`,
      descricaoPadrao: alvo?.descricaoPadrao ?? null,
    });
  }

  async function executarSalvarNota(atividadeId: number, texto: string) {
    setProcessando((atual) => new Set(atual).add(atividadeId));
    try {
      await axios.patch(`/api/atividades/${atividadeId}/observacao`, { observacao: texto });
      // Recarrega pra já vir com o texto fresco do servidor — reabrir o lápis (mesmo depois
      // de F5) precisa mostrar o que acabou de ser salvo, não a descrição genérica.
      carregar();
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao salvar a observação", "destructive");
    } finally {
      setProcessando((atual) => {
        const proximo = new Set(atual);
        proximo.delete(atividadeId);
        return proximo;
      });
    }
  }

  function resolverPedidoObservacao(observacao: string | null) {
    if (!pedidoObservacao) return;
    const { atividadeId, novaColunaId, tipo } = pedidoObservacao;
    setPedidoObservacao(null);
    if (tipo === "mover" && novaColunaId != null) executarMovimentacao(atividadeId, novaColunaId, observacao);
    else if (tipo === "parar") executarParada(atividadeId, observacao);
    else if (tipo === "nota") executarSalvarNota(atividadeId, observacao ?? "");
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
          onEditarNota={editarNotaEmAndamento}
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
            onEditarNota={editarNotaEmAndamento}
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
          horasRealizadas={detalhe.horasRealizadas}
          estruturaNome={detalhe.estruturaNome}
          estruturaPercentual={detalhe.estruturaPercentual}
          podeVerCronograma={detalhe.podeVerCronograma}
          qtdhorPrevisto={detalhe.qtdhorPrevisto}
          horasExcedentes={detalhe.horasExcedentes}
          podeAutorizarExcedente={detalhe.podeAutorizarExcedente}
          souOExecutor={detalhe.souOExecutor}
          bloqueadoApontamento={detalhe.bloqueadoApontamento}
          bloqueadoExcedente={detalhe.bloqueadoExcedente}
          // Mudar o excedente muda o teto do card, então a lista/quadro recarrega.
          onExcedenteAlterado={carregar}
          onClose={() => setDetalhe(null)}
        />
      )}

      {pedidoObservacao && (
        <ModalObservacaoAtividade
          titulo={pedidoObservacao.titulo}
          descricaoPadrao={pedidoObservacao.descricaoPadrao}
          onConfirmar={(texto) => resolverPedidoObservacao(texto || null)}
          // "nota": fechar é cancelar de verdade, sem salvar nada — diferente de
          // "parar"/"mover", onde "Pular" ainda executa a ação (só sem texto digitado).
          onFechar={() => (pedidoObservacao.tipo === "nota" ? setPedidoObservacao(null) : resolverPedidoObservacao(null))}
          {...(pedidoObservacao.tipo === "nota"
            ? { pergunta: "O que está sendo feito?", rotuloFechar: "Cancelar" }
            : {})}
        />
      )}
    </div>
  );
}
