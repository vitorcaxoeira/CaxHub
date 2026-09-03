import axios from "axios";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatHoras } from "../../utils/horas";
import { paraInputData, paraInputHora } from "../../utils/inputsDataHora";
import { Skeleton } from "../../components/ui/Skeleton";
import { Spinner } from "../../components/ui/Spinner";
import { Pagination } from "../../components/ui/Pagination";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { SelectBuscavel } from "../../components/ui/SelectBuscavel";
import { ModalEditarDescricao } from "../../components/projetos/ModalEditarDescricao";
import { ModalDespesasRat } from "../../components/projetos/ModalDespesasRat";
import { Modal } from "../../components/ui/Modal";
import { AtividadeDetalhe } from "../../components/projetos/AtividadeDetalhe";
import { toneBadge, type Tone } from "../../components/ui/badges";
import { IconeIntegracaoErp } from "../../components/ui/IconeIntegracaoErp";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useAuth } from "../../auth/AuthContext";


// Pedido de correcao de horario aguardando o gestor. Enquanto existe, o envio do
// apontamento ao Senior fica retido no servidor.
interface AjustePendente {
  id: number;
  inicioSolicitado: string;
  fimSolicitado: string;
  motivo: string;
  criadoEm: string;
}

interface SessaoPendente {
  id: number;
  atividadeId: number;
  // Junto de codfor, é a chave EXATA que o servidor usa pra encapsular na RAT
  // (buscarOuCriarRatRascunho: codemp+codfor+codpro) — usada no agrupamento do resumo do
  // "Confirmar Todos", pra nunca divergir do agrupamento real.
  codemp: number;
  codpro: number;
  numprj: number | null;
  cliente: string | null;
  codcli: number | null;
  itemDescricao: string | null;
  seqite: number | null;
  colunaNome: string;
  inicio: string;
  fim: string;
  duracaoMinutos: number;
  origem: string;
  observacao: string | null;
  codfor: number;
  // Preenchido só quando `mostrarConsultor` (admin, ou gestor vendo o time) — o consultor
  // comum só vê as próprias sessões, então mostrar o nome dele em toda linha seria ruído.
  consultorNome: string | null;
  // Editar descrição, pedir ajuste e excluir são "só o dono" nos respectivos endpoints —
  // controla quais ações do menu "⋯" a tela oferece (Confirmar não depende disto).
  souDono: boolean;
  ajustePendente: AjustePendente | null;
  // Previsão de "vai dar erro ao confirmar" (ver GET /sessoes-pendentes) — as duas causas
  // que hoje só o clique em "Confirmar" descobre: status de sincronização da alocação por
  // trás da sessão (mesmo indicador do Cronograma) e duração que trunca pra zero minuto no
  // relógio do Senior. O backend sempre calcula os dois primeiros (nunca vêm null).
  integracaoErpLabel: string;
  integracaoErpTone: Tone;
  integracaoErpErro: string | null;
  duracaoInvalida: boolean;
  // Mesma previsão acima, agora pro bloqueio de apontamento (ver
  // domain/bloqueioApontamento.ts, backend) — confirmar essa sessão vai recusar 409.
  bloqueadoApontamentoEfetivo: boolean;
}

interface AtividadeResumo {
  id: number;
  codpro: number;
  seqite: number | null;
  itemDescricao: string | null;
  // Usado no cabeçalho do grupo do seletor — número de proposta sozinho não identifica o
  // projeto pra quem lança pelo time.
  cliente: string | null;
}

// Espelha backend/src/domain/ratDominio.ts (IntegracaoErpStatus) — status agregado de
// integração da RAT com o Senior, pior caso entre os itens dela.
type IntegracaoErpStatus = "sincronizado" | "enviando" | "falha" | "pendente";

// Opções do filtro — enum fixo de 4 valores, sem endpoint de opções dedicado (mesma ideia de
// MESES_OPCOES em lib/periodos.ts).
const OPCOES_INTEGRACAO: { value: IntegracaoErpStatus; label: string }[] = [
  { value: "falha", label: "Falha no envio" },
  { value: "enviando", label: "Enviando" },
  { value: "pendente", label: "Pendente" },
  { value: "sincronizado", label: "Sincronizado" },
];

interface RatRow {
  id: number;
  numrat: number | null;
  datemi: string | null;
  codemp: number;
  codpro: number | null;
  numprj: number | null;
  cliente: string | null;
  codfor: number;
  consultorNome: string;
  sitrat: number | null;
  sitratLabel: string;
  sitratTone: Tone;
  totalItens: number;
  totalMinutos: number;
  // Status agregado de integração com o Senior (28/08/2026) — pior caso entre os itens da RAT
  // (ver calcularIntegracaoErp em backend/src/domain/ratDominio.ts). Não é o mesmo domínio de
  // sitrat: sitrat é a situação da RAT no ERP (Digitado/Aprovado/...), integracao é se os
  // apontamentos dela já chegaram lá.
  integracao: IntegracaoErpStatus;
  integracaoLabel: string;
  integracaoTone: Tone;
}

interface RatItemRow {
  id: number;
  sessaoId: number | null;
  atividadeId: number | null;
  codser: string | null;
  itemDescricao: string | null;
  // Sequência do item na proposta — vira prefixo da descrição na coluna Item.
  seqite: number | null;
  datati: string | null;
  horini: number | null;
  horfim: number | null;
  duracaoMinutos: number | null;
  desati: string | null;
  confirmadoNoSenior: boolean;
  editavel: boolean;
  // Motivo da última recusa do Senior. Preenchido = a integração falhou e há o que reenviar.
  envioErro: string | null;
  // Identidade no Senior — preenchida quando o apontamento foi registrado no ERP. É o
  // que trava editar/excluir, então a tela precisa mostrar por quê.
  numrat: number | null;
  seqrat: number | null;
  // Estado do envio ao ERP: pendente | enviando | enviado | bloqueado | null.
  envioStatus: string | null;
}

interface ConsultorFiltro {
  codfor: number;
  nome: string;
}

// Opções do filtro de situação da RAT (USU_LSITRAT) — vêm do backend (GET
// /rats/opcoes-filtro), que reaproveita o mesmo domínio de backend/src/domain/ratDominio.ts
// já usado no rótulo/tom de cada linha (sitratLabel/sitratTone). Sem lista fixa aqui: uma
// única fonte pro rótulo/ordem.
interface SituacaoRatOpcao {
  sitrat: number;
  label: string;
}

// Cabeçalho da atividade devolvido por GET /atividades/:id/detalhe — o mesmo conjunto que
// a tela de Atividades passa por prop pro AtividadeDetalhe. Só os campos consumidos aqui.
interface AtividadeDetalheDados {
  id: number;
  codemp: number;
  codpro: number;
  numprj: number | null;
  dataPrevistaInicio: string | null;
  dataPrevistaFim: string | null;
  itemDescricao: string | null;
  itemQtdhor: number | null;
  itemAlocado: number;
  itemRealizado: number;
  estruturaNome: string | null;
  estruturaPercentual: number | null;
  podeVerCronograma: boolean;
  // Opcionais porque esta tela monta o objeto a partir de outra rota, que pode não trazer
  // os dois — o painel trata a ausência como "sem excedente".
  qtdhorPrevisto?: number | null;
  horasExcedentes?: number;
  horasRealizadas: number;
}

const dataCurtaFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const horaCurtaFormatter = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

function formatHorario(inicioIso: string, fimIso: string): string {
  return `${horaCurtaFormatter.format(new Date(inicioIso))}–${horaCurtaFormatter.format(new Date(fimIso))}`;
}

function formatMinutos(minutos: number): string {
  return formatHoras(minutos / 60);
}

// Item da proposta com a sequência como prefixo ("3 - Automação de indicadores"). Mesma
// forma de "código - descrição" já usada em cliente (`${codcli} - ${nomcli}`).
//
// Assinatura estrutural pra servir às DUAS tabelas da tela (sessões pendentes e itens da
// RAT): elas mostram o mesmo dado e antes divergiam — aqui era sufixo entre parênteses,
// lá não havia sequência nenhuma.
function rotuloItem(item: { seqite: number | null; itemDescricao: string | null }): string {
  const descricao = item.itemDescricao ?? "—";
  return item.seqite != null ? `${item.seqite} - ${descricao}` : descricao;
}

// Quando a observação de um item pode ser alterada: as mesmas condições que o backend
// valida em PATCH /apontamentos/:id (dono, RAT ainda Digitada, item não registrado no
// Senior) mais a guarda de envio em voo — nesse instante o job já leu o registro pra
// montar o payload, então a edição não chegaria ao ERP.
function podeEditarObservacao(item: RatItemRow): boolean {
  return item.editavel && item.sessaoId != null && item.envioStatus !== "enviando";
}

function formatHoraDoDia(minutosDesdeMeiaNoite: number): string {
  const h = Math.floor(minutosDesdeMeiaNoite / 60);
  const m = minutosDesdeMeiaNoite % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const PAGE_SIZE_RATS = 30;

// Estado da integração daquele apontamento com o Senior, na própria coluna de ação.
// A ordem vai do mais definitivo pro mais transitório:
//   registrado -> mostra a RAT (e não há mais o que fazer, nem excluir nem editar);
//   falhou     -> mostra o erro do ERP e oferece reenviar;
//   em voo     -> spinner, e o "Excluir" NÃO aparece (o backend recusaria de todo jeito,
//                 porque só libera desfazer enquanto a pendência está "pendente");
//   nada disso -> "Excluir", que é o estado normal de um apontamento ainda não enviado.
function AcaoIntegracao({
  item,
  reenviando,
  onReenviar,
  onExcluir,
  onVerErro,
}: {
  item: RatItemRow;
  reenviando: boolean;
  onReenviar: () => void;
  onExcluir: () => void;
  onVerErro: () => void;
}) {
  if (item.confirmadoNoSenior) {
    return (
      <span
        className="font-mono text-[11px] text-success"
        title={`Registrado no Senior — RAT ${item.numrat}, sequência ${item.seqrat}. Não é mais possível editar nem excluir.`}
      >
        RAT {item.numrat}/{item.seqrat}
      </span>
    );
  }

  const emVoo = reenviando || item.envioStatus === "enviando" || (item.envioStatus === "pendente" && !item.envioErro);
  if (emVoo) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
        <Spinner className="h-3 w-3" />
        integrando...
      </span>
    );
  }

  // "pendente" com erro = falhou e vai tentar de novo sozinho no cron; "bloqueado" =
  // esgotou as tentativas. Nos dois casos o consultor consegue forçar agora.
  if (item.envioErro) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          onClick={onVerErro}
          className="text-[11px] text-destructive underline decoration-dotted hover:decoration-solid"
          title="Clique para ver o erro completo"
        >
          falha no envio
        </button>
        <button onClick={onReenviar} className="text-[11px] text-primary hover:underline">
          Reenviar
        </button>
      </span>
    );
  }

  // Não registrado e sem envio em curso: ou nunca foi enviado, ou foi desvinculado porque
  // apagaram o apontamento no Senior (ver desvincularItensAusentesNoSenior no backend).
  // Nos dois casos o envio é manual — nada é reintegrado sem o consultor pedir, porque a
  // exclusão do outro lado pode ter sido intencional.
  const podeEnviar = item.envioStatus == null || item.envioStatus === "enviado";
  return (
    <span className="inline-flex items-center gap-2">
      {podeEnviar && (
        <button
          onClick={onReenviar}
          className="text-[11px] text-primary hover:underline"
          title="Registrar este apontamento no Senior"
        >
          Enviar
        </button>
      )}
      {/* Sem "Pedir ajuste" aqui de propósito: o ajuste só existe ANTES de confirmar (ver
          confirmarSessao no backend). Depois de confirmado o apontamento já está na RAT e,
          em segundos, no Senior. */}
      {item.editavel && item.sessaoId != null && (
        <button onClick={onExcluir} className="text-[11px] text-destructive hover:underline">
          Excluir
        </button>
      )}
      {!podeEnviar && !item.editavel && <span className="text-[11px] text-muted">—</span>}
    </span>
  );
}

