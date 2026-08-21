import axios from "axios";
import { Fragment, useEffect, useState } from "react";
import { Skeleton } from "../../components/ui/Skeleton";
import { Modal } from "../../components/ui/Modal";
import { SelectBuscavel, OpcaoBuscavel } from "../../components/ui/SelectBuscavel";

interface JobSync {
  jobName: string;
  displayName: string;
  ordemExecucao: number;
  totalRegistros: number;
  suportaAlterados: boolean;
  // Campo de ORIGEM do corte incremental (ex.: "DatAtu"), ou `null` quando !suportaAlterados —
  // pedido do Vitor (21/08/2026): oferece a variável "última sincronização" só na linha do
  // editor de Filtro(Alterados) cujo campo é este.
  campoData: string | null;
  ultimaSincronizacao: string | null;
  ultimoStatus: string | null;
  // Mensagem da última execução — hoje carrega tanto o erro (quando ultimoStatus é
  // "error") quanto o resumo da varredura de removidos (quando é "success"). Quem decide
  // a cor é o status, não a presença da mensagem.
  ultimaMensagem: string | null;
  // Quanto a última execução levou, do início ao fim — inclusive quando terminou em erro.
  // null: log anterior a 20/08/2026, ou uma sync unitária que reaproveita o jobName do job
  // agendado sem passar pelo carimbo (ex.: "Sinc. ERP" de 1 proposta em Alocação).
  ultimaDuracaoMs: number | null;
  // null = tabela ainda sem detecção de exclusão no Senior (a maioria hoje).
  totalRemovidos: number | null;
  // Resultado da última VARREDURA, que pode ser bem mais antiga que a última
  // sincronização: o modo "Alterados" nunca varre. `detectados` é o que ela achou — em
  // modo "simular" isso é > 0 enquanto totalRemovidos continua 0, porque nada foi gravado.
  ultimaVarredura: { modo: string; detectados: number; em: string } | null;
  temDeteccao: boolean;
  // Fase 3/4 do plano de filtros — true nos 35 jobs cujo `run()` já lê o filtro salvo
  // (JOBS_COM_FILTRO, registry.ts). As abas "Filtro(Todos)"/"Filtro(Alterados)" só aparecem
  // nas tabelas onde isso é true.
  suportaFiltro: boolean;
  // Fase 6 — um filtro por MODO, independentes. true = já existe filtro salvo nesse modo
  // (vira o indicador "●" no nome). O conteúdo só é buscado ao abrir a aba correspondente
  // (GET .../filtro/:modo) — a lista não traz o JSON de todo filtro no polling de 10s.
  temFiltroTodos: boolean;
  temFiltroAlterados: boolean;
  proximaExecucao: string;
  emAndamento: boolean;
}

interface ItemRemovido {
  chave: string;
  rotulo: string;
  removidoEmSenior: string | null;
  marcado: boolean;
}

// Catálogo de campos filtráveis (Fase 2 do plano de filtros na importação) — só leitura,
// nenhum filtro é aplicado ainda. `fonte: "espelhado"` é o caminho instantâneo (sem SOAP,
// GET /:jobName/campos); `fonte: "erp"` é o dicionário completo do Senior, sob demanda
// (GET /:jobName/campos?fonte=erp), pode levar alguns segundos (round-trip SOAP, cacheado
// no backend por 12h depois da primeira consulta).
interface CampoCatalogo {
  origem: string;
  alias: string | null;
  espelhado: boolean;
  tipoPrisma: string | null;
  nullable: boolean | null;
  descricao: string | null;
  dominio: string | null;
  valoresDominio: { chave: string; rotulo: string }[] | null;
  observacao: string | null;
}

interface RespostaCampos {
  fonte: "espelhado" | "erp";
  campos: CampoCatalogo[];
}

// Filtro por tabela (Fase 3 do plano de filtros na importação) — hoje só pedidos-sync
// (job.suportaFiltro). Operador é sempre uma dessas 8 strings, EXATAMENTE como o backend
// espera (sync/filtroSenior.ts:OperadorFiltro) — inclusive os caracteres ≠/≥/≤.
type OperadorFiltro = "=" | "≠" | "IN" | "≥" | "≤" | "entre" | "contém" | "começa com";

const OPERADORES: { valor: OperadorFiltro; rotulo: string }[] = [
  { valor: "=", rotulo: "= (igual a)" },
  { valor: "≠", rotulo: "≠ (diferente de)" },
  { valor: "IN", rotulo: "está em (lista)" },
  { valor: "≥", rotulo: "≥ (maior ou igual)" },
  { valor: "≤", rotulo: "≤ (menor ou igual)" },
  { valor: "entre", rotulo: "entre" },
  { valor: "contém", rotulo: "contém" },
  { valor: "começa com", rotulo: "começa com" },
];

interface PredicadoFiltro {
  campo: string;
  operador: OperadorFiltro;
  valores: string[];
}

// Valor-sentinela pro pedido do Vitor (21/08/2026): em vez do corte de data do modo Alterados
// ficar escondido dentro do job, o campo de data pode ser um predicado de verdade com este
// valor especial — resolvido pra "data da última sincronização com sucesso" em tempo de
// execução (nunca uma data fixa gravada). Mesmo token de sync/filtroSenior.ts (backend); só
// pode ser usado em campo de data com operador =, ≥ ou ≤, e só salvo em Filtro(Alterados).
const VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO = "@ultima_sincronizacao";
const OPERADORES_QUE_ACEITAM_VARIAVEL: OperadorFiltro[] = ["=", "≥", "≤"];

// Valor de opção do <select> de campo em PainelFiltro que NÃO é um nome de campo de verdade —
// selecioná-la carrega o catálogo completo do ERP (`fonte=erp`, round-trip SOAP) em vez de
// virar o valor do predicado. Pedido do Vitor, 21/08/2026.
const OPCAO_VER_TODOS_CAMPOS = "__ver_todos_campos_erp__";

interface RespostaFiltro {
  predicados: PredicadoFiltro[];
  predicadosSql: string[];
  escopavel: boolean;
  motivoNaoEscopavel: string | null;
  atualizadoEm?: string | null;
  // Fase 6 — só vem no PUT de "todos", só quando a tabela tem modo "Alterados": true quando
  // o que "Alterados" tem salvo (ou não tem nada) difere do que acabou de ser salvo em
  // "todos". É o gatilho do aviso dispensável "aplicar também no Alterados?".
  alteradosDivergente?: boolean;
}

interface RespostaPreview {
  query: string;
  escopavel: boolean;
  motivoNaoEscopavel: string | null;
}

// Dimensões e propagação (Fase 4) — um campo com o MESMO sentido em várias tabelas (hoje só
// "codemp"/Empresa). `alcancados` são as tabelas que têm a coluna; `filtravel: false` marca
// as 2 views sem dicionário do Senior (têm a coluna, mas nenhum predicado pode ser validado
// nelas). `cadastroCompartilhado` são as tabelas SEM a dimensão — ficam sempre completas por
// construção (filtrar quebraria quem depende delas por valor).
interface DimensaoJobAlcancado {
  jobName: string;
  displayName: string;
  origem: string;
  filtravel: boolean;
}

interface DimensaoInfo {
  chave: string;
  rotulo: string;
  alcancados: DimensaoJobAlcancado[];
  cadastroCompartilhado: { jobName: string; displayName: string }[];
}

interface ResultadoPropagacao {
  jobName: string;
  displayName: string;
  ok: boolean;
  query?: string;
  escopavel?: boolean;
  erro?: string;
  // Fase 5 (recorte retroativo) — quantas linhas locais desta tabela sairiam do recorte.
  linhasQueSaem?: number | null;
  suportaMarcar?: boolean;
}

// Rascunho editável de uma linha do formulário — separado de PredicadoFiltro porque a UI
// trabalha com 1-2 campos de texto (valorTexto/valorTexto2), não o array `valores` já
// serializado que o backend espera (IN é lista separada por vírgula, "entre" usa os dois
// campos, os demais operadores usam só valorTexto).
interface RascunhoPredicado {
  campo: string;
  operador: OperadorFiltro;
  valorTexto: string;
  valorTexto2: string;
}

function rascunhoVazio(): RascunhoPredicado {
  return { campo: "", operador: "=", valorTexto: "", valorTexto2: "" };
}

function rascunhoParaPredicado(r: RascunhoPredicado): PredicadoFiltro {
  const valores =
    r.operador === "entre"
      ? [r.valorTexto.trim(), r.valorTexto2.trim()]
      : r.operador === "IN"
      ? r.valorTexto.split(",").map((v) => v.trim()).filter(Boolean)
      : [r.valorTexto.trim()];
  return { campo: r.campo.trim(), operador: r.operador, valores };
}

function predicadoParaRascunho(p: PredicadoFiltro): RascunhoPredicado {
  return {
    campo: p.campo,
    operador: p.operador,
    valorTexto: p.operador === "IN" ? p.valores.join(", ") : p.valores[0] ?? "",
    valorTexto2: p.operador === "entre" ? p.valores[1] ?? "" : "",
  };
}

const modoTone: Record<string, string> = {
  marcar: "bg-destructive/15 text-destructive",
  simular: "bg-warning/15 text-warning",
  desligada: "bg-muted/15 text-muted",
};

