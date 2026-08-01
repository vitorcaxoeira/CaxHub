import axios from "axios";
import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatHoras } from "../../utils/horas";
import { Skeleton } from "../../components/ui/Skeleton";
import { Spinner } from "../../components/ui/Spinner";
import { Pagination } from "../../components/ui/Pagination";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { SelectBuscavel } from "../../components/ui/SelectBuscavel";
import { ModalEditarDescricao } from "../../components/projetos/ModalEditarDescricao";
import { AtividadeDetalhe } from "../../components/projetos/AtividadeDetalhe";
import { toneBadge, type Tone } from "../../components/ui/badges";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

interface SessaoPendente {
  id: number;
  atividadeId: number;
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
  podeAprovar: boolean;
  todosComObservacao: boolean;
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
}: {
  item: RatItemRow;
  reenviando: boolean;
  onReenviar: () => void;
  onExcluir: () => void;
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
        <span className="text-[11px] text-destructive" title={item.envioErro}>
          falha no envio
        </span>
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
  const [sessoes, setSessoes] = useState<SessaoPendente[]>([]);
  const [atividades, setAtividades] = useState<AtividadeResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [descricoes, setDescricoes] = useState<Record<number, string>>({});
  const [editandoDescricaoId, setEditandoDescricaoId] = useState<number | null>(null);

  const [rats, setRats] = useState<RatRow[]>([]);
  const [totalRats, setTotalRats] = useState(0);
  const [pageRats, setPageRats] = useState(1);
  const [loadingRats, setLoadingRats] = useState(true);
  const [opcoesFiltro, setOpcoesFiltro] = useState<ConsultorFiltro[]>([]);
  const [codforsFiltro, setCodforsFiltro] = useState<number[]>([]);
  const [buscaInput, setBuscaInput] = useState("");
  const buscaDebounced = useDebouncedValue(buscaInput, 350);
  const [ratsExpandidas, setRatsExpandidas] = useState<Set<number>>(new Set());
  const [itensPorRat, setItensPorRat] = useState<Record<number, RatItemRow[] | "carregando" | "erro">>({});
  const [aprovando, setAprovando] = useState<number | null>(null);
  const [sincronizando, setSincronizando] = useState<number | null>(null);

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
          busca: buscaDebounced || undefined,
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
      .then(({ data }) => setOpcoesFiltro(data.consultores))
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
  }, [codforsFiltro, buscaDebounced, pageRats]);

  // Digitar reseta pra página 1 (senão a busca poderia "sumir" numa página que não
  // existe mais no resultado filtrado) — só dispara depois do debounce, pra não
  // recarregar a cada tecla.
  useEffect(() => {
    setPageRats(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced]);

  function onMudarFiltroConsultor(codfors: number[]) {
    setCodforsFiltro(codfors);
    // Volta pra página 1: o resultado filtrado pode ter menos páginas que o atual, e a
    // lista "sumiria" numa página que não existe mais.
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

  async function aprovar(rat: RatRow) {
    setAprovando(rat.id);
    try {
      await axios.patch(`/api/rats/${rat.id}/aprovar`);
      carregarRats();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao aprovar RAT");
    } finally {
      setAprovando(null);
    }
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

  // Observação (RatItem.desati) de um item já confirmado. É o campo que a aprovação da RAT
  // exige em todos os itens e que vai no desAti do Senior, então precisa ser preenchível
  // depois do fato — o backend só permite enquanto o item não foi registrado no ERP.
  async function salvarObservacaoItem(sessaoId: number, ratId: number, texto: string) {
    try {
      await axios.patch(`/api/apontamentos/${sessaoId}`, { desati: texto });
      setEditandoObservacao(null);
      const { data } = await axios.get(`/api/rats/${ratId}/itens`);
      setItensPorRat((i) => ({ ...i, [ratId]: data.itens }));
      // A RAT só pode ser aprovada quando todo item tem observação, e esse gate é
      // calculado no backend — recarregar a lista atualiza o "Aprovar" do menu.
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
      // Apontamento apagado no Senior perde o vínculo aqui e volta a poder ser enviado —
      // isso precisa ser dito, senão o item muda de estado sem explicação nenhuma.
      if (data?.desvinculados > 0) {
        const seqrats = (data.seqratsDesvinculados ?? []).join(", ");
        setAvisoSinc(
          `${data.desvinculados} apontamento(s) não existem mais no Senior (sequência ${seqrats}) — ` +
            `o vínculo foi removido e eles podem ser enviados de novo pela ação "Enviar".`
        );
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
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">
            Sessões pendentes de confirmação {sessoes.length > 0 && `(${sessoes.length})`}
          </p>
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
                        <td className="px-2.5 py-3.5 text-right">
                          <Skeleton className="ml-auto h-7 w-20 rounded" />
                        </td>
                      </tr>
                    ))}
                  {!loading &&
                    sessoes.map((s) => (
                      <tr key={s.id} className="border-t border-border/60">
                        <td className="hidden px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">{s.id}</td>
                        <td className="px-2.5 py-3.5 text-sm font-semibold text-foreground">{s.codpro}</td>
                        <td className="hidden px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                          {s.atividadeId}
                        </td>
                        <td
                          className="hidden max-w-[220px] truncate px-2.5 py-3.5 text-sm text-muted lg:table-cell"
                          title={rotuloItem(s)}
                        >
                          {rotuloItem(s)}
                        </td>
                        <td
                          className="hidden max-w-[200px] truncate px-2.5 py-3.5 text-sm text-muted md:table-cell"
                          title={s.cliente ?? undefined}
                        >
                          {s.cliente ?? "—"}
                          {s.codcli != null && ` (${s.codcli})`}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted">
                          {dataCurtaFormatter.format(new Date(s.inicio))}
                        </td>
                        <td className="hidden whitespace-nowrap px-2.5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                          {formatHorario(s.inicio, s.fim)}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
                          {formatMinutos(s.duracaoMinutos)}
                        </td>
                        <td className="hidden px-2.5 py-3.5 lg:table-cell">
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
                        </td>
                        <td className="px-2.5 py-3.5 text-right">
                          <button
                            onClick={() => confirmar(s.id)}
                            disabled={confirmando === s.id}
                            className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-surface-2 disabled:opacity-50"
                          >
                            {confirmando === s.id ? "Confirmando..." : "Confirmar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  {!loading && sessoes.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-2.5 py-8 text-center text-sm text-muted">
                        Nenhuma sessão pendente — mova um card pra "Em Andamento" pra começar a rastrear tempo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">RATs</p>
              <input
                type="text"
                placeholder="Buscar cliente, proposta ou nº da RAT..."
                value={buscaInput}
                onChange={(e) => setBuscaInput(e.target.value)}
                className={`${selectClass} w-64`}
              />
            </div>
            <div className="flex items-center gap-3">
              {opcoesFiltro.length > 1 && (
                <MultiSelectDropdown
                  opcoes={opcoesFiltro.map((c) => ({ value: c.codfor, label: c.nome }))}
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
                        <td className="px-2.5 py-3.5" colSpan={10}>
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
                                  {rat.podeAprovar && (
                                    <DropdownMenu.Item
                                      onSelect={() => aprovar(rat)}
                                      disabled={aprovando === rat.id || !rat.todosComObservacao}
                                      title={!rat.todosComObservacao ? "Todos os itens precisam de observação preenchida" : undefined}
                                    >
                                      {aprovando === rat.id ? "Aprovando..." : "Aprovar"}
                                    </DropdownMenu.Item>
                                  )}
                                  <DropdownMenu.Item
                                    onSelect={() => sincronizarErp(rat)}
                                    disabled={rat.numrat == null || sincronizando === rat.id}
                                    title={rat.numrat == null ? "Só disponível depois que a RAT tem número do ERP" : undefined}
                                  >
                                    {sincronizando === rat.id ? "Sincronizando..." : "Sinc. ERP"}
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu>
                            </td>
                          </tr>
                          {expandida && (
                            <tr className="border-t border-border/60 bg-surface-2/40">
                              <td colSpan={10} className="border-b border-l border-r border-primary px-2.5 py-3">
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
                      <td colSpan={10} className="px-2.5 py-8 text-center text-sm text-muted">
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
              titulo={`Proposta ${sessao.codpro}`}
              valorInicial={descricoes[sessao.id] ?? sessao.observacao ?? ""}
              onSalvar={(texto) => {
                setDescricoes((atual) => ({ ...atual, [sessao.id]: texto }));
                setEditandoDescricaoId(null);
              }}
              onFechar={() => setEditandoDescricaoId(null)}
            />
          );
        })()}

      {/* Edição da observação de um item JÁ confirmado (dentro da RAT). Diferente do modal
          acima, que edita a descrição de uma sessão ainda não confirmada e só guarda o
          texto em memória, aqui o salvar vai direto pro banco via PATCH. */}
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
          // Painel em modo leitura: aqui é o consultor olhando o próprio apontamento, e
          // ele nunca autoriza as próprias horas excedentes.
          podeAutorizarExcedente={false}
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