const selectClass =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Tela do consultor: revisa as sessões que o sistema já rastreou automaticamente (ao
// mover o card pra uma coluna "em execução", ver PATCH /atividades/:id/mover) e
// confirma — só nesse momento vira um apontamento de verdade (RatItem) e entra na fila
// pro Senior. O botão "+ Apontamento manual" cobre o caso de não ter passado pelo Kanban
// (trabalho fora do CaxHub, ou esqueceu de mover o card) e é restrito a gestor de
// departamento e admin — inclusive no servidor, ver podeLancarManual em
// backend/src/routes/apontamentos.ts. Gestor pode lançar por qualquer consultor do time.
//
// Apontamentos confirmados aparecem agrupados por RAT (Rat/RatItem, ver backend/src/
// routes/rats.ts) — uma RAT por consultor+proposta, aberta enquanto "Digitada",
// recebendo apontamentos de qualquer dia até o gestor do departamento (ou admin) a
// aprovar. Consultor comum só vê as próprias RATs; gestor/admin ganham um seletor pra
// ver as de quem eles gerenciam.
// Acompanhamento do envio ao ERP depois de confirmar: ~20s no total. O envio costuma
// levar poucos segundos; passando disso, o cron de 15 min assume e a tela avisa que
// segue em andamento em vez de mentir um desfecho.
const ENVIO_INTERVALO_MS = 1500;
const ENVIO_MAX_TENTATIVAS = 13;

export function MeusApontamentos() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Despesas de Viagem: restrito a admin por enquanto, enquanto o recurso está em validação
  // (mesma regra aplicada no backend, ver podeGerenciarDespesas em routes/rats.ts).
  const podeGerenciarDespesas = user?.role === "admin";
  const [sessoes, setSessoes] = useState<SessaoPendente[]>([]);
  // Admin vê as sessões pendentes de todos os consultores; gestor vê as próprias + as do
  // time que gerencia (ver GET /sessoes-pendentes) — é o que liga a coluna Consultor e a
  // barra de filtros abaixo.
  const [mostrarConsultor, setMostrarConsultor] = useState(false);
  const [buscaSessoesInput, setBuscaSessoesInput] = useState("");
  const buscaSessoesDebounced = useDebouncedValue(buscaSessoesInput, 350);
  const [codforsFiltroSessoes, setCodforsFiltroSessoes] = useState<number[]>([]);
  // Filtro de período (AtividadeSessaoExecucao.inicio) — sem debounce, é <input type="date">,
  // seleção discreta, não busca-enquanto-digita.
  const [dataInicioFiltro, setDataInicioFiltro] = useState("");
  const [dataFimFiltro, setDataFimFiltro] = useState("");
  const [atividades, setAtividades] = useState<AtividadeResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [excluindoSessao, setExcluindoSessao] = useState<number | null>(null);
  // Acordeon de "Sessões pendentes" por consultor (só aparece quando mostrarConsultor) —
  // chave é o codfor, igual ao agrupamento de abrirResumoLote logo abaixo.
  const [consultoresExpandidos, setConsultoresExpandidos] = useState<Set<number>>(new Set());

  // Pedido de correção de horário. Enquanto pendente, o envio do apontamento ao Senior fica
  // retido no servidor — é o que permite corrigir sem alterar nada do lado do ERP.
  // `pendente` preenchido = já existe pedido aguardando o gestor; o formulário abre em
  // leitura. Deixar editar seria oferecer uma ação que o servidor recusa: o índice único
  // parcial só admite um pendente por apontamento.
  const [pedidoAjuste, setPedidoAjuste] = useState<{
    sessaoId: number;
    titulo: string;
    pendente: AjustePendente | null;
  } | null>(null);
  const [ajusteData, setAjusteData] = useState("");
  const [ajusteInicio, setAjusteInicio] = useState("");
  const [ajusteFim, setAjusteFim] = useState("");
  const [ajusteMotivo, setAjusteMotivo] = useState("");
  const [enviandoAjuste, setEnviandoAjuste] = useState(false);
  const [erroAjuste, setErroAjuste] = useState<string | null>(null);
  const [descricoes, setDescricoes] = useState<Record<number, string>>({});
  const [editandoDescricaoId, setEditandoDescricaoId] = useState<number | null>(null);

  const [rats, setRats] = useState<RatRow[]>([]);
  const [totalRats, setTotalRats] = useState(0);
  const [pageRats, setPageRats] = useState(1);
  const [loadingRats, setLoadingRats] = useState(true);
  const [opcoesFiltro, setOpcoesFiltro] = useState<ConsultorFiltro[]>([]);
  const [codforsFiltro, setCodforsFiltro] = useState<number[]>([]);
  const [situacoesRat, setSituacoesRat] = useState<SituacaoRatOpcao[]>([]);
  const [sitratFiltro, setSitratFiltro] = useState<number[]>([]);
  const [integracaoFiltro, setIntegracaoFiltro] = useState<IntegracaoErpStatus[]>([]);
  const [buscaInput, setBuscaInput] = useState("");
  const buscaDebounced = useDebouncedValue(buscaInput, 350);
  const [buscaItemInput, setBuscaItemInput] = useState("");
  const buscaItemDebounced = useDebouncedValue(buscaItemInput, 350);
  const [ratsExpandidas, setRatsExpandidas] = useState<Set<number>>(new Set());
  const [itensPorRat, setItensPorRat] = useState<Record<number, RatItemRow[] | "carregando" | "erro">>({});
  const [sincronizando, setSincronizando] = useState<number | null>(null);
  const [despesasRat, setDespesasRat] = useState<RatRow | null>(null);

  const [modalManual, setModalManual] = useState(false);
  // Por quem o apontamento pode ser lançado: o próprio usuário e, se for gestor, o time
  // dos departamentos que ele gerencia. Separado de `opcoesFiltro` (filtro das RATs), que
  // vem das RATs existentes e não serve aqui — consultor sem RAT não apareceria.
  const [consultoresManual, setConsultoresManual] = useState<ConsultorFiltro[]>([]);
  // Quem decide é o servidor (é ele que também recusa o POST) — a tela só obedece.
  const [podeLancarManual, setPodeLancarManual] = useState(false);
  const [manualCodfor, setManualCodfor] = useState("");
  const [carregandoAtividadesManual, setCarregandoAtividadesManual] = useState(false);
  const [manualAtividadeId, setManualAtividadeId] = useState("");
  const [manualData, setManualData] = useState("");
  const [manualInicio, setManualInicio] = useState("");
  const [manualFim, setManualFim] = useState("");
  const [manualDescricao, setManualDescricao] = useState("");
  const [salvandoManual, setSalvandoManual] = useState(false);
  const [erroManual, setErroManual] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    Promise.all([axios.get("/api/apontamentos/sessoes-pendentes"), axios.get("/api/apontamentos/minhas-atividades")])
      .then(([sessoesRes, atividadesRes]) => {
        setSessoes(sessoesRes.data.sessoes);
        setMostrarConsultor(Boolean(sessoesRes.data.mostrarConsultor));
        setAtividades(atividadesRes.data.atividades);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar apontamentos"))
      .finally(() => setLoading(false));
  }

  // Atividades de quem vai receber o apontamento. Sem codfor, o backend usa o próprio
  // usuário — é o caminho do consultor comum, idêntico ao de antes.
  function carregarAtividadesManual(codfor: string) {
    setCarregandoAtividadesManual(true);
    axios
      .get("/api/apontamentos/minhas-atividades", { params: { codfor: codfor || undefined } })
      .then(({ data }) => setAtividades(data.atividades))
      .catch((err) => setErroManual(err.response?.data?.error ?? "Falha ao carregar as atividades do consultor"))
      .finally(() => setCarregandoAtividadesManual(false));
  }

  function onMudarConsultorManual(codfor: string) {
    setManualCodfor(codfor);
    // Limpa a atividade: a que estava escolhida é de outro consultor e o POST recusaria.
    setManualAtividadeId("");
    setErroManual(null);
    carregarAtividadesManual(codfor);
  }

  function carregarRats() {
    setLoadingRats(true);
    axios
      .get("/api/rats", {
        params: {
          codfor: codforsFiltro.length > 0 ? codforsFiltro.join(",") : undefined,
          sitrat: sitratFiltro.length > 0 ? sitratFiltro.join(",") : undefined,
          busca: buscaDebounced || undefined,
          buscaItem: buscaItemDebounced || undefined,
          integracao: integracaoFiltro.length > 0 ? integracaoFiltro.join(",") : undefined,
          page: pageRats,
          pageSize: PAGE_SIZE_RATS,
        },
      })
      .then(({ data }) => {
        setRats(data.rats);
        setTotalRats(data.total);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar RATs"))
      .finally(() => setLoadingRats(false));
  }

  useEffect(() => {
    carregar();
    axios
      .get("/api/rats/opcoes-filtro")
      .then(({ data }) => {
        setOpcoesFiltro(data.consultores);
        setSituacoesRat(data.situacoesRat ?? []);
      })
      .catch(() => {});
    axios
      .get("/api/apontamentos/consultores")
      .then(({ data }) => {
        setConsultoresManual(data.consultores);
        setPodeLancarManual(Boolean(data.podeLancarManual));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregarRats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codforsFiltro, sitratFiltro, integracaoFiltro, buscaDebounced, buscaItemDebounced, pageRats]);

  // Digitar reseta pra página 1 (senão a busca poderia "sumir" numa página que não
  // existe mais no resultado filtrado) — só dispara depois do debounce, pra não
  // recarregar a cada tecla.
  useEffect(() => {
    setPageRats(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced, buscaItemDebounced]);

  function onMudarFiltroConsultor(codfors: number[]) {
    setCodforsFiltro(codfors);
    // Volta pra página 1: o resultado filtrado pode ter menos páginas que o atual, e a
    // lista "sumiria" numa página que não existe mais.
    setPageRats(1);
  }

  function onMudarFiltroSitrat(valores: number[]) {
    setSitratFiltro(valores);
    setPageRats(1);
  }

  function onMudarFiltroIntegracao(valores: IntegracaoErpStatus[]) {
    setIntegracaoFiltro(valores);
    setPageRats(1);
  }

  // Apontamentos com reenvio disparado agora — mantém o spinner na linha entre o clique e
  // a primeira resposta do acompanhamento.
  const [reenviando, setReenviando] = useState<Set<number>>(new Set());
  // Resultado informativo do "Sinc. ERP" (ex.: itens desvinculados). Separado de `erro`
  // porque não é falha — é o sync tendo encontrado divergência e resolvido.
  const [avisoSinc, setAvisoSinc] = useState<string | null>(null);
  // Atividade aberta no painel de detalhe (o mesmo do card do quadro), em modo leitura.
  const [detalheAtividade, setDetalheAtividade] = useState<AtividadeDetalheDados | null>(null);
  // Item da RAT com a observação em edição. Guarda o ratId junto porque depois de salvar é
  // preciso recarregar os itens daquela RAT.
  const [editandoObservacao, setEditandoObservacao] = useState<{
    item: RatItemRow;
    ratId: number;
    somenteLeitura: boolean;
  } | null>(null);
  // Item com "falha no envio" cujo erro completo está sendo visualizado — mesmo modal (só
  // leitura) usado pra ler a observação inteira de um item já confirmado.
  const [erroEnvioItem, setErroEnvioItem] = useState<RatItemRow | null>(null);

  // Timers do acompanhamento, cancelados ao sair da tela pra não bater em endpoint depois
  // que o componente já saiu.
  const timersEnvioRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = timersEnvioRef;
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  // Escreve o estado do envio direto no item já carregado, em vez de recarregar a RAT
  // inteira: é o que faz a célula de ação mudar sozinha (spinner -> RAT n/seq, ou -> erro)
  // sem piscar a tabela.
  function atualizarEnvioDoItem(
    ratId: number,
    ratItemId: number,
    dados: { status: string; numrat: number | null; seqrat: number | null; erro: string | null }
  ) {
    setItensPorRat((atual) => {
      const itens = atual[ratId];
      if (!Array.isArray(itens)) return atual;
      return {
        ...atual,
        [ratId]: itens.map((i) =>
          i.id !== ratItemId
            ? i
            : {
                ...i,
                envioStatus: dados.status,
                envioErro: dados.erro,
                numrat: dados.numrat,
                seqrat: dados.seqrat,
                confirmadoNoSenior: dados.status === "registrado",
                // Registrado no Senior deixa de ser editável na hora — o backend recusa
                // tanto editar quanto excluir a partir daí.
                editavel: dados.status === "registrado" ? false : i.editavel,
              }
        ),
      };
    });

    // A coluna "RAT" da linha-cabeçalho (tabela de fora) mostra `rat.numrat`, que fica
    // parado no que veio do último `carregarRats()` — sem isto, o número só aparece depois
    // de um F5. Atualiza sempre que o Senior confirmar um número, mesmo que a RAT já
    // tivesse um antes e o novo venha diferente (ex.: a RAT foi desvinculada — ver
    // desvincularRatAusenteNoSenior no backend — e o reenvio criou uma RAT NOVA lá).
    if (dados.status === "registrado" && dados.numrat != null) {
      setRats((atual) => atual.map((r) => (r.id !== ratId ? r : { ...r, numrat: dados.numrat })));
    }
  }

  // O apontamento é enviado ao Senior em segundo plano, então a releitura que acontece
  // logo após confirmar sempre pega o item ainda na fila. Isto aqui é o que fecha o ciclo:
  // pergunta de tempos em tempos como foi e reflete na linha, até haver desfecho.
  function acompanharEnvio(ratItemId: number, ratId: number, tentativa = 0) {
    const timer = window.setTimeout(async () => {
      let concluido = false;
      try {
        const { data } = await axios.get(`/api/apontamentos/envio/${ratItemId}`);
        atualizarEnvioDoItem(ratId, ratItemId, data);
        // Registrado é definitivo; bloqueado e "falhou mas vai retentar" já têm erro pra
        // mostrar, então em ambos vale parar de perguntar e deixar o Reenviar na mão do
        // consultor.
        concluido = data.status === "registrado" || data.status === "bloqueado" || Boolean(data.erro);
      } catch {
        // Falha de rede no acompanhamento é transitória — tenta de novo no próximo tick.
      }

      if (concluido) return;
      if (tentativa + 1 < ENVIO_MAX_TENTATIVAS) {
        acompanharEnvio(ratItemId, ratId, tentativa + 1);
      }
      // Estourou o tempo sem desfecho: a linha fica no spinner e o cron de 15 min assume.
      // Recarregar a RAT depois mostra o resultado.
    }, ENVIO_INTERVALO_MS);
    timersEnvioRef.current.push(timer);
  }

  async function reenviarAoSenior(ratItemId: number, ratId: number) {
    setReenviando((atual) => new Set(atual).add(ratItemId));
    try {
      await axios.post(`/api/apontamentos/envio/${ratItemId}/reenviar`);
      acompanharEnvio(ratItemId, ratId);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao reenviar o apontamento ao ERP");
    } finally {
      setReenviando((atual) => {
        const proximo = new Set(atual);
        proximo.delete(ratItemId);
        return proximo;
      });
    }
  }

  async function confirmar(sessaoId: number) {
    setConfirmando(sessaoId);
    // Cai pra observacao (pré-preenchida ao sair de "Em Andamento", ver Atividades.tsx)
    // quando o usuário não editou o campo — senão o texto pré-preenchido só aparecia na
    // tela e nunca era enviado de fato.
    const sessao = sessoes.find((s) => s.id === sessaoId);
    const descricao = descricoes[sessaoId] ?? sessao?.observacao ?? "";
    try {
      const { data } = await axios.post("/api/apontamentos/confirmar", { sessaoId, descricao: descricao || undefined });
      carregar();
      carregarRats();
      if (data?.ratId != null) expandirEAtualizarRat(data.ratId);
      // O envio ao ERP roda em segundo plano; a linha do apontamento mostra o andamento.
      if (data?.ratItemId != null && data?.ratId != null) acompanharEnvio(data.ratItemId, data.ratId);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao confirmar apontamento");
    } finally {
      setConfirmando(null);
    }
  }

  // "Confirmar Todos" — resumo ANTES de disparar, agrupado pela MESMA chave que
  // buscarOuCriarRatRascunho usa no servidor (codemp+codfor+codpro) pra encapsular o
  // apontamento na RAT. É o que deixa visível, antes do clique, que a confirmação em lote
  // não vai misturar proposta nenhuma — cada grupo aqui vira exatamente uma RAT (nova ou
  // já existente) lá no servidor.
  interface GrupoResumoLote {
    chave: string;
    codpro: number;
    consultorNome: string | null;
    sessaoIds: number[];
    minutos: number;
  }
  const [resumoLote, setResumoLote] = useState<GrupoResumoLote[] | null>(null);
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [resultadoLote, setResultadoLote] = useState<{ confirmados: number; falhas: { sessaoId: number; erro: string }[] } | null>(
    null
  );

  function abrirResumoLote() {
    const porGrupo = new Map<string, GrupoResumoLote>();
    for (const s of sessoesFiltradas) {
      const chave = `${s.codemp}-${s.codfor}-${s.codpro}`;
      let grupo = porGrupo.get(chave);
      if (!grupo) {
        grupo = { chave, codpro: s.codpro, consultorNome: s.consultorNome, sessaoIds: [], minutos: 0 };
        porGrupo.set(chave, grupo);
      }
      grupo.sessaoIds.push(s.id);
      grupo.minutos += s.duracaoMinutos;
    }
    setResultadoLote(null);
    setResumoLote([...porGrupo.values()].sort((a, b) => b.codpro - a.codpro));
  }

  async function confirmarTodos() {
    if (!resumoLote) return;
    setConfirmandoLote(true);
    const itens = resumoLote
      .flatMap((g) => g.sessaoIds)
      .map((sessaoId) => {
        const sessao = sessoes.find((s) => s.id === sessaoId);
        const descricao = descricoes[sessaoId] ?? sessao?.observacao ?? "";
        return { sessaoId, descricao: descricao || undefined };
      });
    try {
      const { data } = await axios.post("/api/apontamentos/confirmar-lote", { itens });
      setResultadoLote({ confirmados: data.confirmados?.length ?? 0, falhas: data.falhas ?? [] });
      carregar();
      carregarRats();
      // Falha parcial fica visível no próprio diálogo (ver render abaixo) — só fecha
      // sozinho quando tudo deu certo, senão o consultor perderia de vista o que travou.
      if (!data.falhas || data.falhas.length === 0) setResumoLote(null);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao confirmar em lote");
      setResumoLote(null);
    } finally {
      setConfirmandoLote(false);
    }
  }

  function limparFormularioManual() {
    // Volta pro próprio usuário e recarrega as atividades dele: sem isso, o gestor que
    // lançou por alguém do time reabriria o modal com a lista do outro consultor.
    if (manualCodfor) {
      setManualCodfor("");
      carregarAtividadesManual("");
    }
    setManualAtividadeId("");
    setManualData("");
    setManualInicio("");
    setManualFim("");
    setManualDescricao("");
    setErroManual(null);
  }

  async function salvarManual() {
    if (!manualAtividadeId || !manualData || !manualInicio || !manualFim) {
      setErroManual("Preencha atividade, data e os dois horários");
      return;
    }
    setSalvandoManual(true);
    setErroManual(null);
    try {
      const { data } = await axios.post("/api/apontamentos/manual", {
        atividadeId: Number(manualAtividadeId),
        inicio: `${manualData}T${manualInicio}:00`,
        fim: `${manualData}T${manualFim}:00`,
        descricao: manualDescricao || undefined,
      });
      setModalManual(false);
      limparFormularioManual();
      carregar();
      carregarRats();
      if (data?.ratId != null) expandirEAtualizarRat(data.ratId);
      // Mesmo caminho da confirmação de sessão (a rota /manual reusa confirmarSessao),
      // então o envio ao ERP também roda em segundo plano e precisa ser acompanhado.
      if (data?.ratItemId != null && data?.ratId != null) acompanharEnvio(data.ratItemId, data.ratId);
    } catch (err: any) {
      setErroManual(err.response?.data?.error ?? "Falha ao lançar apontamento");
    } finally {
      setSalvandoManual(false);
    }
  }

  function toggleExpandirRat(rat: RatRow) {
    setRatsExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(rat.id)) {
        proximo.delete(rat.id);
      } else {
        proximo.add(rat.id);
        if (!itensPorRat[rat.id]) {
          setItensPorRat((i) => ({ ...i, [rat.id]: "carregando" }));
          axios
            .get(`/api/rats/${rat.id}/itens`)
            .then(({ data }) => setItensPorRat((i) => ({ ...i, [rat.id]: data.itens })))
            .catch(() => setItensPorRat((i) => ({ ...i, [rat.id]: "erro" })));
        }
      }
      return proximo;
    });
  }

  // Após confirmar um apontamento, abre a RAT que recebeu o item (se ainda não estava
  // expandida) e força a releitura dos itens — senão o item recém-inserido só aparece
  // depois de recolher/reexpandir manualmente.
  function expandirEAtualizarRat(ratId: number) {
    setRatsExpandidas((atual) => new Set(atual).add(ratId));
    setItensPorRat((i) => ({ ...i, [ratId]: "carregando" }));
    axios
      .get(`/api/rats/${ratId}/itens`)
      .then(({ data }) => setItensPorRat((i) => ({ ...i, [ratId]: data.itens })))
      .catch(() => setItensPorRat((i) => ({ ...i, [ratId]: "erro" })));
  }

  // Abre o MESMO painel de detalhe do card do quadro, só que em leitura. Os dados de
  // cabeçalho vêm de GET /atividades/:id/detalhe, que reaproveita a derivação da listagem
  // de Atividades (item, alocado, realizado, estrutura) — aqui só se tem o atividadeId.
  async function abrirDetalheAtividade(atividadeId: number) {
    try {
      const { data } = await axios.get(`/api/atividades/${atividadeId}/detalhe`);
      setDetalheAtividade(data.atividade);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao abrir a atividade");
    }
  }

  // Descrição de uma sessão AINDA NÃO confirmada (sem RatItem) — o mesmo PATCH usado abaixo
  // para item já confirmado, mas o backend detecta a ausência de RatItem e grava direto em
  // AtividadeSessaoExecucao.observacao. Sem isso, o texto só existia no estado local
  // (`descricoes`) e um F5 antes de clicar Confirmar perdia a edição.
  async function salvarDescricaoSessaoPendente(sessaoId: number, texto: string) {
    try {
      await axios.patch(`/api/apontamentos/${sessaoId}`, { desati: texto });
      setDescricoes((atual) => ({ ...atual, [sessaoId]: texto }));
      setEditandoDescricaoId(null);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao salvar a descrição");
    }
  }

  // Observação (RatItem.desati) de um item já confirmado. É o campo que a aprovação da RAT
  // exige em todos os itens e que vai no desAti do Senior, então precisa ser preenchível
  // depois do fato — o backend só permite enquanto o item não foi registrado no ERP.
  async function salvarObservacaoItem(sessaoId: number, ratId: number, texto: string) {
    try {
      await axios.patch(`/api/apontamentos/${sessaoId}`, { desati: texto });
      setEditandoObservacao(null);
      const { data } = await axios.get(`/api/rats/${ratId}/itens`);
      setItensPorRat((i) => ({ ...i, [ratId]: data.itens }));
      // A RAT só pode ser aprovada (em /api/rats/:id/aprovar) quando todo item tem
      // observação preenchida — recarregar a lista mantém o totalItens/status em dia.
      carregarRats();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao salvar a observação");
    }
  }

  async function sincronizarErp(rat: RatRow) {
    setSincronizando(rat.id);
    setAvisoSinc(null);
    try {
      const { data } = await axios.post(`/api/rats/${rat.id}/sincronizar`);
      carregarRats();
      if (itensPorRat[rat.id]) {
        const { data: itensData } = await axios.get(`/api/rats/${rat.id}/itens`);
        setItensPorRat((i) => ({ ...i, [rat.id]: itensData.itens }));
      }
      // Cada situação vira uma linha própria do aviso — as três podem acontecer na mesma
      // chamada agora (busca + reenvio na mesma ação), em ordem de gravidade: RAT inteira
      // desvinculada primeiro, depois itens desvinculados, depois o resultado do reenvio.
      const avisos: string[] = [];
      if (data?.ratDesvinculada) {
        avisos.push(
          "Esta RAT não existe mais no Senior — o vínculo com o número do ERP foi removido. " +
            "Os apontamentos dela podem ser enviados de novo, e vão gerar uma RAT nova por lá."
        );
      }
      if (data?.desvinculados > 0) {
        // Apontamento apagado no Senior perde o vínculo aqui e volta a poder ser enviado —
        // isso precisa ser dito, senão o item muda de estado sem explicação nenhuma.
        const seqrats = (data.seqratsDesvinculados ?? []).join(", ");
        avisos.push(
          `${data.desvinculados} apontamento(s) não existem mais no Senior (sequência ${seqrats}) — ` +
            `o vínculo foi removido e eles podem ser enviados de novo pela ação "Enviar".`
        );
      }
      if (data?.itensReenviados > 0) {
        // `integracao` já vem recalculada pós-tentativa — dá pra dizer se resolveu sem
        // precisar de outra chamada.
        avisos.push(
          data.integracao === "sincronizado"
            ? `${data.itensReenviados} apontamento(s) pendente(s)/com erro foram reenviados e confirmados no Senior.`
            : `${data.itensReenviados} apontamento(s) pendente(s)/com erro foram reenviados, mas ainda há falha — ` +
                `veja o detalhe na lista de itens.`
        );
      }
      if (avisos.length > 0) {
        setAvisoSinc(avisos.join(" "));
      }
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao sincronizar com o ERP");
    } finally {
      setSincronizando(null);
    }
  }

  async function excluirApontamento(id: number, ratId: number) {
    try {
      await axios.delete(`/api/apontamentos/${id}`);
      const { data } = await axios.get(`/api/rats/${ratId}/itens`);
      setItensPorRat((i) => ({ ...i, [ratId]: data.itens }));
      carregar();
      carregarRats();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir apontamento");
    }
  }

  // Exclusão de sessão ainda NÃO confirmada. Mesma rota do apontamento confirmado — ela
  // marca a sessão como excluída dos dois jeitos; a diferença é que aqui não há RatItem
  // nem RAT pra recarregar.
  async function excluirSessao(sessaoId: number) {
    if (!confirm("Excluir este apontamento? Ele sai da lista e deixa de contar nas horas da atividade.")) return;
    setExcluindoSessao(sessaoId);
    try {
      await axios.delete(`/api/apontamentos/${sessaoId}`);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir o apontamento");
    } finally {
      setExcluindoSessao(null);
    }
  }

  // Um ponto só pra abrir o formulário, das duas tabelas. Com pedido pendente, os campos
  // nascem com o que FOI PEDIDO (não com o horário atual) — é o que a pessoa quer conferir.
  function abrirPedidoAjuste(
    sessaoId: number,
    titulo: string,
    inicioAtual: string,
    fimAtual: string | null,
    pendente: AjustePendente | null
  ) {
    setPedidoAjuste({ sessaoId, titulo, pendente });
    const inicio = pendente?.inicioSolicitado ?? inicioAtual;
    const fim = pendente?.fimSolicitado ?? fimAtual;
    setAjusteData(paraInputData(inicio));
    setAjusteInicio(paraInputHora(inicio));
    setAjusteFim(fim ? paraInputHora(fim) : "");
    setAjusteMotivo(pendente?.motivo ?? "");
    setErroAjuste(null);
  }

  async function enviarPedidoAjuste() {
    if (!pedidoAjuste) return;
    if (!ajusteData || !ajusteInicio || !ajusteFim) {
      setErroAjuste("Informe a data, a hora inicial e a hora final.");
      return;
    }
    if (ajusteFim <= ajusteInicio) {
      setErroAjuste("A hora final precisa ser depois da inicial.");
      return;
    }
    if (ajusteMotivo.trim() === "") {
      setErroAjuste("Informe o motivo da correção.");
      return;
    }
    setEnviandoAjuste(true);
    setErroAjuste(null);
    try {
      await axios.post("/api/solicitacoes-ajuste", {
        sessaoId: pedidoAjuste.sessaoId,
        inicio: new Date(`${ajusteData}T${ajusteInicio}`).toISOString(),
        fim: new Date(`${ajusteData}T${ajusteFim}`).toISOString(),
        motivo: ajusteMotivo.trim(),
      });
      setPedidoAjuste(null);
      carregar();
      carregarRats();
    } catch (err: any) {
      setErroAjuste(err.response?.data?.error ?? "Falha ao enviar o pedido");
    } finally {
      setEnviandoAjuste(false);
    }
  }

  // Opções do multi-select de consultor — só quem TEM sessão pendente na lista carregada,
  // não a base inteira de consultores (mesmo critério da barra de RATs logo abaixo).
  const opcoesFiltroSessoes = useMemo(() => {
    const porCodfor = new Map<number, string>();
    for (const s of sessoes) {
      if (s.consultorNome && !porCodfor.has(s.codfor)) porCodfor.set(s.codfor, s.consultorNome);
    }
    return [...porCodfor.entries()]
      .map(([codfor, nome]) => ({ codfor, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [sessoes]);

  // Filtro em memória: a lista inteira já vem carregada (volume baixo, dezenas de linhas
  // no pior caso — não vale um round-trip ao servidor pra isso, ver plano). Busca casa
  // contra cliente, nº da proposta e a descrição do item (mesmos campos da busca de RATs).
  const sessoesFiltradas = useMemo(() => {
    const busca = buscaSessoesDebounced.trim().toLowerCase();
    // Início/fim do dia local do navegador — mesma convenção do resto da tela (paraInputData/
    // paraInputHora já fazem a mesma leitura de hora local pros formulários de ajuste).
    const inicioFiltro = dataInicioFiltro ? new Date(`${dataInicioFiltro}T00:00:00`).getTime() : null;
    const fimFiltro = dataFimFiltro ? new Date(`${dataFimFiltro}T23:59:59.999`).getTime() : null;
    return sessoes.filter((s) => {
      if (codforsFiltroSessoes.length > 0 && !codforsFiltroSessoes.includes(s.codfor)) return false;
      const inicioSessao = new Date(s.inicio).getTime();
      if (inicioFiltro != null && inicioSessao < inicioFiltro) return false;
      if (fimFiltro != null && inicioSessao > fimFiltro) return false;
      if (!busca) return true;
      const alvo = `${s.cliente ?? ""} ${s.codpro} ${rotuloItem(s)}`.toLowerCase();
      return alvo.includes(busca);
    });
  }, [sessoes, codforsFiltroSessoes, buscaSessoesDebounced, dataInicioFiltro, dataFimFiltro]);

  // Mesma chave de agrupamento de abrirResumoLote (codfor), só que aqui vira acordeon visual
  // em vez de resumo de confirmação em lote — só faz sentido junto de mostrarConsultor, senão
  // é sempre 1 grupo só (o próprio usuário).
  const gruposPorConsultor = useMemo(() => {
    const porConsultor = new Map<number, { codfor: number; consultorNome: string; sessoes: SessaoPendente[]; totalMinutos: number }>();
    for (const s of sessoesFiltradas) {
      let grupo = porConsultor.get(s.codfor);
      if (!grupo) {
        grupo = { codfor: s.codfor, consultorNome: s.consultorNome ?? "—", sessoes: [], totalMinutos: 0 };
        porConsultor.set(s.codfor, grupo);
      }
      grupo.sessoes.push(s);
      grupo.totalMinutos += s.duracaoMinutos;
    }
    return [...porConsultor.values()].sort((a, b) => a.consultorNome.localeCompare(b.consultorNome, "pt-BR"));
  }, [sessoesFiltradas]);

  // Abre sozinho quando só sobra 1 consultor na lista filtrada (ex.: gestor buscou/filtrou até
  // um só) — dependência é o codfor em si, não o array inteiro, pra não reabrir a cada
  // recarregamento se o usuário tiver fechado de propósito.
  const unicoConsultorVisivel = gruposPorConsultor.length === 1 ? gruposPorConsultor[0].codfor : null;
  useEffect(() => {
    if (unicoConsultorVisivel == null) return;
    setConsultoresExpandidos((atual) => (atual.has(unicoConsultorVisivel) ? atual : new Set(atual).add(unicoConsultorVisivel)));
  }, [unicoConsultorVisivel]);

  function toggleExpandirConsultor(codfor: number) {
    setConsultoresExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(codfor)) proximo.delete(codfor);
      else proximo.add(codfor);
      return proximo;
    });
  }

  // Previsão de "vai dar erro ao confirmar" — mesmo ícone/tom do Cronograma
  // (IconeIntegracaoErp), com duração inválida entrando ANTES do status de sincronização da
  // alocação: é o aviso mais acionável (400 garantido, sem depender de nada do Senior), e o
  // texto é o MESMO que confirmarSessao devolve hoje ao recusar (routes/apontamentos.ts).
  function toneSincSessao(s: SessaoPendente): Tone {
    return s.duracaoInvalida ? "destructive" : s.integracaoErpTone;
  }
  function tituloSincSessao(s: SessaoPendente): string {
    if (s.duracaoInvalida) {
      return "Vai falhar ao confirmar: sessão dura menos de 1 minuto — o Senior só registra por minuto cheio. Ajuste o horário antes de confirmar.";
    }
    if (s.integracaoErpErro) return `Falha no envio da alocação ao Senior: ${s.integracaoErpErro}`;
    if (s.integracaoErpTone === "success") return "Alocação já confirmada pelo Senior.";
    return `Integração da alocação com o Senior: ${s.integracaoErpLabel}`;
  }

  // Motivo de "Pedir ajuste" estar desabilitado por bloqueio de apontamento (ver
  // domain/bloqueioApontamento.ts, backend) — texto único pra não divergir entre a linha
  // plana e a agrupada. "Confirmar" NÃO usa mais isto (03/09/2026): confirmar uma sessão
  // preexistente segue liberado mesmo com o bloqueio ligado, só "pedir ajuste" (que abre uma
  // solicitação NOVA) continua recusado.
  const MOTIVO_BLOQUEIO_APONTAMENTO = "Apontamento bloqueado nesta atividade/proposta pelo gestor.";

  // Linha de uma sessão pendente na lista plana (consultor comum, sem acordeon) — mesmas
  // colunas responsivas do <thead> de fora.
  function renderLinhaSessao(s: SessaoPendente) {
    return (
      // Faixa âmbar à esquerda quando há ajuste aguardando o gestor: a linha está congelada
      // até a decisão, e sem marca isso não se vê.
      <tr
        key={s.id}
        className={`border-t border-border/60 ${s.ajustePendente ? "border-l-2 border-l-warning bg-warning/5" : ""}`}
      >
        <td className="hidden px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">{s.id}</td>
        <td className="px-2.5 py-3.5 text-sm font-semibold text-foreground">{s.codpro}</td>
        {/* O próprio id abre a atividade — mesmo padrão da tabela de itens de RAT logo abaixo. */}
        <td className="hidden px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">
          <button
            onClick={() => abrirDetalheAtividade(s.atividadeId)}
            className="text-primary hover:underline"
            title="Abrir a atividade (somente visualização)"
          >
            {s.atividadeId}
          </button>
        </td>
        <td className="hidden max-w-[220px] truncate px-2.5 py-3.5 text-sm text-muted lg:table-cell" title={rotuloItem(s)}>
          {rotuloItem(s)}
        </td>
        <td className="hidden max-w-[200px] truncate px-2.5 py-3.5 text-sm text-muted md:table-cell" title={s.cliente ?? undefined}>
          {s.cliente ?? "—"}
          {s.codcli != null && ` (${s.codcli})`}
        </td>
        <td className="whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted">{dataCurtaFormatter.format(new Date(s.inicio))}</td>
        <td className="hidden whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">
          {formatHorario(s.inicio, s.fim)}
        </td>
        <td className="whitespace-nowrap px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
          {formatMinutos(s.duracaoMinutos)}
        </td>
        <td className="hidden px-2.5 py-3.5 lg:table-cell">
          {/* Editar é "só o dono" no servidor (PATCH /:id) — em sessão de outro consultor o
              clique abre a MESMA janela em leitura, só pra ler o texto completo sem
              depender do tooltip truncado (mesmo padrão da observação de item de RAT logo
              abaixo, ModalEditarDescricao com somenteLeitura). */}
          {s.souDono ? (
            <button
              onClick={() => setEditandoDescricaoId(s.id)}
              className={`w-full max-w-[220px] truncate rounded-md border px-2.5 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                descricoes[s.id] ?? s.observacao
                  ? "border-border text-foreground hover:bg-surface-2"
                  : "border-dashed border-border text-muted hover:bg-surface-2"
              }`}
            >
              {descricoes[s.id] ?? s.observacao ?? "+ Adicionar descrição"}
            </button>
          ) : (
            <button
              onClick={() => setEditandoDescricaoId(s.id)}
              title={s.observacao ?? undefined}
              className="block w-full max-w-[220px] truncate text-left text-sm text-muted hover:underline"
            >
              {s.observacao ?? "—"}
            </button>
          )}
        </td>
        {/* Previsão de "vai dar erro ao confirmar" — mesmo indicador visual do Cronograma
            (IconeIntegracaoErp/toneBadge), aplicado à alocação por trás da sessão + duração
            que vai truncar pra zero (ver toneSincSessao/tituloSincSessao acima). */}
        <td className="hidden px-2.5 py-3.5 text-center sm:table-cell">
          <span
            className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${toneBadge[toneSincSessao(s)]}`}
            title={tituloSincSessao(s)}
          >
            <IconeIntegracaoErp tone={toneSincSessao(s)} />
          </span>
        </td>
        {/* Mesmo agrupador "⋯" das linhas de RAT logo abaixo — duas ações soltas na coluna
            empurravam a tabela e competiam por atenção. */}
        <td className="whitespace-nowrap px-2.5 py-3.5 text-right">
          <DropdownMenu placement="bottom-end">
            <DropdownMenu.Trigger>
              <button
                className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Ações do apontamento"
              >
                ⋯
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {/* Bloqueio de apontamento não trava Confirmar: a sessão já foi trabalhada
                  ANTES do bloqueio ligar (mover card, Start/Stop, ou solicitação avulsa já
                  aprovada) — o backend só recusa por bloqueio quando a sessão nasce agora
                  (lançamento manual do gestor), não ao confirmar uma que já existe (03/09/2026,
                  ver confirmarSessao/origemSessao em routes/apontamentos.ts). */}
              <DropdownMenu.Item onSelect={() => confirmar(s.id)} disabled={confirmando === s.id}>
                {confirmando === s.id ? "Confirmando..." : "Confirmar"}
              </DropdownMenu.Item>
              {/* Pedir ajuste e Excluir são "só o dono" nos respectivos endpoints
                  (solicitacoesAjuste.ts / DELETE /:id) — em sessão de outro consultor o
                  servidor recusaria com 403/404, então a tela nem oferece. Confirmar acima
                  não tem essa restrição (podeExecutarAcao já libera admin). */}
              {s.souDono && (
                <>
                  {/* Confirmar não deixa mexer no horário — só manda a sessão como o
                      rastreamento gravou. Quem precisa de outro intervalo pede aqui, antes de
                      confirmar. Bloqueio só impede pedir um NOVO ajuste — ver um já pendente
                      continua aberto (é o mesmo raciocínio de "reprovar sempre livre"). */}
                  <DropdownMenu.Item
                    onSelect={() =>
                      abrirPedidoAjuste(
                        s.id,
                        `Proposta ${s.codpro} · ${formatHorario(s.inicio, s.fim)}`,
                        s.inicio,
                        s.fim,
                        s.ajustePendente
                      )
                    }
                    disabled={s.bloqueadoApontamentoEfetivo && !s.ajustePendente}
                    title={s.bloqueadoApontamentoEfetivo && !s.ajustePendente ? MOTIVO_BLOQUEIO_APONTAMENTO : undefined}
                  >
                    {s.ajustePendente ? "Ver ajuste pendente" : "Pedir ajuste de horário"}
                  </DropdownMenu.Item>
                  {/* Antes daqui não havia como apagar uma sessão rastreada errada — só
                      restava confirmar e desfazer depois. */}
                  <DropdownMenu.Item onSelect={() => excluirSessao(s.id)} disabled={excluindoSessao === s.id} destructive>
                    {excluindoSessao === s.id ? "Excluindo..." : "Excluir"}
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        </td>
      </tr>
    );
  }

  // Linha de sessão dentro do acordeon por consultor — sub-tabela numa única célula
  // (colSpan cheio, borda fechando os 4 lados nela), mesmo padrão visual e de código da
  // tabela de itens aninhada no detalhe de uma RAT logo abaixo (compacta, sem esconder
  // coluna por breakpoint: já é uma sub-tabela dentro de uma célula só, não precisa
  // acompanhar o <thead> responsivo da tabela de fora).
  function renderLinhaSessaoAgrupada(s: SessaoPendente) {
    return (
      <tr key={s.id} className={`border-t border-border/40 ${s.ajustePendente ? "border-l-2 border-l-warning bg-warning/5" : ""}`}>
        <td className="py-1.5 pr-3 font-mono text-[12.5px] text-muted">{s.id}</td>
        <td className="py-1.5 pr-3 text-[12.5px] font-semibold text-foreground">{s.codpro}</td>
        <td className="py-1.5 pr-3 font-mono text-[12.5px] text-muted">
          <button
            onClick={() => abrirDetalheAtividade(s.atividadeId)}
            className="text-primary hover:underline"
            title="Abrir a atividade (somente visualização)"
          >
            {s.atividadeId}
          </button>
        </td>
        <td className="max-w-[220px] truncate py-1.5 pr-3 text-[12.5px] text-muted" title={rotuloItem(s)}>
          {rotuloItem(s)}
        </td>
        <td className="max-w-[200px] truncate py-1.5 pr-3 text-[12.5px] text-muted" title={s.cliente ?? undefined}>
          {s.cliente ?? "—"}
          {s.codcli != null && ` (${s.codcli})`}
        </td>
        <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[12.5px] text-muted">
          {dataCurtaFormatter.format(new Date(s.inicio))}
        </td>
        <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[12.5px] text-muted">{formatHorario(s.inicio, s.fim)}</td>
        <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-[12.5px] tabular-nums text-foreground">
          {formatMinutos(s.duracaoMinutos)}
        </td>
        <td className="max-w-[320px] py-1.5 pr-3">
          {s.souDono ? (
            <button
              onClick={() => setEditandoDescricaoId(s.id)}
              className={`block w-full truncate text-left text-[12.5px] hover:underline ${
                descricoes[s.id] ?? s.observacao ? "text-foreground" : "font-medium text-warning"
              }`}
            >
              {descricoes[s.id] ?? s.observacao ?? "Sem descrição — clique para preencher"}
            </button>
          ) : (
            <button
              onClick={() => setEditandoDescricaoId(s.id)}
              title={s.observacao ?? undefined}
              className="block w-full truncate text-left text-[12.5px] text-muted hover:underline"
            >
              {s.observacao ?? "—"}
            </button>
          )}
        </td>
        <td className="py-1.5 pr-3 text-center">
          <span
            className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${toneBadge[toneSincSessao(s)]}`}
            title={tituloSincSessao(s)}
          >
            <IconeIntegracaoErp tone={toneSincSessao(s)} />
          </span>
        </td>
        <td className="py-1.5 text-right">
          <DropdownMenu placement="bottom-end">
            <DropdownMenu.Trigger>
              <button
                className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Ações do apontamento"
              >
                ⋯
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {/* Bloqueio de apontamento não trava Confirmar: a sessão já foi trabalhada
                  ANTES do bloqueio ligar (mover card, Start/Stop, ou solicitação avulsa já
                  aprovada) — o backend só recusa por bloqueio quando a sessão nasce agora
                  (lançamento manual do gestor), não ao confirmar uma que já existe (03/09/2026,
                  ver confirmarSessao/origemSessao em routes/apontamentos.ts). */}
              <DropdownMenu.Item onSelect={() => confirmar(s.id)} disabled={confirmando === s.id}>
                {confirmando === s.id ? "Confirmando..." : "Confirmar"}
              </DropdownMenu.Item>
              {s.souDono && (
                <>
                  <DropdownMenu.Item
                    onSelect={() =>
                      abrirPedidoAjuste(
                        s.id,
                        `Proposta ${s.codpro} · ${formatHorario(s.inicio, s.fim)}`,
                        s.inicio,
                        s.fim,
                        s.ajustePendente
                      )
                    }
                    disabled={s.bloqueadoApontamentoEfetivo && !s.ajustePendente}
                    title={s.bloqueadoApontamentoEfetivo && !s.ajustePendente ? MOTIVO_BLOQUEIO_APONTAMENTO : undefined}
                  >
                    {s.ajustePendente ? "Ver ajuste pendente" : "Pedir ajuste de horário"}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => excluirSessao(s.id)} disabled={excluindoSessao === s.id} destructive>
                    {excluindoSessao === s.id ? "Excluindo..." : "Excluir"}
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        </td>
      </tr>
    );
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Meus Apontamentos
      </p>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Meus Apontamentos</h1>
          <p className="mt-1 text-sm text-muted">
            Revise o tempo rastreado nas atividades e confirme pra virar apontamento oficial.
          </p>
        </div>
        {/* Restrito a gestor de departamento e admin (o servidor decide e também recusa o
            POST) — consultor comum aponta pelo quadro, que gera sessão rastreada. */}
        {podeLancarManual && (
          <button
            onClick={() => setModalManual(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + Apontamento manual
          </button>
        )}
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {avisoSinc && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-foreground">
          <span>{avisoSinc}</span>
          <button onClick={() => setAvisoSinc(null)} className="flex-none text-[11px] text-muted hover:text-foreground">
            fechar
          </button>
        </div>
      )}

      <div className="space-y-8">
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
              Sessões pendentes de confirmação{" "}
              {sessoesFiltradas.length > 0 &&
                (sessoesFiltradas.length === sessoes.length ? `(${sessoes.length})` : `(${sessoesFiltradas.length} de ${sessoes.length})`)}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {/* Período (AtividadeSessaoExecucao.inicio) — diferente da busca/consultor
                  abaixo, vale pra qualquer usuário, mesmo consultor comum vendo só as
                  próprias sessões. */}
              <div className="flex items-center gap-1.5">
                <label htmlFor="filtro-sessoes-data-inicio" className="text-[12.5px] text-muted">
                  De
                </label>
                <input
                  id="filtro-sessoes-data-inicio"
                  type="date"
                  value={dataInicioFiltro}
                  onChange={(e) => setDataInicioFiltro(e.target.value)}
                  className={selectClass}
                />
                <label htmlFor="filtro-sessoes-data-fim" className="text-[12.5px] text-muted">
                  até
                </label>
                <input
                  id="filtro-sessoes-data-fim"
                  type="date"
                  value={dataFimFiltro}
                  onChange={(e) => setDataFimFiltro(e.target.value)}
                  className={selectClass}
                />
              </div>
              {/* Admin ou gestor com time (mostrarConsultor) — pro consultor comum a lista já é só ele, filtro não ajudaria em nada. */}
              {mostrarConsultor && (
                <>
                  <input
                    type="text"
                    placeholder="Buscar cliente ou proposta..."
                    value={buscaSessoesInput}
                    onChange={(e) => setBuscaSessoesInput(e.target.value)}
                    className={`${selectClass} w-64`}
                  />
                  {opcoesFiltroSessoes.length > 1 && (
                    <MultiSelectDropdown
                      opcoes={opcoesFiltroSessoes.map((c) => ({ value: c.codfor, label: `${c.codfor} - ${c.nome}` }))}
                      selecionados={codforsFiltroSessoes}
                      onChange={setCodforsFiltroSessoes}
                      labelTodos="Todos os consultores"
                      labelSufixo="consultores"
                    />
                  )}
                </>
              )}
              {/* Escopo é o que está NA TELA (sessoesFiltradas) — filtrar por um consultor
                  e clicar aqui confirma só as dele, e o número sempre bate com a lista
                  visível. O resumo por RAT (modal abaixo) é o que deixa o encapsulamento
                  conferível antes de disparar de verdade. */}
              {sessoesFiltradas.length > 0 && (
                <button
                  onClick={abrirResumoLote}
                  className="rounded-md border border-primary/40 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
                >
                  Confirmar Todos ({sessoesFiltradas.length})
                </button>
              )}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      ID
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Proposta
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Id Ativ.
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                      Item
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                      Cliente
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Data
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Horário
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Duração
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                      Descrição
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Sinc. ERP
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loading &&
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="hidden px-2.5 py-3.5 sm:table-cell">
                          <Skeleton className="h-4 w-8" />
                        </td>
                        <td className="px-2.5 py-3.5">
                          <Skeleton className="h-4 w-16" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 sm:table-cell">
                          <Skeleton className="h-4 w-8" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 lg:table-cell">
                          <Skeleton className="h-4 w-28" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 md:table-cell">
                          <Skeleton className="h-4 w-28" />
                        </td>
                        <td className="px-2.5 py-3.5">
                          <Skeleton className="h-4 w-24" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 sm:table-cell">
                          <Skeleton className="h-4 w-24" />
                        </td>
                        <td className="px-2.5 py-3.5 text-right">
                          <Skeleton className="ml-auto h-4 w-12" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 lg:table-cell">
                          <Skeleton className="h-7 w-full" />
                        </td>
                        <td className="hidden px-2.5 py-3.5 text-center sm:table-cell">
                          <Skeleton className="mx-auto h-4 w-4 rounded-full" />
                        </td>
                        <td className="px-2.5 py-3.5 text-right">
                          <Skeleton className="ml-auto h-7 w-20 rounded" />
                        </td>
                      </tr>
                    ))}
                  {/* mostrarConsultor (admin/gestor vendo o time): agrupa em acordeon por
                      consultor em vez de repetir o nome numa coluna à parte. */}
                  {!loading &&
                    mostrarConsultor &&
                    gruposPorConsultor.map((grupo) => {
                      const expandido = consultoresExpandidos.has(grupo.codfor);
                      return (
                        <Fragment key={grupo.codfor}>
                          <tr
                            onClick={() => toggleExpandirConsultor(grupo.codfor)}
                            className={`cursor-pointer transition ${
                              expandido ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                            }`}
                          >
                            <td colSpan={11} className={`px-2.5 py-2.5 ${expandido ? "border-l border-r border-primary" : ""}`}>
                              <p className="flex items-center justify-between gap-2 text-sm">
                                <span className="flex items-center gap-2 font-semibold text-foreground">
                                  <span className="text-muted">{expandido ? "▾" : "▸"}</span>
                                  {grupo.consultorNome}
                                </span>
                                <span className="font-mono text-[12.5px] tabular-nums text-muted">
                                  {grupo.sessoes.length} apont. · {formatMinutos(grupo.totalMinutos)}
                                </span>
                              </p>
                            </td>
                          </tr>
                          {/* Mesmo padrão do detalhe de uma RAT logo abaixo: os apontamentos do
                              consultor moram dentro de UMA célula de colSpan cheio — é essa célula
                              que fecha as 4 bordas do acordeon, não cada linha. */}
                          {expandido && (
                            <tr className="border-t border-border/60 bg-surface-2/40">
                              <td colSpan={11} className="border-b border-l border-r border-primary px-2.5 py-3">
                                <table className="w-full border-collapse">
                                  <thead>
                                    <tr>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        ID
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Proposta
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Id Ativ.
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Item
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Cliente
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Data
                                      </th>
                                      <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Horário
                                      </th>
                                      <th className="py-1.5 pr-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Duração
                                      </th>
                                      <th className="w-2/5 py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Descrição
                                      </th>
                                      <th className="py-1.5 pr-3 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                        Sinc. ERP
                                      </th>
                                      <th className="py-1.5" />
                                    </tr>
                                  </thead>
                                  <tbody>{grupo.sessoes.map((s) => renderLinhaSessaoAgrupada(s))}</tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  {!loading && !mostrarConsultor && sessoesFiltradas.map((s) => renderLinhaSessao(s))}
                  {!loading && sessoesFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-2.5 py-8 text-center text-sm text-muted">
                        {sessoes.length === 0
                          ? 'Nenhuma sessão pendente — mova um card pra "Em Andamento" pra começar a rastrear tempo.'
                          : "Nenhuma sessão encontrada com os filtros atuais."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">RATs</p>
              <input
                type="text"
                placeholder="Buscar cliente, proposta ou nº da RAT..."
                value={buscaInput}
                onChange={(e) => setBuscaInput(e.target.value)}
                className={`${selectClass} w-64`}
              />
              <input
                type="text"
                placeholder="Buscar na observação dos itens..."
                value={buscaItemInput}
                onChange={(e) => setBuscaItemInput(e.target.value)}
                className={`${selectClass} w-64`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {situacoesRat.length > 1 && (
                <MultiSelectDropdown
                  opcoes={situacoesRat.map((s) => ({ value: s.sitrat, label: s.label }))}
                  selecionados={sitratFiltro}
                  onChange={onMudarFiltroSitrat}
                  labelTodos="Todas as situações"
                  labelSufixo="situações"
                />
              )}
              <MultiSelectDropdown
                opcoes={OPCOES_INTEGRACAO}
                selecionados={integracaoFiltro}
                onChange={onMudarFiltroIntegracao}
                labelTodos="Todas as sincronizações"
                labelSufixo="sincronizações"
              />
              {opcoesFiltro.length > 1 && (
                <MultiSelectDropdown
                  opcoes={opcoesFiltro.map((c) => ({ value: c.codfor, label: `${c.codfor} - ${c.nome}` }))}
                  selecionados={codforsFiltro}
                  onChange={onMudarFiltroConsultor}
                  labelTodos="Todos os consultores"
                  labelSufixo="consultores"
                />
              )}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      ID
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      RAT
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Proposta
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Cliente
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Consultor
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                      Emissão
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Situação
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Sinc. ERP
                    </th>
                    <th className="hidden bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                      Itens
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                      Total
                    </th>
                    <th className="bg-surface-2 px-2.5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loadingRats &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-2.5 py-3.5" colSpan={11}>
                          <Skeleton className="h-6 w-full" />
                        </td>
                      </tr>
                    ))}
                  {!loadingRats &&
                    rats.map((rat) => {
                      const expandida = ratsExpandidas.has(rat.id);
                      const itens = itensPorRat[rat.id];
                      return (
                        <Fragment key={rat.id}>
                          <tr
                            onClick={() => toggleExpandirRat(rat)}
                            className={`cursor-pointer transition ${
                              expandida ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                            }`}
                          >
                            <td className={`px-2.5 py-3.5 ${expandida ? "border-l border-primary" : ""}`}>
                              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <span className="text-muted">{expandida ? "▾" : "▸"}</span>
                                {rat.id}
                              </p>
                            </td>
                            <td className="whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted">{rat.numrat ?? "—"}</td>
                            <td className="px-2.5 py-3.5 text-sm text-foreground">
                              {rat.codpro != null ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/projetos/proposta/${rat.codemp}/${rat.codpro}`);
                                  }}
                                  className="text-primary hover:underline"
                                >
                                  {rat.codpro}
                                </button>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="max-w-[220px] truncate px-2.5 py-3.5 text-sm text-muted" title={rat.cliente ?? undefined}>
                              {rat.cliente ?? "—"}
                            </td>
                            <td className="px-2.5 py-3.5 text-sm text-muted">{rat.consultorNome}</td>
                            <td className="hidden whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted md:table-cell">
                              {rat.datemi ? dateFormatter.format(new Date(rat.datemi)) : "—"}
                            </td>
                            <td className="px-2.5 py-3.5">
                              <span className={`inline-block rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium ${toneBadge[rat.sitratTone]}`}>
                                {rat.sitratLabel}
                              </span>
                            </td>
                            <td className="px-2.5 py-3.5">
                              <span className={`inline-block rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium ${toneBadge[rat.integracaoTone]}`}>
                                {rat.integracaoLabel}
                              </span>
                            </td>
                            <td className="hidden px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-muted sm:table-cell">
                              {rat.totalItens}
                            </td>
                            <td className="whitespace-nowrap px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
                              {formatMinutos(rat.totalMinutos)}
                            </td>
                            <td className={`px-2.5 py-3.5 text-right ${expandida ? "border-r border-primary" : ""}`}>
                              <DropdownMenu placement="bottom-end">
                                <DropdownMenu.Trigger>
                                  <button
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label="Ações"
                                  >
                                    ⋯
                                  </button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Content>
                                  <DropdownMenu.Item
                                    onSelect={() => sincronizarErp(rat)}
                                    disabled={rat.integracao === "sincronizado" || sincronizando === rat.id}
                                    title={
                                      rat.integracao === "sincronizado"
                                        ? "Já sincronizada — nada pendente ou com erro"
                                        : "Busca o que mudou no ERP e reenvia os itens pendentes/com erro"
                                    }
                                  >
                                    {sincronizando === rat.id ? "Sincronizando..." : "Sinc. ERP"}
                                  </DropdownMenu.Item>
                                  {podeGerenciarDespesas && (
                                    <DropdownMenu.Item
                                      onSelect={() => setDespesasRat(rat)}
                                      disabled={rat.numrat == null}
                                      title={rat.numrat == null ? "Só disponível depois que a RAT tem número do ERP" : undefined}
                                    >
                                      Despesas de Viagem
                                    </DropdownMenu.Item>
                                  )}
                                </DropdownMenu.Content>
                              </DropdownMenu>
                            </td>
                          </tr>
                          {expandida && (
                            <tr className="border-t border-border/60 bg-surface-2/40">
                              <td colSpan={11} className="border-b border-l border-r border-primary px-2.5 py-3">
                                {itens === "carregando" && <p className="py-2 text-sm text-muted">Carregando itens...</p>}
                                {itens === "erro" && <p className="py-2 text-sm text-destructive">Falha ao carregar os itens desta RAT.</p>}
                                {Array.isArray(itens) && itens.length === 0 && (
                                  <p className="py-2 text-sm text-muted">Nenhum item nesta RAT.</p>
                                )}
                                {Array.isArray(itens) && itens.length > 0 && (
                                  <table className="w-full border-collapse">
                                    <thead>
                                      <tr>
                                        <th className="py-1.5 pr-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Id. Ativ.
                                        </th>
                                        <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Serviço
                                        </th>
                                        <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Item
                                        </th>
                                        <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Data
                                        </th>
                                        <th className="py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Horário
                                        </th>
                                        <th className="py-1.5 pr-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Duração
                                        </th>
                                        <th className="w-2/5 py-1.5 pr-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Observação
                                        </th>
                                        <th className="py-1.5" />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {itens.map((item) => (
                                        <tr key={item.id} className="border-t border-border/40">
                                          <td className="py-1.5 pr-3 text-right font-mono text-[12.5px] tabular-nums">
                                            {item.atividadeId != null ? (
                                              <button
                                                onClick={() => abrirDetalheAtividade(item.atividadeId!)}
                                                className="text-primary hover:underline"
                                                title="Abrir a atividade (somente visualização)"
                                              >
                                                {item.atividadeId}
                                              </button>
                                            ) : (
                                              <span className="text-muted">—</span>
                                            )}
                                          </td>
                                          <td className="py-1.5 pr-3 font-mono text-[12.5px] text-muted">{item.codser ?? "—"}</td>
                                          <td
                                            className="max-w-[260px] truncate py-1.5 pr-3 text-[12.5px] text-muted"
                                            title={rotuloItem(item)}
                                          >
                                            {rotuloItem(item)}
                                          </td>
                                          <td className="py-1.5 pr-3 font-mono text-[12.5px] tabular-nums text-muted">
                                            {item.datati ? dateFormatter.format(new Date(item.datati)) : "—"}
                                          </td>
                                          <td className="py-1.5 pr-3 font-mono text-[12.5px] tabular-nums text-muted">
                                            {item.horini != null && item.horfim != null
                                              ? `${formatHoraDoDia(item.horini)}–${formatHoraDoDia(item.horfim)}`
                                              : "—"}
                                          </td>
                                          <td className="py-1.5 pr-3 text-right font-mono text-[12.5px] tabular-nums text-foreground">
                                            {item.duracaoMinutos != null ? formatMinutos(item.duracaoMinutos) : "—"}
                                          </td>
                                          {/* Observação é o que trava a aprovação da RAT (todo item precisa ter) e
                                              vai no desAti do Senior — por isso ela mesma é o clique, em vez de
                                              mais uma ação na coluna da direita. Editável abre pra editar; já
                                              registrado no ERP abre a MESMA janela em leitura, que é onde se lê o
                                              texto completo sem depender do tooltip. */}
                                          <td className="max-w-[320px] py-1.5 pr-3">
                                            <button
                                              onClick={() =>
                                                setEditandoObservacao({
                                                  item,
                                                  ratId: rat.id,
                                                  somenteLeitura: !podeEditarObservacao(item),
                                                })
                                              }
                                              title={item.desati?.trim() || "Sem observação"}
                                              className={`block w-full truncate text-left text-[12.5px] hover:underline ${
                                                item.desati?.trim() ? "text-foreground" : "font-medium text-warning"
                                              }`}
                                            >
                                              {item.desati?.trim() ||
                                                (podeEditarObservacao(item) ? "Sem observação — clique para preencher" : "Sem observação")}
                                            </button>
                                          </td>
                                          <td className="py-1.5 text-right">
                                            <AcaoIntegracao
                                              item={item}
                                              reenviando={reenviando.has(item.id)}
                                              onReenviar={() => reenviarAoSenior(item.id, rat.id)}
                                              onExcluir={() => excluirApontamento(item.sessaoId!, rat.id)}
                                              onVerErro={() => setErroEnvioItem(item)}
                                            />
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  {!loadingRats && rats.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-2.5 py-8 text-center text-sm text-muted">
                        Nenhuma RAT ainda — confirme uma sessão pendente pra começar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pageRats}
              pageSize={PAGE_SIZE_RATS}
              total={totalRats}
              loading={loadingRats}
              onPageChange={setPageRats}
              label="RATs"
            />
          </div>
        </section>
      </div>

      {editandoDescricaoId != null &&
        (() => {
          const sessao = sessoes.find((s) => s.id === editandoDescricaoId);
          if (!sessao) return null;
          return (
            <ModalEditarDescricao
              somenteLeitura={!sessao.souDono}
              titulo={`Proposta ${sessao.codpro}`}
              valorInicial={descricoes[sessao.id] ?? sessao.observacao ?? ""}
              onSalvar={(texto) => salvarDescricaoSessaoPendente(sessao.id, texto)}
              onFechar={() => setEditandoDescricaoId(null)}
            />
          );
        })()}

      {/* Edição da observação de um item JÁ confirmado (dentro da RAT) — mesmo PATCH do modal
          acima (que edita a sessão ainda não confirmada); o backend decide onde grava
          (RatItem.desati ou AtividadeSessaoExecucao.observacao) conforme o estado da sessão. */}
      {editandoObservacao && (
        <ModalEditarDescricao
          somenteLeitura={editandoObservacao.somenteLeitura}
          titulo={`Apontamento de ${
            editandoObservacao.item.datati ? dateFormatter.format(new Date(editandoObservacao.item.datati)) : "—"
          }`}
          valorInicial={editandoObservacao.item.desati ?? ""}
          onSalvar={(texto) =>
            salvarObservacaoItem(editandoObservacao.item.sessaoId!, editandoObservacao.ratId, texto)
          }
          onFechar={() => setEditandoObservacao(null)}
        />
      )}

      {/* Erro completo de "falha no envio" — mesmo modal da observação, só leitura, só
          trocando o título e o texto mostrado (o erro do Senior, não a observação do item). */}
      {erroEnvioItem && (
        <ModalEditarDescricao
          somenteLeitura
          tituloSomenteLeitura="Falha no envio ao Senior"
          titulo={`Apontamento de ${
            erroEnvioItem.datati ? dateFormatter.format(new Date(erroEnvioItem.datati)) : "—"
          }`}
          valorInicial={erroEnvioItem.envioErro ?? ""}
          onSalvar={() => {}}
          onFechar={() => setErroEnvioItem(null)}
        />
      )}

      {/* Resumo antes de confirmar em lote — agrupado pela MESMA chave (consultor+proposta)
          que o servidor usa pra encapsular na RAT, pra deixar visível que nada vai se
          misturar antes de disparar de verdade. Não fecha por fora: some ação em andamento
          ou resultado com falha que não pode sumir num clique sem querer. */}
      {resumoLote && (
        <Modal
          open
          onClose={() => !confirmandoLote && setResumoLote(null)}
          fecharPorFora={false}
          title="Confirmar apontamentos em lote"
          subtitulo={`${resumoLote.reduce((soma, g) => soma + g.sessaoIds.length, 0)} sessões · ${resumoLote.length} RAT${resumoLote.length === 1 ? "" : "s"}`}
        >
          <div className="space-y-4 p-4">
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border bg-surface-2/40 p-3">
              {resumoLote.map((g) => (
                <div key={g.chave} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-foreground">
                    Proposta {g.codpro} · {g.consultorNome ?? "eu"}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
                    {g.sessaoIds.length} apont. · {formatMinutos(g.minutos)}
                  </span>
                </div>
              ))}
            </div>

            {resultadoLote && resultadoLote.falhas.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p className="mb-1 font-medium">
                  {resultadoLote.confirmados} confirmado{resultadoLote.confirmados === 1 ? "" : "s"}, {resultadoLote.falhas.length}{" "}
                  falhou{resultadoLote.falhas.length === 1 ? "" : "aram"}:
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {resultadoLote.falhas.map((f) => (
                    <li key={f.sessaoId}>
                      Sessão {f.sessaoId}: {f.erro}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setResumoLote(null)}
                disabled={confirmandoLote}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
              >
                {resultadoLote ? "Fechar" : "Cancelar"}
              </button>
              {!resultadoLote && (
                <button
                  onClick={confirmarTodos}
                  disabled={confirmandoLote}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {confirmandoLote && <Spinner className="h-3.5 w-3.5" />}
                  Confirmar {resumoLote.reduce((soma, g) => soma + g.sessaoIds.length, 0)} apontamentos
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {despesasRat && (
        <ModalDespesasRat
          ratId={despesasRat.id}
          ratLabel={`RAT ${despesasRat.numrat ?? despesasRat.id} · ${despesasRat.cliente ?? "—"}`}
          onFechar={() => setDespesasRat(null)}
        />
      )}

      {/* Pedido de correção de horário. Não fecha por clique fora nem por Esc — tem texto
          digitado dentro, mesma razão do modal de parada. */}
      {pedidoAjuste && (
        <Modal
          open
          onClose={() => setPedidoAjuste(null)}
          fecharPorFora={false}
          title={pedidoAjuste.pendente ? "Ajuste aguardando o gestor" : "Pedir ajuste de horário"}
          subtitulo={pedidoAjuste.titulo}
        >
          <div className="space-y-3 p-4">
            {pedidoAjuste.pendente ? (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[12.5px] text-warning">
                Pedido enviado em {dataCurtaFormatter.format(new Date(pedidoAjuste.pendente.criadoEm))} às {horaCurtaFormatter.format(new Date(pedidoAjuste.pendente.criadoEm))}, aguardando decisão. O
                envio ao Senior está retido até lá. Para mudar o horário pedido, o gestor precisa decidir este pedido antes.
              </p>
            ) : (
              <p className="text-[12.5px] text-muted">
                O envio deste apontamento ao Senior fica retido até o gestor decidir — o ERP só recebe o horário final.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="aj-data" className="text-[12px] text-muted">
                Data
              </label>
              <input
                id="aj-data"
                type="date"
                value={ajusteData}
                onChange={(e) => setAjusteData(e.target.value)}
                disabled={pedidoAjuste.pendente != null}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <label htmlFor="aj-ini" className="text-[12px] text-muted">
                das
              </label>
              <input
                id="aj-ini"
                type="time"
                value={ajusteInicio}
                onChange={(e) => setAjusteInicio(e.target.value)}
                disabled={pedidoAjuste.pendente != null}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <label htmlFor="aj-fim" className="text-[12px] text-muted">
                às
              </label>
              <input
                id="aj-fim"
                type="time"
                value={ajusteFim}
                onChange={(e) => setAjusteFim(e.target.value)}
                disabled={pedidoAjuste.pendente != null}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <textarea
              value={ajusteMotivo}
              onChange={(e) => setAjusteMotivo(e.target.value)}
              disabled={pedidoAjuste.pendente != null}
              rows={3}
              placeholder="Motivo da correção — é o que o gestor lê pra decidir"
              className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {erroAjuste && <p className="text-[12px] text-destructive">{erroAjuste}</p>}
            {/* Com pedido pendente não há o que enviar — só fechar. Mostrar um botão que o
                servidor recusaria seria prometer uma ação que não existe. */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPedidoAjuste(null)}
                disabled={enviandoAjuste}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
              >
                {pedidoAjuste.pendente ? "Fechar" : "Cancelar"}
              </button>
              {!pedidoAjuste.pendente && (
                <button
                  onClick={enviarPedidoAjuste}
                  disabled={enviandoAjuste}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {enviandoAjuste ? "Enviando..." : "Enviar para o gestor"}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Mesmo painel que abre ao clicar no card do quadro, em modo leitura: todas as ações
          de escrita do AtividadeDetalhe (planejamento, checklist, anexos, comentários) são
          governadas por `podeEditar`, então false basta pra virar só visualização. */}
      {detalheAtividade && (
        <AtividadeDetalhe
          atividadeId={detalheAtividade.id}
          titulo={`Proposta ${detalheAtividade.codpro} · Projeto ${detalheAtividade.numprj ?? "—"}`}
          podeEditar={false}
          dataPrevistaInicio={detalheAtividade.dataPrevistaInicio}
          dataPrevistaFim={detalheAtividade.dataPrevistaFim}
          codemp={detalheAtividade.codemp}
          codpro={detalheAtividade.codpro}
          itemDescricao={detalheAtividade.itemDescricao}
          itemQtdhor={detalheAtividade.itemQtdhor}
          itemAlocado={detalheAtividade.itemAlocado}
          itemRealizado={detalheAtividade.itemRealizado}
          estruturaNome={detalheAtividade.estruturaNome}
          estruturaPercentual={detalheAtividade.estruturaPercentual}
          podeVerCronograma={detalheAtividade.podeVerCronograma}
          qtdhorPrevisto={detalheAtividade.qtdhorPrevisto ?? null}
          horasExcedentes={detalheAtividade.horasExcedentes ?? 0}
          horasRealizadas={detalheAtividade.horasRealizadas}
          // Painel em modo leitura: aqui é o consultor olhando o próprio apontamento, e
          // ele nunca autoriza as próprias horas excedentes.
          podeAutorizarExcedente={false}
          souOExecutor={false}
          // Painel só-leitura: nenhuma ação de excedente/apontamento aparece aqui de
          // qualquer forma (gates acima), então o valor não afeta a tela.
          bloqueadoApontamento={false}
          bloqueadoExcedente={false}
          onClose={() => setDetalheAtividade(null)}
        />
      )}

      {modalManual && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-foreground">Apontamento manual</h2>
              <button
                onClick={() => {
                  setModalManual(false);
                  limparFormularioManual();
                }}
                className="text-sm text-muted hover:text-foreground"
              >
                Fechar
              </button>
            </div>
            {erroManual && (
              <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erroManual}
              </p>
            )}
            <div className="space-y-3">
              {/* Só aparece pra quem pode lançar por mais de uma pessoa (gestor/admin) —
                  consultor comum recebe uma lista com ele mesmo e não vê seletor nenhum. */}
              {consultoresManual.length > 1 && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted">Consultor</span>
                  <select value={manualCodfor} onChange={(e) => onMudarConsultorManual(e.target.value)} className={selectClass}>
                    <option value="">Eu mesmo</option>
                    {consultoresManual.map((c) => (
                      <option key={c.codfor} value={c.codfor}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Atividade</span>
                {/* Combobox em vez de <select>: a lista de um consultor chega a dezenas de
                    atividades, com a mesma proposta repetida em vários itens. Agrupa por
                    proposta+cliente e permite buscar — `<option>` nativo não aceita nada
                    disso. */}
                <SelectBuscavel
                  opcoes={atividades.map((a) => ({
                    value: a.id,
                    grupo: `Proposta ${a.codpro}${a.cliente ? ` · ${a.cliente}` : ""}`,
                    rotulo: rotuloItem(a),
                  }))}
                  valor={manualAtividadeId ? Number(manualAtividadeId) : null}
                  onChange={(id) => setManualAtividadeId(String(id))}
                  placeholder={carregandoAtividadesManual ? "Carregando..." : "Selecione a atividade..."}
                  textoVazio="Nenhuma atividade disponível para este consultor."
                  desabilitado={carregandoAtividadesManual}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Data</span>
                <input type="date" value={manualData} onChange={(e) => setManualData(e.target.value)} className={selectClass} />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] text-muted">Início</span>
                  <input type="time" value={manualInicio} onChange={(e) => setManualInicio(e.target.value)} className={selectClass} />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] text-muted">Fim</span>
                  <input type="time" value={manualFim} onChange={(e) => setManualFim(e.target.value)} className={selectClass} />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Descrição</span>
                <textarea
                  value={manualDescricao}
                  onChange={(e) => setManualDescricao(e.target.value)}
                  rows={2}
                  className={`${selectClass} resize-none`}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setModalManual(false);
                  limparFormularioManual();
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                onClick={salvarManual}
                disabled={salvandoManual}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {salvandoManual ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