const modoRotulo: Record<string, string> = {
  marcar: "marcando",
  simular: "simulando",
  desligada: "desligada",
};

interface ListaSyncErp {
  sincronizandoTodos: boolean;
  jobs: JobSync[];
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const numberFormatter = new Intl.NumberFormat("pt-BR");

const statusTone: Record<string, string> = {
  success: "bg-success/15 text-success",
  error: "bg-destructive/15 text-destructive",
};

// Quanto a varredura pode ficar atrás da sincronização antes de virar alerta. Uma tabela
// que só roda no modo "Alterados" nunca é varrida — o cron completo é diário, então mais
// de 3 dias de defasagem indica que só o incremental vem rodando.
const DIAS_VARREDURA_DEFASADA = 3;

function varreduraDefasada(job: JobSync): boolean {
  if (!job.temDeteccao || !job.ultimaSincronizacao) return false;
  if (!job.ultimaVarredura) return true; // tem detecção e nunca varreu
  const atraso = new Date(job.ultimaSincronizacao).getTime() - new Date(job.ultimaVarredura.em).getTime();
  return atraso > DIAS_VARREDURA_DEFASADA * 24 * 60 * 60 * 1000;
}

// "14,7s" abaixo de 1 min, "8m 40s" a partir daí — mesmo formato usado nas mensagens de
// SyncLog dos jobs já instrumentados (ex.: "308.244 linhas em 58s (fetch 44s, escrita
// 12s...)").
function formatarDuracao(ms: number): string {
  const segundos = ms / 1000;
  if (segundos < 60) return `${segundos.toFixed(1).replace(".", ",")}s`;
  const minutos = Math.floor(segundos / 60);
  const resto = Math.round(segundos % 60);
  return `${minutos}m ${resto}s`;
}

function formatTempoAtras(iso: string | null): string {
  if (!iso) return "nunca sincronizada";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora mesmo";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  const diffDias = Math.floor(diffH / 24);
  return `há ${diffDias} dia${diffDias === 1 ? "" : "s"}`;
}

export function SincronizacaoErp() {
  const [jobs, setJobs] = useState<JobSync[]>([]);
  const [sincronizandoTodos, setSincronizandoTodos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState<string | null>(null);
  const [iniciandoTodos, setIniciandoTodos] = useState(false);
  // Painel expansível da linha (Removidos + Campos, Fase 2 do plano de filtros na
  // importação) — mecanismo único: `expandido` é o jobName com o painel aberto, `abaExpandida`
  // decide qual conteúdo mostrar dentro dele. Nenhum dos dois entra no polling de 10s porque
  // é dado de conferência sob demanda, não de acompanhamento.
  const [expandido, setExpandido] = useState<string | null>(null);
  // Aba "Campos" removida (21/08/2026, pedido do Vitor): virou redundante depois que o
  // seletor de campo dos predicados (Filtro Todos/Alterados) passou a listar os mesmos campos
  // com busca — "Filtro(Todos)" é a aba padrão agora, único requisito é `job.suportaFiltro`
  // (true nos 35 jobs hoje).
  const [abaExpandida, setAbaExpandida] = useState<"removidos" | "filtroTodos" | "filtroAlterados">("filtroTodos");
  const [removidosPorJob, setRemovidosPorJob] = useState<Record<string, ItemRemovido[] | "carregando" | "erro">>({});
  // Chave composta `jobName:fonte` — permite guardar o resultado espelhado e o do ERP ao
  // mesmo tempo (trocar de fonte não descarta o que já foi buscado).
  const [camposPorJob, setCamposPorJob] = useState<Record<string, RespostaCampos | "carregando" | { erro: string }>>({});
  // Filtro por tabela (Fase 3/6) — chave composta `jobName:modo` ("todos"/"alterados"), os
  // dois independentes desde a Fase 6. `filtroPorJob` é o que está SALVO (vindo do GET),
  // `rascunhoPorJob` é o que o admin está editando na tela (só vira `predicados` de verdade
  // ao salvar/pré-visualizar). `previewPorJob` guarda o resultado do botão "ver query",
  // separado do salvamento.
  const [filtroPorJob, setFiltroPorJob] = useState<Record<string, RespostaFiltro | "carregando" | { erro: string }>>({});
  const [rascunhoPorJob, setRascunhoPorJob] = useState<Record<string, RascunhoPredicado[]>>({});
  const [previewPorJob, setPreviewPorJob] = useState<Record<string, RespostaPreview | "carregando" | { erro: string }>>({});
  // Também chaveado por `jobName:modo` — salvar Todos e Alterados ao mesmo tempo (em tese
  // improvável, mas as duas abas são independentes) não deve fazer um spinner cobrir o outro.
  const [salvandoFiltro, setSalvandoFiltro] = useState<string | null>(null);
  // Fase 5 (recorte retroativo) — pedido de confirmação vindo de um 409 ao salvar (ver
  // salvarFiltro). Um só de cada vez porque só uma linha fica expandida por vez (`expandido`);
  // `modo` distingue Todos de Alterados na mesma linha.
  const [confirmacaoRecorte, setConfirmacaoRecorte] = useState<{
    jobName: string;
    modo: "todos" | "alterados";
    linhasQueSaem: number;
    suportaMarcar: boolean;
    mensagem: string;
  } | null>(null);
  // Fase 6 — depois de salvar um filtro em "todos" com sucesso numa tabela que também tem
  // "Alterados", mostra um aviso DISPENSÁVEL perguntando se quer copiar pro Alterados (decisão
  // do Vitor 21/08/2026: nunca bloqueia o salvamento, só aparece depois). `avisoPropagar` guarda
  // qual job mostra o aviso; `confirmacaoPropagar` é o mesmo gate de recorte retroativo (409),
  // só que da cópia em si.
  const [avisoPropagar, setAvisoPropagar] = useState<{ jobName: string } | null>(null);
  const [propagando, setPropagando] = useState<string | null>(null);
  const [confirmacaoPropagar, setConfirmacaoPropagar] = useState<{
    jobName: string;
    linhasQueSaem: number;
    suportaMarcar: boolean;
    mensagem: string;
  } | null>(null);
  // Dimensões e propagação (Fase 4) — carregado uma vez (não entra no polling: a lista de
  // dimensões não muda em runtime, só o resultado da cascata muda quando o admin aplica algo).
  const [dimensoes, setDimensoes] = useState<DimensaoInfo[]>([]);
  const [modalDimensaoAberto, setModalDimensaoAberto] = useState(false);
  const [operadorDimensao, setOperadorDimensao] = useState<OperadorFiltro>("=");
  const [valorDimensao, setValorDimensao] = useState("");
  const [valorDimensao2, setValorDimensao2] = useState("");
  const [previewCascata, setPreviewCascata] = useState<ResultadoPropagacao[] | "carregando" | { erro: string } | null>(null);
  const [excluidosCascata, setExcluidosCascata] = useState<Set<string>>(new Set());
  const [aplicandoCascata, setAplicandoCascata] = useState(false);
  // Fase 5 (recorte retroativo) na cascata — mesmo 409 do filtro por tabela, mas agregado:
  // uma decisão só ("deixar"/"marcar") vale pra cascata inteira.
  const [confirmacaoRecorteCascata, setConfirmacaoRecorteCascata] = useState<{
    linhasQueSaem: number;
    suportaMarcar: boolean;
    mensagem: string;
  } | null>(null);
  // Filtro por texto — busca tanto pela descrição amigável ("Empresas") quanto pelo nome
  // técnico do job ("empresa-sync"), útil pra achar rápido numa lista que já passa de 30
  // tabelas. Só filtra a tabela; os cards de resumo continuam contando tudo.
  const [busca, setBusca] = useState("");

  function carregar() {
    axios
      .get<ListaSyncErp>("/api/sync-erp")
      .then(({ data }) => {
        setJobs(data.jobs);
        setSincronizandoTodos(data.sincronizandoTodos);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar tabelas sincronizadas"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
    // Atualiza sozinho a cada 10s pra refletir "em andamento" -> concluído sem precisar
    // que o usuário recarregue a página manualmente.
    const intervalo = setInterval(carregar, 10000);
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    axios
      .get<{ dimensoes: DimensaoInfo[] }>("/api/sync-erp/dimensoes")
      .then(({ data }) => setDimensoes(data.dimensoes))
      .catch(() => {}); // botão "Filtro por Empresa" só some se isso falhar — sem alarde extra
  }, []);

  const dimensaoCodemp = dimensoes.find((d) => d.chave === "codemp") ?? null;

  function abrirModalDimensao() {
    setModalDimensaoAberto(true);
    setPreviewCascata(null);
    setExcluidosCascata(new Set());
    setOperadorDimensao("=");
    setValorDimensao("");
    setValorDimensao2("");
    setConfirmacaoRecorteCascata(null);
  }

  function alternarExcluidoCascata(jobName: string) {
    setExcluidosCascata((atual) => {
      const novo = new Set(atual);
      if (novo.has(jobName)) novo.delete(jobName);
      else novo.add(jobName);
      return novo;
    });
  }

  function valoresDimensaoAtual(): string[] {
    if (operadorDimensao === "entre") return [valorDimensao.trim(), valorDimensao2.trim()];
    if (operadorDimensao === "IN") return valorDimensao.split(",").map((v) => v.trim()).filter(Boolean);
    return [valorDimensao.trim()];
  }

  function prevvisualizarCascata() {
    setPreviewCascata("carregando");
    axios
      .post<{ resultados: ResultadoPropagacao[] }>("/api/sync-erp/dimensoes/codemp/pre-visualizar", {
        operador: operadorDimensao,
        valores: valoresDimensaoAtual(),
      })
      .then(({ data }) => setPreviewCascata(data.resultados))
      .catch((err) => setPreviewCascata({ erro: err.response?.data?.error ?? "Falha ao pré-visualizar a cascata" }));
  }

  async function aplicarCascata(acaoRecorte?: "deixar" | "marcar") {
    setAplicandoCascata(true);
    setErro(null);
    setConfirmacaoRecorteCascata(null);
    try {
      const { data } = await axios.post<{ resultados: ResultadoPropagacao[] }>("/api/sync-erp/dimensoes/codemp/aplicar", {
        operador: operadorDimensao,
        valores: valoresDimensaoAtual(),
        jobsExcluidos: [...excluidosCascata],
        ...(acaoRecorte ? { acaoRecorte } : {}),
      });
      setPreviewCascata(data.resultados);
      carregar(); // atualiza `temFiltroTodos` de cada linha na lista principal (dimensão só escreve em "todos")
    } catch (err: any) {
      if (err.response?.status === 409 && err.response?.data?.precisaConfirmar) {
        setConfirmacaoRecorteCascata({
          linhasQueSaem: err.response.data.linhasQueSaem,
          suportaMarcar: err.response.data.suportaMarcar,
          mensagem: err.response.data.mensagem,
        });
        if (Array.isArray(err.response.data.resultados)) setPreviewCascata(err.response.data.resultados);
      } else {
        setErro(err.response?.data?.error ?? "Falha ao aplicar o filtro por dimensão");
      }
    } finally {
      setAplicandoCascata(false);
    }
  }

  async function removerCascata() {
    setAplicandoCascata(true);
    setErro(null);
    try {
      await axios.delete("/api/sync-erp/dimensoes/codemp");
      setPreviewCascata(null);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao remover o filtro por dimensão");
    } finally {
      setAplicandoCascata(false);
    }
  }

  async function disparar(job: JobSync, modo: "todos" | "alterados") {
    setDisparando(`${job.jobName}-${modo}`);
    setErro(null);
    try {
      await axios.post(`/api/sync-erp/${job.jobName}/run`, { modo });
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao iniciar sincronização");
    } finally {
      setDisparando(null);
    }
  }

  async function dispararTodos() {
    setIniciandoTodos(true);
    setErro(null);
    try {
      await axios.post("/api/sync-erp/run-all");
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao iniciar sincronização de todas as tabelas");
    } finally {
      setIniciandoTodos(false);
    }
  }

  // Abre/fecha o painel expansível da linha numa aba específica. Clicar de novo na mesma
  // aba já aberta fecha o painel (mesmo toggle que "Sumidos" já tinha); clicar numa aba
  // diferente com o painel já aberto só troca de conteúdo, sem fechar.
  function abrirPainel(job: JobSync, aba: "removidos" | "filtroTodos" | "filtroAlterados") {
    if (expandido === job.jobName && abaExpandida === aba) {
      setExpandido(null);
      return;
    }
    setExpandido(job.jobName);
    setAbaExpandida(aba);
    // Campos espelhados são baratos (sem SOAP, catalogoCampos.ts:camposEspelhados) — carrega
    // sempre, não só na aba de filtro, pro seletor de campo do predicado (Filtro Todos/
    // Alterados) já estar pronto assim que o admin chegar lá. Idempotente, não duplica round-trip.
    carregarCampos(job, "espelhado");
    if (aba === "removidos") carregarRemovidos(job);
    else if (aba === "filtroTodos") carregarFiltro(job, "todos");
    else if (aba === "filtroAlterados") carregarFiltro(job, "alterados");
  }

  function carregarRemovidos(job: JobSync) {
    if (removidosPorJob[job.jobName]) return;
    // Tabela sem detecção configurada (job.totalRemovidos===null) não tem nada pra buscar —
    // a rota devolveria 400 ("esta tabela ainda não tem detecção") e isso virava sempre
    // "Falha ao carregar", escondendo a mensagem amigável que já existe pra esse caso. Como a
    // linha inteira agora abre o painel (e por padrão vai pra "Filtro(Todos)", mas a aba
    // "Removidos" continua alcançável em qualquer tabela), essa checagem local evita o
    // round-trip inútil.
    if (job.totalRemovidos === null) return;
    setRemovidosPorJob((r) => ({ ...r, [job.jobName]: "carregando" }));
    axios
      .get<{ itens: ItemRemovido[] }>(`/api/sync-erp/${job.jobName}/removidos`)
      .then(({ data }) => setRemovidosPorJob((r) => ({ ...r, [job.jobName]: data.itens })))
      .catch(() => setRemovidosPorJob((r) => ({ ...r, [job.jobName]: "erro" })));
  }

  // `fonte: "erp"` é sob demanda (botão "ver todos os campos do ERP" dentro do painel) — 1
  // round-trip SOAP na primeira vez por tabela, cacheado 12h no backend nas chamadas
  // seguintes (soap/metadataCache.ts). `fonte: "espelhado"` é instantâneo, é o padrão ao abrir.
  function carregarCampos(job: JobSync, fonte: "espelhado" | "erp") {
    const chave = `${job.jobName}:${fonte}`;
    if (camposPorJob[chave]) return;
    setCamposPorJob((c) => ({ ...c, [chave]: "carregando" }));
    axios
      .get<RespostaCampos>(`/api/sync-erp/${job.jobName}/campos`, fonte === "erp" ? { params: { fonte: "erp" } } : undefined)
      .then(({ data }) => setCamposPorJob((c) => ({ ...c, [chave]: data })))
      .catch((err) =>
        setCamposPorJob((c) => ({ ...c, [chave]: { erro: err.response?.data?.error ?? "Falha ao carregar os campos" } }))
      );
  }

  // Filtro por tabela (Fase 3/6) — carrega o salvo NESSE MODO e inicializa o rascunho editável
  // a partir dele. Recarregar (ex.: reabrir a aba depois de salvar) não é feito automaticamente
  // — o próprio salvarFiltro já atualiza os dois estados com a resposta do PUT, sem round-trip extra.
  function carregarFiltro(job: JobSync, modo: "todos" | "alterados") {
    const chave = `${job.jobName}:${modo}`;
    if (filtroPorJob[chave]) return;
    setFiltroPorJob((f) => ({ ...f, [chave]: "carregando" }));
    axios
      .get<RespostaFiltro>(`/api/sync-erp/${job.jobName}/filtro/${modo}`)
      .then(({ data }) => {
        setFiltroPorJob((f) => ({ ...f, [chave]: data }));
        setRascunhoPorJob((r) => ({
          ...r,
          [chave]:
            data.predicados.length > 0
              ? data.predicados.map(predicadoParaRascunho)
              : // Nada salvo ainda em Alterados: semeia o rascunho com o corte de data que já
                // roda hoje por baixo dos panos (pedido do Vitor 21/08/2026) — só mostra, não
                // salva nada até o admin clicar "Salvar filtro".
                modo === "alterados" && job.campoData
              ? [{ campo: job.campoData, operador: "≥", valorTexto: VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO, valorTexto2: "" }]
              : [rascunhoVazio()],
        }));
      })
      .catch((err) =>
        setFiltroPorJob((f) => ({ ...f, [chave]: { erro: err.response?.data?.error ?? "Falha ao carregar o filtro" } }))
      );
  }

  function atualizarRascunho(job: JobSync, modo: "todos" | "alterados", indice: number, patch: Partial<RascunhoPredicado>) {
    const chave = `${job.jobName}:${modo}`;
    setRascunhoPorJob((r) => ({
      ...r,
      [chave]: (r[chave] ?? []).map((linha, i) => (i === indice ? { ...linha, ...patch } : linha)),
    }));
  }

  function adicionarLinhaRascunho(job: JobSync, modo: "todos" | "alterados") {
    const chave = `${job.jobName}:${modo}`;
    setRascunhoPorJob((r) => ({ ...r, [chave]: [...(r[chave] ?? []), rascunhoVazio()] }));
  }

  function removerLinhaRascunho(job: JobSync, modo: "todos" | "alterados", indice: number) {
    const chave = `${job.jobName}:${modo}`;
    setRascunhoPorJob((r) => {
      const linhas = (r[chave] ?? []).filter((_, i) => i !== indice);
      return { ...r, [chave]: linhas.length > 0 ? linhas : [rascunhoVazio()] };
    });
  }

  // Só entram predicados com campo preenchido — uma linha em branco deixada no meio do
  // formulário (ex.: o admin clicou "+ predicado" e não terminou de preencher) não vira
  // filtro inválido, simplesmente não é enviada.
  function predicadosPreenchidos(job: JobSync, modo: "todos" | "alterados"): PredicadoFiltro[] {
    return (rascunhoPorJob[`${job.jobName}:${modo}`] ?? [])
      .filter((r) => r.campo.trim() !== "")
      .map(rascunhoParaPredicado);
  }

  function visualizarQuery(job: JobSync, modo: "todos" | "alterados") {
    const chave = `${job.jobName}:${modo}`;
    setPreviewPorJob((p) => ({ ...p, [chave]: "carregando" }));
    axios
      .post<RespostaPreview>(`/api/sync-erp/${job.jobName}/preview`, { predicados: predicadosPreenchidos(job, modo) })
      .then(({ data }) => setPreviewPorJob((p) => ({ ...p, [chave]: data })))
      .catch((err) =>
        setPreviewPorJob((p) => ({ ...p, [chave]: { erro: err.response?.data?.error ?? "Falha ao montar a query" } }))
      );
  }

  // Fase 5 (recorte retroativo): salvar sem `acaoRecorte` pode voltar 409 se a tabela local já
  // tiver linha que sairia do recorte novo — nesse caso NÃO é erro, é pedido de confirmação
  // (guardado em `confirmacaoRecorte`, mostrado inline no painel). Reenviar com "deixar" ou
  // "marcar" conclui o salvamento; nunca "apagar" (contraria a regra do projeto de nunca
  // apagar fisicamente registro espelhado).
  //
  // Fase 6: salvar em "todos" numa tabela que também tem "Alterados" nunca trava esperando
  // decisão de propagação (decisão do Vitor 21/08/2026) — o backend já diz em
  // `alteradosDivergente` se vale a pena perguntar, e o aviso aparece DEPOIS, dispensável.
  async function salvarFiltro(job: JobSync, modo: "todos" | "alterados", acaoRecorte?: "deixar" | "marcar") {
    const chave = `${job.jobName}:${modo}`;
    setSalvandoFiltro(chave);
    setErro(null);
    setConfirmacaoRecorte(null);
    try {
      const { data } = await axios.put<RespostaFiltro>(`/api/sync-erp/${job.jobName}/filtro/${modo}`, {
        predicados: predicadosPreenchidos(job, modo),
        ...(acaoRecorte ? { acaoRecorte } : {}),
      });
      setFiltroPorJob((f) => ({ ...f, [chave]: data }));
      setRascunhoPorJob((r) => ({
        ...r,
        [chave]: data.predicados.length > 0 ? data.predicados.map(predicadoParaRascunho) : [rascunhoVazio()],
      }));
      setPreviewPorJob((p) => ({ ...p, [chave]: { query: "", escopavel: true, motivoNaoEscopavel: null } }));
      if (modo === "todos" && job.suportaAlterados) {
        setAvisoPropagar(data.alteradosDivergente ? { jobName: job.jobName } : null);
      }
      carregar(); // a lista principal também reflete o filtro (indicador "●" na linha)
    } catch (err: any) {
      if (err.response?.status === 409 && err.response?.data?.precisaConfirmar) {
        setConfirmacaoRecorte({
          jobName: job.jobName,
          modo,
          linhasQueSaem: err.response.data.linhasQueSaem,
          suportaMarcar: err.response.data.suportaMarcar,
          mensagem: err.response.data.mensagem,
        });
      } else {
        setErro(err.response?.data?.error ?? "Falha ao salvar o filtro");
      }
    } finally {
      setSalvandoFiltro(null);
    }
  }

  async function apagarFiltro(job: JobSync, modo: "todos" | "alterados") {
    const chave = `${job.jobName}:${modo}`;
    setSalvandoFiltro(chave);
    setErro(null);
    try {
      await axios.delete(`/api/sync-erp/${job.jobName}/filtro/${modo}`);
      setFiltroPorJob((f) => ({ ...f, [chave]: { predicados: [], predicadosSql: [], escopavel: true, motivoNaoEscopavel: null } }));
      setRascunhoPorJob((r) => ({ ...r, [chave]: [rascunhoVazio()] }));
      setPreviewPorJob((p) => {
        const { [chave]: _descartado, ...resto } = p;
        return resto;
      });
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao apagar o filtro");
    } finally {
      setSalvandoFiltro(null);
    }
  }

  // Fase 6 — cópia ÚNICA (não é vínculo permanente) dos predicados de "todos" pra dentro de
  // "alterados". Mesmo gate de recorte retroativo do salvar normal (409 -> confirmacaoPropagar).
  async function propagarParaAlterados(job: JobSync, acaoRecorte?: "deixar" | "marcar") {
    setPropagando(job.jobName);
    setErro(null);
    setConfirmacaoPropagar(null);
    try {
      const { data } = await axios.post<RespostaFiltro>(
        `/api/sync-erp/${job.jobName}/filtro/todos/propagar`,
        acaoRecorte ? { acaoRecorte } : {}
      );
      const chave = `${job.jobName}:alterados`;
      setFiltroPorJob((f) => ({ ...f, [chave]: data }));
      setRascunhoPorJob((r) => ({
        ...r,
        [chave]: data.predicados.length > 0 ? data.predicados.map(predicadoParaRascunho) : [rascunhoVazio()],
      }));
      setAvisoPropagar(null);
      carregar();
    } catch (err: any) {
      if (err.response?.status === 409 && err.response?.data?.precisaConfirmar) {
        setConfirmacaoPropagar({
          jobName: job.jobName,
          linhasQueSaem: err.response.data.linhasQueSaem,
          suportaMarcar: err.response.data.suportaMarcar,
          mensagem: err.response.data.mensagem,
        });
      } else {
        setErro(err.response?.data?.error ?? "Falha ao aplicar o filtro também no Alterados");
      }
    } finally {
      setPropagando(null);
    }
  }

  const totalTabelas = jobs.length;
  const comErro = jobs.filter((j) => j.ultimoStatus === "error").length;
  const totalRemovidos = jobs.reduce((soma, j) => soma + (j.totalRemovidos ?? 0), 0);
  const tabelasComDeteccao = jobs.filter((j) => j.totalRemovidos !== null).length;
  // Detectados que ainda não foram marcados, porque a varredura daquela tabela está só
  // simulando. É o número que interessa durante a fase de observação.
  const totalSimulados = jobs.reduce(
    (soma, j) => soma + (j.ultimaVarredura?.modo === "simular" ? j.ultimaVarredura.detectados : 0),
    0
  );
  const buscaNormalizada = busca.trim().toLowerCase();
  const jobsFiltrados = buscaNormalizada
    ? jobs.filter(
        (j) => j.displayName.toLowerCase().includes(buscaNormalizada) || j.jobName.toLowerCase().includes(buscaNormalizada)
      )
    : jobs;
  const rodandoAgora = jobs.filter((j) => j.emAndamento).length;
  const maisDesatualizada = jobs.reduce<JobSync | null>((pior, job) => {
    if (!pior) return job;
    const tempoJob = job.ultimaSincronizacao ? new Date(job.ultimaSincronizacao).getTime() : -Infinity;
    const tempoPior = pior.ultimaSincronizacao ? new Date(pior.ultimaSincronizacao).getTime() : -Infinity;
    return tempoJob < tempoPior ? job : pior;
  }, null);

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Importados do Senior
      </p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Importados do Senior</h1>
          <p className="mt-1 text-sm text-muted">
            Cada tabela roda sozinha no horário agendado. "Alterados" filtra pela data de geração/alteração do registro
            desde a última sincronização com sucesso — só aparece pra tabelas que têm esse campo no Senior.
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {dimensaoCodemp && (
            <button
              onClick={abrirModalDimensao}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-2"
              title="Aplica um filtro de Empresa em todas as tabelas que têm essa coluna de uma vez (Fase 4 do plano de filtros)"
            >
              Filtro por Empresa
            </button>
          )}
          <button
            onClick={dispararTodos}
            disabled={sincronizandoTodos || iniciandoTodos || jobs.some((j) => j.emAndamento)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sincronizandoTodos || iniciandoTodos ? "Sincronizando todas..." : "Sincronizar Todas as Tabelas"}
          </button>
        </div>
      </div>

      {dimensaoCodemp && (
        <ModalDimensao
          dimensao={dimensaoCodemp}
          aberto={modalDimensaoAberto}
          onFechar={() => setModalDimensaoAberto(false)}
          operador={operadorDimensao}
          setOperador={setOperadorDimensao}
          valor={valorDimensao}
          setValor={setValorDimensao}
          valor2={valorDimensao2}
          setValor2={setValorDimensao2}
          preview={previewCascata}
          excluidos={excluidosCascata}
          alternarExcluido={alternarExcluidoCascata}
          prevvisualizar={prevvisualizarCascata}
          aplicar={aplicarCascata}
          removerCascata={removerCascata}
          aplicando={aplicandoCascata}
          confirmacaoRecorte={confirmacaoRecorteCascata}
          cancelarConfirmacaoRecorte={() => setConfirmacaoRecorteCascata(null)}
        />
      )}

      {loading && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-28" />
              <Skeleton className="h-7 w-14" />
            </div>
          ))}
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">Total de tabelas</p>
            <span className="block font-mono text-2xl font-semibold tabular-nums text-foreground">{totalTabelas}</span>
          </div>
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">Com erro</p>
            <span
              className={`block font-mono text-2xl font-semibold tabular-nums ${comErro > 0 ? "text-destructive" : "text-foreground"}`}
            >
              {comErro}
            </span>
          </div>
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">Sincronizando agora</p>
            <span
              className={`block font-mono text-2xl font-semibold tabular-nums ${rodandoAgora > 0 ? "text-warning" : "text-foreground"}`}
            >
              {rodandoAgora}
            </span>
          </div>
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">Sumidos no Senior</p>
            <span
              className={`block font-mono text-2xl font-semibold tabular-nums ${
                totalRemovidos > 0 || totalSimulados > 0 ? "text-warning" : "text-foreground"
              }`}
            >
              {numberFormatter.format(totalRemovidos)}
              {totalSimulados > 0 && (
                <span className="ml-1.5 font-sans text-sm font-medium text-muted">
                  +{numberFormatter.format(totalSimulados)} simulado{totalSimulados === 1 ? "" : "s"}
                </span>
              )}
            </span>
            <p className="mt-1 text-[11px] text-muted">
              {tabelasComDeteccao === 0
                ? "detecção ainda não ligada"
                : `em ${tabelasComDeteccao} tabela${tabelasComDeteccao === 1 ? "" : "s"} com detecção`}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">Mais desatualizada</p>
            <span className="block truncate font-mono text-lg font-semibold tabular-nums text-foreground" title={maisDesatualizada?.displayName}>
              {maisDesatualizada?.displayName ?? "—"}
            </span>
            <p className="mt-1 text-[11px] text-muted">
              {maisDesatualizada ? formatTempoAtras(maisDesatualizada.ultimaSincronizacao) : "—"}
            </p>
          </div>
        </div>
      )}

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <div className="mb-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por descrição ou nome da tabela..."
          className="w-80 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Ordem
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Tabela
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Registros
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Sumidos
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Última sincronização
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Duração
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Próxima execução
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-6" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-16" />
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-10" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-12" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-5 w-12 rounded" />
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-32" />
                    </td>
                  </tr>
                ))}
              {!loading &&
                jobsFiltrados.map((job) => (
                <Fragment key={job.jobName}>
                <tr
                  onClick={() => abrirPainel(job, "filtroTodos")}
                  // Mesmo destaque em borda que "por Cliente" (mercado/pedidos, ListarPedidos.tsx)
                  // já usa pro grupo expandido — pedido do Vitor (21/08/2026) pra trazer o mesmo
                  // tratamento aqui. Continua junto com a célula da esquerda/direita e a linha do
                  // painel abaixo, formando uma caixa em volta da linha aberta.
                  className={`cursor-pointer transition ${
                    expandido === job.jobName ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                  }`}
                  title="Clique pra ver o filtro (com a lista de campos) e os registros removidos desta tabela"
                >
                  <td
                    className={`px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-muted ${
                      expandido === job.jobName ? "border-l border-primary" : ""
                    }`}
                  >
                    {job.ordemExecucao}
                  </td>
                  <td className="px-2.5 py-3.5 text-sm font-semibold text-foreground">
                    <span className="flex items-center gap-2">
                      {job.displayName}
                      {job.suportaFiltro && (job.temFiltroTodos || job.temFiltroAlterados) && (
                        <span
                          className="text-primary"
                          title={`Filtro ativo em: ${[
                            job.temFiltroTodos ? "Todos" : null,
                            job.temFiltroAlterados ? "Alterados" : null,
                          ]
                            .filter(Boolean)
                            .join(" e ")} — abra a linha pra ver o conteúdo`}
                        >
                          ●
                        </span>
                      )}
                      {job.ultimaVarredura && (
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-wide ${
                            modoTone[job.ultimaVarredura.modo] ?? modoTone.desligada
                          }`}
                          title={`${
                            job.ultimaVarredura.modo === "marcar"
                              ? "Registros que sumirem do Senior são marcados como removidos"
                              : "Varredura só conta os que sumiram, sem marcar nada"
                          } — última varredura em ${dateTimeFormatter.format(new Date(job.ultimaVarredura.em))}`}
                        >
                          {modoRotulo[job.ultimaVarredura.modo] ?? job.ultimaVarredura.modo}
                        </span>
                      )}
                      {varreduraDefasada(job) && (
                        <span
                          className="inline-block rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-wide text-warning"
                          title={
                            job.ultimaVarredura
                              ? `Sincronizada em ${dateTimeFormatter.format(new Date(job.ultimaSincronizacao as string))}, mas varrida pela última vez em ${dateTimeFormatter.format(new Date(job.ultimaVarredura.em))}. O modo "Alterados" não varre — rode "Sincronizar Todos" pra detectar exclusões.`
                              : 'Esta tabela tem detecção configurada mas nunca foi varrida. O modo "Alterados" não varre — rode "Sincronizar Todos".'
                          }
                        >
                          varredura atrasada
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                    {numberFormatter.format(job.totalRegistros)}
                  </td>
                  <td className="px-2.5 py-3.5 text-right">
                    {(() => {
                      // Detectados pela última varredura mas ainda não gravados — só
                      // acontece em modo "simular". É o número que a fase de observação
                      // precisa ver; sem ele a coluna fica zerada justamente quando importa.
                      const simulados =
                        job.ultimaVarredura?.modo === "simular" ? job.ultimaVarredura.detectados : 0;

                      // Tabela ainda sem detecção — "—" em vez de 0, que daria a impressão
                      // errada de "conferido, nada sumiu".
                      if (job.totalRemovidos === null) {
                        return (
                          <span className="font-mono text-sm text-muted" title="Detecção de exclusão ainda não ligada nesta tabela">
                            —
                          </span>
                        );
                      }
                      if (job.totalRemovidos === 0 && simulados === 0) {
                        return <span className="font-mono text-sm tabular-nums text-muted">0</span>;
                      }
                      return (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirPainel(job, "removidos");
                          }}
                          className="font-mono text-sm font-semibold tabular-nums text-warning hover:underline"
                          title="Ver quais registros sumiram do Senior"
                        >
                          {numberFormatter.format(job.totalRemovidos)}
                          {simulados > 0 && (
                            <span className="ml-1 font-sans text-[11px] font-medium text-muted">
                              (+{numberFormatter.format(simulados)} simulado{simulados === 1 ? "" : "s"})
                            </span>
                          )}
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-2.5 py-3.5 text-[12.5px] text-muted">
                    {job.ultimaSincronizacao ? dateTimeFormatter.format(new Date(job.ultimaSincronizacao)) : "Nunca"}
                    {job.ultimaMensagem && (
                      <p
                        className={`mt-0.5 max-w-[240px] truncate text-[11px] ${
                          job.ultimoStatus === "error" ? "text-destructive" : "text-muted"
                        }`}
                        title={job.ultimaMensagem}
                      >
                        {job.ultimaMensagem}
                      </p>
                    )}
                  </td>
                  <td className="px-2.5 py-3.5 text-right font-mono text-[12.5px] tabular-nums text-muted">
                    {job.ultimaDuracaoMs != null ? formatarDuracao(job.ultimaDuracaoMs) : "—"}
                  </td>
                  <td className="px-2.5 py-3.5 text-[12.5px] text-muted">
                    {dateTimeFormatter.format(new Date(job.proximaExecucao))}
                  </td>
                  <td className="px-2.5 py-3.5 text-right">
                    {job.emAndamento ? (
                      <span className="inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide bg-warning/15 text-warning">
                        rodando...
                      </span>
                    ) : job.ultimoStatus ? (
                      <span
                        className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                          statusTone[job.ultimoStatus] ?? statusTone.success
                        }`}
                      >
                        {job.ultimoStatus === "success" ? "ok" : "erro"}
                      </span>
                    ) : (
                      <span className="inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide bg-muted/15 text-muted">
                        —
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-2.5 py-3.5 text-right ${expandido === job.jobName ? "border-r border-primary" : ""}`}
                  >
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          disparar(job, "todos");
                        }}
                        disabled={job.emAndamento || disparando !== null || sincronizandoTodos}
                        className="text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {disparando === `${job.jobName}-todos` ? "Iniciando..." : "Sincronizar Todos"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          disparar(job, "alterados");
                        }}
                        disabled={!job.suportaAlterados || job.emAndamento || disparando !== null || sincronizandoTodos}
                        title={!job.suportaAlterados ? "Essa tabela não tem campo de data de geração/alteração no Senior" : undefined}
                        className="text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {disparando === `${job.jobName}-alterados` ? "Iniciando..." : "Sincronizar Alterados"}
                      </button>
                    </div>
                  </td>
                </tr>
                {expandido === job.jobName && (
                  <tr className="border-t border-border/60 bg-surface-2/40">
                    <td colSpan={9} className="border-b border-l border-r border-primary px-2.5 py-3">
                      <div className="mb-3 flex items-center gap-4 border-b border-border/60">
                        <button
                          onClick={() => abrirPainel(job, "removidos")}
                          className={`-mb-px border-b-2 pb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                            abaExpandida === "removidos"
                              ? "border-primary text-primary"
                              : "border-transparent text-muted hover:text-foreground"
                          }`}
                        >
                          Removidos
                        </button>
                        {job.suportaFiltro && (
                          <button
                            onClick={() => abrirPainel(job, "filtroTodos")}
                            className={`-mb-px border-b-2 pb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                              abaExpandida === "filtroTodos"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted hover:text-foreground"
                            }`}
                          >
                            Filtro(Todos)
                          </button>
                        )}
                        {job.suportaFiltro && job.suportaAlterados && (
                          <button
                            onClick={() => abrirPainel(job, "filtroAlterados")}
                            className={`-mb-px border-b-2 pb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                              abaExpandida === "filtroAlterados"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted hover:text-foreground"
                            }`}
                          >
                            Filtro(Alterados)
                          </button>
                        )}
                      </div>

                      {abaExpandida === "filtroTodos" && job.suportaFiltro && (
                        <PainelFiltro
                          job={job}
                          modo="todos"
                          filtroPorJob={filtroPorJob}
                          rascunhoPorJob={rascunhoPorJob}
                          previewPorJob={previewPorJob}
                          salvandoFiltro={salvandoFiltro}
                          camposPorJob={camposPorJob}
                          carregarCampos={carregarCampos}
                          atualizarRascunho={atualizarRascunho}
                          adicionarLinhaRascunho={adicionarLinhaRascunho}
                          removerLinhaRascunho={removerLinhaRascunho}
                          visualizarQuery={visualizarQuery}
                          salvarFiltro={salvarFiltro}
                          apagarFiltro={apagarFiltro}
                          confirmacaoRecorte={confirmacaoRecorte}
                          cancelarConfirmacaoRecorte={() => setConfirmacaoRecorte(null)}
                          avisoPropagar={avisoPropagar}
                          dispensarAvisoPropagar={() => setAvisoPropagar(null)}
                          propagando={propagando}
                          propagarParaAlterados={propagarParaAlterados}
                          confirmacaoPropagar={confirmacaoPropagar}
                          cancelarConfirmacaoPropagar={() => setConfirmacaoPropagar(null)}
                        />
                      )}

                      {abaExpandida === "filtroAlterados" && job.suportaFiltro && job.suportaAlterados && (
                        <PainelFiltro
                          job={job}
                          modo="alterados"
                          filtroPorJob={filtroPorJob}
                          rascunhoPorJob={rascunhoPorJob}
                          previewPorJob={previewPorJob}
                          salvandoFiltro={salvandoFiltro}
                          camposPorJob={camposPorJob}
                          carregarCampos={carregarCampos}
                          atualizarRascunho={atualizarRascunho}
                          adicionarLinhaRascunho={adicionarLinhaRascunho}
                          removerLinhaRascunho={removerLinhaRascunho}
                          visualizarQuery={visualizarQuery}
                          salvarFiltro={salvarFiltro}
                          apagarFiltro={apagarFiltro}
                          confirmacaoRecorte={confirmacaoRecorte}
                          cancelarConfirmacaoRecorte={() => setConfirmacaoRecorte(null)}
                          avisoPropagar={null}
                          dispensarAvisoPropagar={() => {}}
                          propagando={propagando}
                          propagarParaAlterados={propagarParaAlterados}
                          confirmacaoPropagar={null}
                          cancelarConfirmacaoPropagar={() => {}}
                        />
                      )}

                      {abaExpandida === "removidos" && (
                        <>
                          <p className="mb-2 text-[11.5px] text-muted">
                            Registros que não vieram mais na consulta ao Senior. Confira alguns direto no ERP: se eles
                            realmente não existem mais lá, a detecção está correta.
                          </p>
                          {removidosPorJob[job.jobName] === "carregando" && (
                            <p className="py-2 text-sm text-muted">Carregando...</p>
                          )}
                          {removidosPorJob[job.jobName] === "erro" && (
                            <p className="py-2 text-sm text-destructive">Falha ao carregar os registros removidos.</p>
                          )}
                          {job.totalRemovidos === null && !removidosPorJob[job.jobName] && (
                            <p className="py-2 text-sm text-muted">Detecção de exclusão ainda não ligada nesta tabela.</p>
                          )}
                          {Array.isArray(removidosPorJob[job.jobName]) && (
                            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                              {(removidosPorJob[job.jobName] as ItemRemovido[]).map((item) => (
                                <li key={item.chave} className="flex items-baseline gap-2 text-[12.5px]">
                                  <span className="font-mono font-semibold text-foreground">{item.chave}</span>
                                  <span className="truncate text-muted" title={item.rotulo}>
                                    {item.rotulo}
                                  </span>
                                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                                    {item.marcado && item.removidoEmSenior
                                      ? dateTimeFormatter.format(new Date(item.removidoEmSenior))
                                      : "candidato"}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {!loading && jobs.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2.5 py-8 text-center text-sm text-muted">
                    Nenhuma tabela cadastrada.
                  </td>
                </tr>
              )}
              {!loading && jobs.length > 0 && jobsFiltrados.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2.5 py-8 text-center text-sm text-muted">
                    Nenhuma tabela encontrada para "{busca.trim()}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Editor do filtro de uma tabela (Fase 3/6 do plano de filtros na importação) — um por MODO
// ("todos"/"alterados"), independentes desde a Fase 6. O "campo" de cada predicado é sempre o
// nome de ORIGEM no Senior — o seletor buscável (SelectBuscavel) já mostra isso, a aba "Campos"
// separada foi removida (21/08/2026, pedido do Vitor: virou redundante). A validação de
// verdade (campo existe, tipo bate, valor é válido) é toda do backend — este formulário só
// monta o rascunho e mostra o erro que vier.
function PainelFiltro({
  job,
  modo,
  filtroPorJob,
  rascunhoPorJob,
  previewPorJob,
  salvandoFiltro,
  camposPorJob,
  carregarCampos,
  atualizarRascunho,
  adicionarLinhaRascunho,
  removerLinhaRascunho,
  visualizarQuery,
  salvarFiltro,
  apagarFiltro,
  confirmacaoRecorte,
  cancelarConfirmacaoRecorte,
  avisoPropagar,
  dispensarAvisoPropagar,
  propagando,
  propagarParaAlterados,
  confirmacaoPropagar,
  cancelarConfirmacaoPropagar,
}: {
  job: JobSync;
  modo: "todos" | "alterados";
  filtroPorJob: Record<string, RespostaFiltro | "carregando" | { erro: string }>;
  rascunhoPorJob: Record<string, RascunhoPredicado[]>;
  previewPorJob: Record<string, RespostaPreview | "carregando" | { erro: string }>;
  salvandoFiltro: string | null;
  camposPorJob: Record<string, RespostaCampos | "carregando" | { erro: string }>;
  carregarCampos: (job: JobSync, fonte: "espelhado" | "erp") => void;
  atualizarRascunho: (job: JobSync, modo: "todos" | "alterados", indice: number, patch: Partial<RascunhoPredicado>) => void;
  adicionarLinhaRascunho: (job: JobSync, modo: "todos" | "alterados") => void;
  removerLinhaRascunho: (job: JobSync, modo: "todos" | "alterados", indice: number) => void;
  visualizarQuery: (job: JobSync, modo: "todos" | "alterados") => void;
  salvarFiltro: (job: JobSync, modo: "todos" | "alterados", acaoRecorte?: "deixar" | "marcar") => void;
  apagarFiltro: (job: JobSync, modo: "todos" | "alterados") => void;
  confirmacaoRecorte: { jobName: string; modo: "todos" | "alterados"; linhasQueSaem: number; suportaMarcar: boolean; mensagem: string } | null;
  cancelarConfirmacaoRecorte: () => void;
  avisoPropagar: { jobName: string } | null;
  dispensarAvisoPropagar: () => void;
  propagando: string | null;
  propagarParaAlterados: (job: JobSync, acaoRecorte?: "deixar" | "marcar") => void;
  confirmacaoPropagar: { jobName: string; linhasQueSaem: number; suportaMarcar: boolean; mensagem: string } | null;
  cancelarConfirmacaoPropagar: () => void;
}) {
  const chave = `${job.jobName}:${modo}`;
  const estado = filtroPorJob[chave];
  const rascunho = rascunhoPorJob[chave] ?? [];
  const preview = previewPorJob[chave];
  const salvando = salvandoFiltro === chave;
  const confirmacao = confirmacaoRecorte?.jobName === job.jobName && confirmacaoRecorte.modo === modo ? confirmacaoRecorte : null;
  const mostrarAvisoPropagar = modo === "todos" && avisoPropagar?.jobName === job.jobName;
  const propagacaoPendente = modo === "todos" && confirmacaoPropagar?.jobName === job.jobName ? confirmacaoPropagar : null;
  const propagandoEsta = propagando === job.jobName;
  // Seletor de campo do predicado — compartilhado entre TODAS as linhas do painel (não por
  // linha): clicar "ver todos os campos do ERP" numa linha expande a lista pras outras
  // também, é a mesma tabela. Hook antes de qualquer `return` condicional abaixo.
  const [verTodosOsCampos, setVerTodosOsCampos] = useState(false);
  const respostaCampos = camposPorJob[`${job.jobName}:${verTodosOsCampos ? "erp" : "espelhado"}`];
  const opcoesCampo = respostaCampos && typeof respostaCampos === "object" && "campos" in respostaCampos ? respostaCampos.campos : [];

  if (!estado || estado === "carregando") {
    return <p className="py-2 text-sm text-muted">Carregando...</p>;
  }
  if (typeof estado === "object" && "erro" in estado) {
    return <p className="py-2 text-sm text-destructive">{estado.erro}</p>;
  }

  return (
    <div>
      <p className="mb-3 text-[11.5px] text-muted">
        {modo === "todos"
          ? 'Filtra o que esta tabela importa do Senior quando roda "Sincronizar Todos" — vale também pro agendamento automático (o cron sempre roda sem "desde").'
          : 'Filtra o que esta tabela importa do Senior quando roda "Sincronizar Alterados" — independente do Filtro(Todos); use "aplicar também no Alterados" pra copiar um pro outro.'}{" "}
        O espelho fica permanentemente parcial enquanto o filtro estiver ativo. Busque o campo pelo nome ou pela
        descrição — o valor salvo é sempre o nome de ORIGEM no Senior.
      </p>
      {/* Só faz sentido em Todos — o modo Alterados nunca varre (regra já existente), então
          "detecção desligada" seria um aviso confuso ali (ex.: sempre dispararia por causa da
          variável "última sincronização", que nunca é escopável por natureza). */}
      {modo === "todos" && !estado.escopavel && estado.motivoNaoEscopavel && (
        <p className="mb-3 rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11.5px] text-warning">
          Atenção: {estado.motivoNaoEscopavel} — a detecção de registros removidos fica desligada enquanto esse
          filtro estiver ativo (sem isso, a tabela inteira fora do recorte seria marcada como removida por engano).
        </p>
      )}

      <div className="space-y-2">
        {rascunho.map((linha, indice) => {
          // Pedido do Vitor (21/08/2026): a variável só é oferecida na linha do campo de data
          // do modo Alterados (job.campoData, ex. "DatAtu") — não um convite genérico a usar
          // em qualquer campo de data, o backend valida de qualquer forma (defesa em camadas).
          const ehCampoData = modo === "alterados" && job.campoData != null && linha.campo.trim().toLowerCase() === job.campoData.toLowerCase();
          const podeUsarVariavel = ehCampoData && OPERADORES_QUE_ACEITAM_VARIAVEL.includes(linha.operador);
          const usandoVariavel = podeUsarVariavel && linha.valorTexto === VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO;

          // Lista buscável (por nome do campo OU descrição — pedido do Vitor 21/08/2026) em
          // vez de <select> nativo: reaproveita o mesmo componente já usado em Apontamentos/
          // Home/Jornadas (components/ui/SelectBuscavel.tsx) pra busca+agrupamento. "Selecionado"
          // preserva um campo já digitado/salvo que ainda não está na lista carregada (salvo
          // antes desta mudança, ou só existe no ERP e "ver todos" ainda não foi clicado) —
          // nunca esconde o valor que já está no predicado. "Ações" é a entrada especial que
          // carrega o catálogo do ERP em vez de virar valor de campo.
          const opcoesSelectCampo: OpcaoBuscavel<string>[] = [];
          if (linha.campo && !opcoesCampo.some((c) => c.origem.toLowerCase() === linha.campo.toLowerCase())) {
            opcoesSelectCampo.push({ value: linha.campo, grupo: "Selecionado", rotulo: linha.campo });
          }
          for (const c of opcoesCampo) {
            opcoesSelectCampo.push({
              value: c.origem,
              grupo: verTodosOsCampos ? (c.espelhado ? "Já espelhados" : "Só no ERP (não espelhado)") : "Já espelhados",
              rotulo: c.descricao ? `${c.origem} — ${c.descricao}` : c.origem,
            });
          }
          if (!verTodosOsCampos) {
            opcoesSelectCampo.push({ value: OPCAO_VER_TODOS_CAMPOS, grupo: "Ações", rotulo: "▸ ver todos os campos do ERP" });
          }

          return (
          <div key={indice} className="flex flex-wrap items-center gap-2">
            <SelectBuscavel
              opcoes={opcoesSelectCampo}
              valor={linha.campo || null}
              onChange={(valor) => {
                if (valor === OPCAO_VER_TODOS_CAMPOS) {
                  carregarCampos(job, "erp");
                  setVerTodosOsCampos(true);
                  return; // não vira valor de campo — só expande a lista
                }
                atualizarRascunho(job, modo, indice, { campo: valor });
              }}
              placeholder={respostaCampos === "carregando" ? "Carregando campos..." : "Selecione um campo..."}
              textoVazio="Nenhum campo carregado ainda."
              placeholderBusca="Buscar por campo ou descrição..."
              className="w-64"
            />
            <select
              value={linha.operador}
              onChange={(e) => atualizarRascunho(job, modo, indice, { operador: e.target.value as OperadorFiltro })}
              className="rounded-md border border-border bg-surface px-2 py-1 text-[12.5px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {OPERADORES.map((op) => (
                <option key={op.valor} value={op.valor}>
                  {op.rotulo}
                </option>
              ))}
            </select>
            {usandoVariavel ? (
              <span className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[12.5px] text-primary">
                🔁 variável: última sincronização com sucesso
                <button
                  type="button"
                  onClick={() => atualizarRascunho(job, modo, indice, { valorTexto: "" })}
                  className="text-muted hover:underline"
                >
                  usar valor fixo
                </button>
              </span>
            ) : (
              <>
                <input
                  value={linha.valorTexto}
                  onChange={(e) => atualizarRascunho(job, modo, indice, { valorTexto: e.target.value })}
                  placeholder={linha.operador === "IN" ? "valor1, valor2, ..." : linha.operador === "entre" ? "de" : "valor"}
                  className="w-44 rounded-md border border-border bg-surface px-2 py-1 text-[12.5px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {podeUsarVariavel && (
                  <button
                    type="button"
                    onClick={() => atualizarRascunho(job, modo, indice, { valorTexto: VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO })}
                    className="text-[12.5px] text-primary hover:underline"
                    title='Usa a data da última sincronização com sucesso em vez de um valor fixo — é o que já acontece hoje por baixo dos panos'
                  >
                    usar variável
                  </button>
                )}
              </>
            )}
            {linha.operador === "entre" && (
              <input
                value={linha.valorTexto2}
                onChange={(e) => atualizarRascunho(job, modo, indice, { valorTexto2: e.target.value })}
                placeholder="até"
                className="w-32 rounded-md border border-border bg-surface px-2 py-1 text-[12.5px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
            <button
              onClick={() => removerLinhaRascunho(job, modo, indice)}
              className="text-[12.5px] text-destructive hover:underline"
              title="Remover este predicado"
            >
              remover
            </button>
          </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={() => adicionarLinhaRascunho(job, modo)} className="text-[12.5px] text-primary hover:underline">
          + predicado
        </button>
        <button onClick={() => visualizarQuery(job, modo)} className="text-[12.5px] text-primary hover:underline">
          ver query
        </button>
        <button
          onClick={() => salvarFiltro(job, modo)}
          disabled={salvando}
          className="rounded-md bg-primary px-3 py-1 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {salvando ? "Salvando..." : "Salvar filtro"}
        </button>
        {estado.predicados.length > 0 && (
          <button
            onClick={() => apagarFiltro(job, modo)}
            disabled={salvando}
            className="text-[12.5px] text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            apagar filtro
          </button>
        )}
      </div>

      {/* Fase 6 — aviso DISPENSÁVEL depois de salvar "todos" com sucesso: nunca bloqueia o
          salvamento, só sugere copiar pro Alterados (decisão do Vitor 21/08/2026). Some
          sozinho se a própria cópia (ou uma edição direta do Alterados) resolver a divergência. */}
      {mostrarAvisoPropagar && !propagacaoPendente && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded border border-primary/30 bg-primary/10 px-3 py-2">
          <p className="text-[12.5px] text-foreground">Aplicar esse filtro também no Filtro(Alterados) desta tabela?</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => propagarParaAlterados(job)}
              disabled={propagandoEsta}
              className="rounded-md bg-primary px-3 py-1 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {propagandoEsta ? "Aplicando..." : "Aplicar no Alterados"}
            </button>
            <button onClick={dispensarAvisoPropagar} className="text-[12.5px] text-muted hover:underline">
              agora não
            </button>
          </div>
        </div>
      )}

      {/* Fase 5/6 (recorte retroativo) — a cópia pro Alterados devolveu 409: mesma decisão
          explícita do salvar normal, só que da cópia em si. */}
      {propagacaoPendente && (
        <div className="mt-3 rounded border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="text-[12.5px] text-warning">{propagacaoPendente.mensagem}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => propagarParaAlterados(job, "deixar")}
              disabled={propagandoEsta}
              className="rounded-md border border-border px-3 py-1 text-[12.5px] font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Deixar como está
            </button>
            {propagacaoPendente.suportaMarcar && (
              <button
                onClick={() => propagarParaAlterados(job, "marcar")}
                disabled={propagandoEsta}
                className="rounded-md bg-warning px-3 py-1 text-[12.5px] font-semibold text-warning-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Marcar como removidas
              </button>
            )}
            <button onClick={cancelarConfirmacaoPropagar} className="text-[12.5px] text-muted hover:underline">
              cancelar
            </button>
          </div>
        </div>
      )}

      {/* Fase 5 (recorte retroativo) — o PUT devolveu 409: salvar este filtro deixaria linha
          local órfã (fora do recorte pra sempre). Pede uma decisão explícita em vez de salvar
          sozinho; nunca oferece "apagar" (contraria a regra de nunca apagar registro espelhado). */}
      {confirmacao && (
        <div className="mt-3 rounded border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="text-[12.5px] text-warning">{confirmacao.mensagem}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => salvarFiltro(job, modo, "deixar")}
              disabled={salvando}
              className="rounded-md border border-border px-3 py-1 text-[12.5px] font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
              title="Salva o filtro e deixa as linhas locais como estão — ficam invisíveis pra sincronização, mas continuam no banco"
            >
              Deixar como está
            </button>
            {confirmacao.suportaMarcar && (
              <button
                onClick={() => salvarFiltro(job, modo, "marcar")}
                disabled={salvando}
                className="rounded-md bg-warning px-3 py-1 text-[12.5px] font-semibold text-warning-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                title="Salva o filtro e marca as linhas que saem do recorte como removidas (nunca apaga, sempre reversível)"
              >
                Marcar como removidas
              </button>
            )}
            <button onClick={cancelarConfirmacaoRecorte} className="text-[12.5px] text-muted hover:underline">
              cancelar
            </button>
          </div>
        </div>
      )}

      {preview === "carregando" && <p className="mt-2 py-1 text-sm text-muted">Montando a query...</p>}
      {preview && typeof preview === "object" && "erro" in preview && (
        <p className="mt-2 py-1 text-sm text-destructive">{preview.erro}</p>
      )}
      {preview && typeof preview === "object" && "query" in preview && preview.query && (
        <div className="mt-2 rounded border border-border/60 bg-surface-2/50 p-2">
          <p className="mb-1 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted">
            Query que será enviada ao Senior
          </p>
          <code className="block whitespace-pre-wrap break-all font-mono text-[11.5px] text-foreground">{preview.query}</code>
          {!preview.escopavel && preview.motivoNaoEscopavel && (
            <p className="mt-1 text-[11px] text-warning">Sem detecção de removidos: {preview.motivoNaoEscopavel}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Filtro por dimensão (Fase 4 do plano de filtros na importação) — aplica o MESMO valor
// (ex.: codemp = 1) em todas as tabelas que compartilham a dimensão de uma vez, com preview
// da cascata resultante antes de gravar e override por tabela (checkbox pra excluir da
// aplicação). Hoje só a dimensão "codemp"/Empresa existe — por isso os endpoints são
// hardcoded pra ela; se uma segunda dimensão aparecer, isto vira um seletor.
function ModalDimensao({
  dimensao,
  aberto,
  onFechar,
  operador,
  setOperador,
  valor,
  setValor,
  valor2,
  setValor2,
  preview,
  excluidos,
  alternarExcluido,
  prevvisualizar,
  aplicar,
  removerCascata,
  aplicando,
  confirmacaoRecorte,
  cancelarConfirmacaoRecorte,
}: {
  dimensao: DimensaoInfo;
  aberto: boolean;
  onFechar: () => void;
  operador: OperadorFiltro;
  setOperador: (op: OperadorFiltro) => void;
  valor: string;
  setValor: (v: string) => void;
  valor2: string;
  setValor2: (v: string) => void;
  preview: ResultadoPropagacao[] | "carregando" | { erro: string } | null;
  excluidos: Set<string>;
  alternarExcluido: (jobName: string) => void;
  prevvisualizar: () => void;
  aplicar: (acaoRecorte?: "deixar" | "marcar") => void;
  removerCascata: () => void;
  aplicando: boolean;
  confirmacaoRecorte: { linhasQueSaem: number; suportaMarcar: boolean; mensagem: string } | null;
  cancelarConfirmacaoRecorte: () => void;
}) {
  const filtraveis = dimensao.alcancados.filter((a) => a.filtravel);
  const naoFiltraveis = dimensao.alcancados.filter((a) => !a.filtravel);
  const resultados = Array.isArray(preview) ? preview : null;
  const okCount = resultados?.filter((r) => r.ok && !excluidos.has(r.jobName)).length ?? 0;
  const totalOrfaos = resultados?.reduce((soma, r) => soma + (r.ok && !excluidos.has(r.jobName) ? r.linhasQueSaem ?? 0 : 0), 0) ?? 0;

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      title={`Filtro por ${dimensao.rotulo}`}
      subtitulo={`Aplica em ${filtraveis.length} tabela(s) de uma vez — ${dimensao.cadastroCompartilhado.length} tabela(s) de cadastro compartilhado ficam sempre completas`}
      className="max-w-3xl"
    >
      <div className="space-y-4">
        <p className="text-[12.5px] text-muted">
          Vale tanto pra sincronização manual quanto pro agendamento automático em cada uma das tabelas alcançadas —
          o espelho delas fica permanentemente parcial enquanto o filtro estiver ativo.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={operador}
            onChange={(e) => setOperador(e.target.value as OperadorFiltro)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {OPERADORES.map((op) => (
              <option key={op.valor} value={op.valor}>
                {op.rotulo}
              </option>
            ))}
          </select>
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder={operador === "IN" ? "1, 2, 3" : operador === "entre" ? "de" : "valor (ex.: 1)"}
            className="w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {operador === "entre" && (
            <input
              value={valor2}
              onChange={(e) => setValor2(e.target.value)}
              placeholder="até"
              className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
          <button
            onClick={prevvisualizar}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-surface-2"
          >
            Pré-visualizar cascata
          </button>
        </div>

        {naoFiltraveis.length > 0 && (
          <p className="text-[11.5px] text-muted">
            Sem dicionário de dados no Senior, não entram: {naoFiltraveis.map((j) => j.displayName).join(", ")}.
          </p>
        )}
        {dimensao.cadastroCompartilhado.length > 0 && (
          <p className="text-[11.5px] text-muted">
            Cadastro compartilhado, sempre completo (sem a coluna de {dimensao.rotulo.toLowerCase()}):{" "}
            {dimensao.cadastroCompartilhado.map((j) => j.displayName).join(", ")}.
          </p>
        )}

        {preview === "carregando" && <p className="py-2 text-sm text-muted">Consultando o dicionário do Senior...</p>}
        {preview && typeof preview === "object" && "erro" in preview && (
          <p className="py-2 text-sm text-destructive">{preview.erro}</p>
        )}

        {resultados && (
          <div>
            <div className="max-h-72 overflow-y-auto rounded border border-border/60">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0">
                  <tr className="bg-surface-2">
                    <th className="w-8 px-2 py-1.5"></th>
                    <th className="px-2 py-1.5 text-left font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted">
                      Tabela
                    </th>
                    <th className="px-2 py-1.5 text-left font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted">
                      Query / erro
                    </th>
                    <th className="px-2 py-1.5 text-right font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted">
                      Saem do recorte
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resultados.map((r) => (
                    <tr key={r.jobName} className={`border-t border-border/40 ${!r.ok ? "opacity-60" : ""}`}>
                      <td className="px-2 py-1.5 text-center">
                        {r.ok && (
                          <input
                            type="checkbox"
                            checked={!excluidos.has(r.jobName)}
                            onChange={() => alternarExcluido(r.jobName)}
                            title="Desmarque pra excluir esta tabela da aplicação"
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-foreground">{r.displayName}</td>
                      <td className="max-w-md truncate px-2 py-1.5 font-mono text-muted" title={r.query ?? r.erro}>
                        {r.ok ? r.query : <span className="text-destructive">{r.erro}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted">
                        {r.ok && r.linhasQueSaem ? <span className="text-warning">{r.linhasQueSaem}</span> : r.ok ? "0" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Fase 5 (recorte retroativo) — o /aplicar devolveu 409: aplicar a cascata
                deixaria linha local órfã em pelo menos uma tabela. Pede uma decisão só, pra
                cascata inteira; nunca oferece "apagar". */}
            {confirmacaoRecorte ? (
              <div className="mt-3 rounded border border-warning/30 bg-warning/10 px-3 py-2">
                <p className="text-[12.5px] text-warning">{confirmacaoRecorte.mensagem}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => aplicar("deixar")}
                    disabled={aplicando}
                    className="rounded-md border border-border px-3 py-1 text-[12.5px] font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Deixar como está
                  </button>
                  {confirmacaoRecorte.suportaMarcar && (
                    <button
                      onClick={() => aplicar("marcar")}
                      disabled={aplicando}
                      className="rounded-md bg-warning px-3 py-1 text-[12.5px] font-semibold text-warning-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Marcar como removidas
                    </button>
                  )}
                  <button onClick={cancelarConfirmacaoRecorte} className="text-[12.5px] text-muted hover:underline">
                    cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  onClick={removerCascata}
                  disabled={aplicando}
                  className="text-[12.5px] text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                >
                  remover este filtro de todas as tabelas
                </button>
                <button
                  onClick={() => aplicar()}
                  disabled={aplicando || okCount === 0}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {aplicando
                    ? "Aplicando..."
                    : totalOrfaos > 0
                    ? `Aplicar a ${okCount} tabela${okCount === 1 ? "" : "s"} (${totalOrfaos} linha(s) saem do recorte)`
                    : `Aplicar a ${okCount} tabela${okCount === 1 ? "" : "s"}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
