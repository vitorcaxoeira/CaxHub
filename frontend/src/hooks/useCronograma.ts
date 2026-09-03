import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { NoCronograma, StatusNo } from "../lib/cronograma";
import { Tone } from "../components/ui/badges";

// Mesma tuning de acompanharEnvio em MeusApontamentos.tsx (apontamento/RAT): o envio ao
// Senior costuma levar poucos segundos; passado isso, o cron de 15 min assume e a tela
// simplesmente para de perguntar (fica no que já tinha, sem mentir um desfecho).
const ENVIO_INTERVALO_MS = 1500;
const ENVIO_MAX_TENTATIVAS = 13;

export interface PropostaCronograma {
  codemp: number;
  codpro: number;
  numprj: number;
  cliente: string;
  sitproLabel: string;
  sitproTone: "success" | "warning" | "destructive" | "neutral";
  // Criar/renomear/excluir pasta raiz e agrupar itens dentro dela — ação de nível de
  // proposta inteira, não de um item/departamento específico.
  podeGerenciarProposta: boolean;
  // Desliga o bypass "Salvar mesmo excedendo" da edição de duração (DrawerAtividade) —
  // ver PATCH /propostas/:codemp/:codpro/configuracao-alocacao.
  bloqueiaExcedenteEstrutura: boolean;
  // Bloqueio de apontamento/excedente em nível de proposta inteira — "mais restritivo
  // vence" com o campo irmão em AlocacaoResumo (a atividade pode ser mais restritiva que
  // a proposta, nunca menos). Ver domain/bloqueioApontamento.ts (backend).
  bloqueiaApontamento: boolean;
  bloqueiaExcedente: boolean;
  // Alçada pra DECIDIR as 3 flags acima (admin/gestor do Comercial/gestor da Diretoria).
  // Quem não tem, em vez de alternar o checkbox, abre um pedido de aprovação.
  podeAprovarConfiguracao: boolean;
  // Última solicitação de CADA campo, qualquer status — pendente trava o checkbox (o
  // caminho de mudar passa a ser decidir o pedido em /projetos/aprovacoes); aprovada/
  // reprovada só ilustra o desfecho da última vez que alguém pediu (indicador visual, ver
  // IconeStatusSolicitacao).
  solicitacoesConfigPorCampo: SolicitacaoConfigPorCampo[];
}

export interface SolicitacaoConfigPorCampo {
  campo: string;
  status: "pendente" | "aprovada" | "reprovada";
  valorSolicitado: boolean;
  solicitanteNome: string;
  criadoEm: string;
  decididoEm: string | null;
  decisorNome: string | null;
  observacaoDecisao: string | null;
}

// Superset de NoCronograma com os campos que a tela precisa mas os seletores puros
// (src/lib/cronograma.ts) não — período, nomes resolvidos, alocações etc. Os seletores
// continuam funcionando normalmente aqui (structural typing: campo a mais não atrapalha).
export interface NoCronogramaCompleto extends NoCronograma {
  dataPrevistaInicio: string | null;
  dataPrevistaFim: string | null;
  predecessoraNome: string | null;
  responsavelNome: string | null;
  observacao: string | null;
  horasAlocadas: number;
  saldo: number | null;
  // `duracaoHoras` do nó diverge do `qtdhor` da alocação vinculada (ver
  // backend/src/routes/alocacao.ts, mapNo) — sempre false pra pasta/item, só atividade-folha
  // com responsável carrega o sinal de verdade.
  horasDivergentes: boolean;
  // Soma de AtividadeConsultor.horasExcedentes das alocações do nó — deliberadamente fora
  // do cálculo de `saldo` acima (autoriza estourar o contratado do item, não conta contra
  // ele). 0 pra pasta/item e pra atividade sem alocação.
  horasExcedentes: number;
  // Pior caso de integração com o Senior entre as alocações do nó (label/tom já resolvidos
  // no servidor — ver integracaoErpLabel/integracaoErpTone em domain/ratDominio.ts). Null
  // pra pasta/item e pra atividade ainda sem alocação (nada pra sincronizar ainda).
  integracaoErpLabel: string | null;
  integracaoErpTone: Tone | null;
  // Texto completo do erro do Senior — só preenchido quando integracaoErpTone é
  // "destructive" (mostrado no tooltip do badge; o label genérico já cobre os outros casos).
  integracaoErpErro: string | null;
  // Item ao qual esse nó pertence — útil pra ações (criar/alocar) que dependem do
  // departamento/permissão do item, mesmo pra nós que estão vários níveis abaixo dele.
  // Null só pra pasta raiz da proposta (não pertence a nenhum item específico).
  seqite: number | null;
  podeEditarItem: boolean;
  depexe: number | null;
  depexeLabel: string | null;
  // AtividadeConsultor vinculada(s) a este nó — normalmente 1, pode ser mais de uma numa
  // tarefa compartilhada entre consultores, e nenhuma numa atividade ainda sem responsável
  // alocado. `id` é distinto de `no.id` (EstruturaAtividade, o nó da árvore em si) — é o
  // `atividadeConsultorId` que PATCH /atividades/:id/horas-excedentes e
  // /solicitacoes-excedente esperam. `seqati` null = a alocação ainda não foi confirmada
  // pelo Senior — string porque é BigInt na origem.
  alocacoesResumo: AlocacaoResumo[];
}

// Uma AtividadeConsultor, do jeito que o cronograma precisa dela — pedidos 2/3/4/5 (badge de
// integração ERP, trava de troca de consultor, teto de apontamento editável, badge de
// excedente) todos giram em cima desses mesmos campos, já mandados pelo backend em mapNo.
export interface AlocacaoResumo {
  id: number;
  codfor: number;
  consultorNome: string;
  qtdhor: number | null;
  horasExcedentes: number;
  horasRealizadas: number;
  seqati: string | null;
  podeAutorizarExcedente: boolean;
  souOExecutor: boolean;
  // Valores brutos desta alocação (pra editar no Drawer) e já combinados com a proposta
  // (pra desabilitar botão sem o frontend precisar saber a regra) — ver
  // domain/bloqueioApontamento.ts (backend).
  bloqueiaApontamento: boolean;
  bloqueiaExcedente: boolean;
  bloqueadoApontamentoEfetivo: boolean;
  bloqueadoExcedenteEfetivo: boolean;
}

interface NoApi {
  id: number;
  parentId: number | null;
  tipo: "pasta" | "atividade";
  nome: string;
  ordem: number;
  duracaoHoras: number | null;
  dataPrevistaInicio: string | null;
  dataPrevistaFim: string | null;
  predecessoraId: number | null;
  predecessoraNome: string | null;
  percentualConcluido: number | null;
  status: string | null;
  responsavelCodfor: number | null;
  responsavelNome: string | null;
  observacao: string | null;
  horasAlocadas: number;
  horasRealizadas: number;
  horasExcedentes: number;
  integracaoErpLabel: string | null;
  integracaoErpTone: Tone | null;
  // Texto completo do erro do Senior — só preenchido quando integracaoErpTone é
  // "destructive" (mostrado no tooltip do badge; o label genérico já cobre os outros casos).
  integracaoErpErro: string | null;
  saldo: number | null;
  horasDivergentes: boolean;
  alocacoes?: AlocacaoResumo[];
}

interface ItemApi {
  seqite: number;
  codser: string;
  despro: string | null;
  depexe: number | null;
  depexeLabel: string;
  qtdhorItem: number | null;
  podeEditar: boolean;
  // Pasta raiz onde este item foi agrupado, ou null se estiver solto (comportamento de
  // sempre, direto na raiz da árvore da proposta).
  parentId: number | null;
  nos: NoApi[];
}

// Pasta raiz da proposta — organizacional, fora do escopo de qualquer item; mesmo shape
// de um nó comum (NoApi), só ganha o `podeEditar` que normalmente vem do item dono.
interface PastaRaizApi extends NoApi {
  podeEditar: boolean;
}

// Id sintético do nó "item" (virtual — vem do PropostaItem, nunca é uma linha real em
// EstruturaAtividade; ver decisão registrada na etapa 2 do refactor). Usa a faixa
// negativa pra nunca colidir com um id real (sempre positivo, autoincrement).
function idVirtualItem(seqite: number): number {
  return -seqite;
}

// `null` quando o pai é o item virtual (a API não conhece esse id sintético — pra ela,
// "sem pai" já significa "raiz da árvore daquele seqite").
function parentIdReal(parentId: number | null): number | null {
  return parentId != null && parentId > 0 ? parentId : null;
}

// Campos editáveis de um nó via drawer/menu/DnD — todos opcionais, só o que for
// enviado é alterado (mesma convenção do PATCH no backend).
export interface PatchNo {
  nome?: string;
  responsavelCodfor?: number | null;
  responsavelNome?: string | null; // só pro otimismo local; a API não recebe isso
  horasPrevistas?: number | null;
  dataPrevistaInicio?: string | null;
  dataPrevistaFim?: string | null;
  predecessoraId?: number | null;
  statusManual?: Exclude<StatusNo, "bloqueada"> | null;
  observacao?: string | null;
  parentId?: number | null;
  ordem?: number;
  // Distribuição pode ser provisória — passa quando o usuário confirmou salvar mesmo
  // estourando o orçamento do item (ver DrawerAtividade/projetarSaldo); sem isso, o
  // backend rejeita a duração que ultrapassar o saldo do item.
  confirmarExcedente?: boolean;
}

export interface NovoNo {
  // Ausente = pasta raiz da proposta (só tipo "pasta" aceita isso — atividade sempre
  // pertence a um item).
  seqite?: number;
  tipo: "pasta" | "atividade";
  nome: string;
  parentId: number | null;
}

export function useCronograma(codemp: string | undefined, codpro: string | undefined) {
  const [proposta, setProposta] = useState<PropostaCronograma | null>(null);
  const [nos, setNos] = useState<NoCronogramaCompleto[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Timers do acompanhamento de envio (ver acompanharSincronizacaoAlocacao) — cancelados ao
  // sair da tela pra não bater em endpoint depois que o componente já saiu (mesmo padrão de
  // MeusApontamentos.tsx).
  const timersEnvioRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = timersEnvioRef;
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  const carregar = useCallback(() => {
    setLoading(true);
    axios
      .get(`/api/alocacao/propostas/${codemp}/${codpro}/cronograma`)
      .then(({ data }) => {
        setProposta(data.proposta);

        const todosNos: NoCronogramaCompleto[] = [];

        for (const p of data.pastasRaiz as PastaRaizApi[]) {
          todosNos.push({
            id: p.id,
            parentId: p.parentId,
            tipo: "pasta",
            nome: p.nome,
            ordem: p.ordem,
            horasPrevistas: null,
            horasRealizadas: 0,
            responsavelCodfor: null,
            predecessoraId: null,
            statusManual: null,
            dataPrevistaInicio: null,
            dataPrevistaFim: null,
            predecessoraNome: null,
            responsavelNome: null,
            observacao: null,
            horasAlocadas: 0,
            saldo: null,
            horasDivergentes: false,
            horasExcedentes: 0,
            integracaoErpLabel: null,
            integracaoErpTone: null,
            integracaoErpErro: null,
            seqite: null,
            podeEditarItem: p.podeEditar,
            depexe: null,
            depexeLabel: null,
            alocacoesResumo: [],
          });
        }

        for (const item of data.itens as ItemApi[]) {
          const itemId = idVirtualItem(item.seqite);
          todosNos.push({
            id: itemId,
            parentId: item.parentId,
            tipo: "item",
            nome: item.despro ?? item.codser,
            ordem: item.seqite,
            horasPrevistas: item.qtdhorItem,
            horasRealizadas: 0,
            responsavelCodfor: null,
            predecessoraId: null,
            statusManual: null,
            dataPrevistaInicio: null,
            dataPrevistaFim: null,
            predecessoraNome: null,
            responsavelNome: null,
            observacao: null,
            horasAlocadas: 0,
            saldo: null,
            horasDivergentes: false,
            horasExcedentes: 0,
            integracaoErpLabel: null,
            integracaoErpTone: null,
            integracaoErpErro: null,
            seqite: item.seqite,
            podeEditarItem: item.podeEditar,
            depexe: item.depexe,
            depexeLabel: item.depexeLabel,
            alocacoesResumo: [],
          });

          for (const n of item.nos) {
            todosNos.push({
              id: n.id,
              parentId: n.parentId ?? itemId,
              tipo: n.tipo,
              nome: n.nome,
              ordem: n.ordem,
              horasPrevistas: n.duracaoHoras,
              horasRealizadas: n.horasRealizadas,
              responsavelCodfor: n.responsavelCodfor,
              predecessoraId: n.predecessoraId,
              statusManual: (n.status as Exclude<StatusNo, "bloqueada"> | null) ?? null,
              dataPrevistaInicio: n.dataPrevistaInicio,
              dataPrevistaFim: n.dataPrevistaFim,
              predecessoraNome: n.predecessoraNome,
              responsavelNome: n.responsavelNome,
              observacao: n.observacao,
              horasAlocadas: n.horasAlocadas,
              saldo: n.saldo,
              horasDivergentes: n.horasDivergentes,
              horasExcedentes: n.horasExcedentes,
              integracaoErpLabel: n.integracaoErpLabel,
              integracaoErpTone: n.integracaoErpTone,
              integracaoErpErro: n.integracaoErpErro,
              seqite: item.seqite,
              podeEditarItem: item.podeEditar,
              depexe: item.depexe,
              depexeLabel: item.depexeLabel,
              alocacoesResumo: n.alocacoes ?? [],
            });
          }
        }
        setNos(todosNos);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar o cronograma"))
      .finally(() => setLoading(false));
  }, [codemp, codpro]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Optimistic update com rollback: aplica o patch localmente na hora, chama a API
  // em seguida; se der erro, desfaz pro snapshot anterior e propaga o erro (o chamador
  // — drawer, menu, DnD — decide como mostrar).
  const atualizarNo = useCallback(async (id: number, patch: PatchNo) => {
    let snapshot: NoCronogramaCompleto[] = [];
    setNos((atual) => {
      snapshot = atual;
      return atual.map((n) => {
        if (n.id !== id) return n;
        const proximo = { ...n };
        if (patch.nome !== undefined) proximo.nome = patch.nome;
        if (patch.responsavelCodfor !== undefined) proximo.responsavelCodfor = patch.responsavelCodfor;
        if (patch.responsavelNome !== undefined) proximo.responsavelNome = patch.responsavelNome;
        if (patch.horasPrevistas !== undefined) proximo.horasPrevistas = patch.horasPrevistas;
        if (patch.dataPrevistaInicio !== undefined) proximo.dataPrevistaInicio = patch.dataPrevistaInicio;
        if (patch.dataPrevistaFim !== undefined) proximo.dataPrevistaFim = patch.dataPrevistaFim;
        if (patch.predecessoraId !== undefined) proximo.predecessoraId = patch.predecessoraId;
        if (patch.statusManual !== undefined) proximo.statusManual = patch.statusManual;
        if (patch.observacao !== undefined) proximo.observacao = patch.observacao;
        if (patch.parentId !== undefined) proximo.parentId = patch.parentId;
        if (patch.ordem !== undefined) proximo.ordem = patch.ordem;
        return proximo;
      });
    });

    try {
      const { data } = await axios.patch(`/api/alocacao/estrutura/${id}`, {
        ...(patch.nome !== undefined ? { nome: patch.nome } : {}),
        ...(patch.responsavelCodfor !== undefined ? { responsavelCodfor: patch.responsavelCodfor } : {}),
        ...(patch.horasPrevistas !== undefined ? { duracaoHoras: patch.horasPrevistas } : {}),
        ...(patch.dataPrevistaInicio !== undefined ? { dataPrevistaInicio: patch.dataPrevistaInicio } : {}),
        ...(patch.dataPrevistaFim !== undefined ? { dataPrevistaFim: patch.dataPrevistaFim } : {}),
        ...(patch.predecessoraId !== undefined ? { predecessoraId: patch.predecessoraId } : {}),
        ...(patch.statusManual !== undefined ? { status: patch.statusManual } : {}),
        ...(patch.observacao !== undefined ? { observacao: patch.observacao } : {}),
        ...(patch.parentId !== undefined ? { parentId: parentIdReal(patch.parentId) } : {}),
        ...(patch.ordem !== undefined ? { ordem: patch.ordem } : {}),
        ...(patch.confirmarExcedente ? { confirmarExcedente: true } : {}),
      });
      // PATCH /estrutura/:id devolve o id da AtividadeConsultor criada/editada nesta
      // requisição (troca de responsável ou de horas) — quando existe, algo acabou de ser
      // mandado pro Senior: recarrega na hora (o patch otimista acima não sabe nada sobre
      // integracaoErpLabel/Tone, que são calculados só no servidor) e acompanha até o
      // resultado definitivo chegar, mesmo mecanismo do botão "Sincronizar com o Senior".
      if (data?.atividadeConsultorId != null) {
        carregar();
        acompanharSincronizacaoAlocacao(data.atividadeConsultorId);
      }
    } catch (err) {
      setNos(snapshot);
      const axiosErr = err as { response?: { data?: { error?: string } } };
      throw new Error(axiosErr.response?.data?.error ?? "Falha ao salvar alteração");
    }
  }, [carregar]);

  // Agrupa (parentId = id de uma pasta raiz) ou solta (parentId = null) um item da
  // proposta — o item continua virtual, só a posição é persistida no backend
  // (PropostaItemPosicao). Optimistic update no próprio nó virtual do item.
  const moverItem = useCallback(
    async (seqite: number, parentId: number | null) => {
      const itemId = idVirtualItem(seqite);
      let snapshot: NoCronogramaCompleto[] = [];
      setNos((atual) => {
        snapshot = atual;
        return atual.map((n) => (n.id === itemId ? { ...n, parentId } : n));
      });

      try {
        await axios.post(`/api/alocacao/propostas/${codemp}/${codpro}/itens/${seqite}/posicao`, { parentId });
      } catch (err) {
        setNos(snapshot);
        const axiosErr = err as { response?: { data?: { error?: string } } };
        throw new Error(axiosErr.response?.data?.error ?? "Não foi possível mover o item");
      }
    },
    [codemp, codpro]
  );

  const criarNo = useCallback(
    async (novo: NovoNo): Promise<NoCronogramaCompleto> => {
      // Pasta raiz (sem seqite): não pertence a nenhum item, permissão vem de
      // proposta.podeGerenciarProposta em vez do podeEditarItem de um item específico.
      const itemDoNo = novo.seqite != null ? nos.find((n) => n.tipo === "item" && n.seqite === novo.seqite) : undefined;
      if (novo.seqite != null && !itemDoNo) throw new Error("Item não encontrado");

      try {
        const { data } = await axios.post("/api/alocacao/estrutura", {
          codemp: Number(codemp),
          codpro: Number(codpro),
          ...(novo.seqite != null ? { seqite: novo.seqite } : {}),
          tipo: novo.tipo,
          nome: novo.nome,
          parentId: parentIdReal(novo.parentId),
        });
        const criado: NoCronogramaCompleto = {
          id: data.id,
          parentId: novo.parentId,
          tipo: novo.tipo,
          nome: novo.nome,
          ordem: 0,
          horasPrevistas: null,
          horasRealizadas: 0,
          responsavelCodfor: null,
          predecessoraId: null,
          statusManual: null,
          dataPrevistaInicio: null,
          dataPrevistaFim: null,
          predecessoraNome: null,
          responsavelNome: null,
          observacao: null,
          horasAlocadas: 0,
          saldo: null,
          horasDivergentes: false,
          horasExcedentes: 0,
          integracaoErpLabel: null,
          integracaoErpTone: null,
          integracaoErpErro: null,
          seqite: novo.seqite ?? null,
          podeEditarItem: itemDoNo ? itemDoNo.podeEditarItem : proposta?.podeGerenciarProposta ?? false,
          depexe: itemDoNo?.depexe ?? null,
          depexeLabel: itemDoNo?.depexeLabel ?? null,
          // Nó recém-criado não tem alocação ainda — isso só existe depois de "Alocar consultores".
          alocacoesResumo: [],
        };
        setNos((atual) => [...atual, criado]);
        return criado;
      } catch (err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        throw new Error(axiosErr.response?.data?.error ?? "Falha ao criar");
      }
    },
    [codemp, codpro, nos, proposta]
  );

  const excluirNo = useCallback(async (id: number) => {
    try {
      await axios.delete(`/api/alocacao/estrutura/${id}`);
      setNos((atual) => atual.filter((n) => n.id !== id));
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      throw new Error(axiosErr.response?.data?.error ?? "Não foi possível excluir");
    }
  }, []);

  // Acompanha um envio disparado em segundo plano (POST /alocacoes/:id/reenviar) até ele
  // terminar de verdade — mesmo formato recursivo de acompanharEnvio em
  // MeusApontamentos.tsx: setTimeout (não setInterval, pra nunca sobrepor uma consulta na
  // outra), consultando GET /alocacoes/:id/envio a cada ENVIO_INTERVALO_MS. Só quando o
  // resultado é definitivo (confirmado, bloqueado, ou qualquer erro) chama `carregar()` — a
  // releitura completa da árvore, que já resolve o rótulo/tom certos (ver mapNo no backend);
  // enquanto não concluir, não mexe em `nos`, então a tela mostra "Enviando" honestamente em
  // vez de piscar com dado parcial. Falha de rede durante o polling é transitória, tenta de
  // novo no próximo tick.
  function acompanharSincronizacaoAlocacao(atividadeConsultorId: number, tentativa = 0) {
    const timer = window.setTimeout(async () => {
      let concluido = false;
      try {
        const { data } = await axios.get(`/api/alocacao/alocacoes/${atividadeConsultorId}/envio`);
        concluido = data.status === "registrado" || data.status === "bloqueado" || Boolean(data.erro);
        if (concluido) carregar();
      } catch {
        // Falha de rede no acompanhamento é transitória — tenta de novo no próximo tick.
      }

      if (concluido) return;
      if (tentativa + 1 < ENVIO_MAX_TENTATIVAS) {
        acompanharSincronizacaoAlocacao(atividadeConsultorId, tentativa + 1);
      }
      // Estourou o tempo sem desfecho: fica no que já tinha e o cron de 15 min assume.
    }, ENVIO_INTERVALO_MS);
    timersEnvioRef.current.push(timer);
  }

  // Reenvia uma alocação com falha de envio (ver POST /alocacoes/:id/reenviar) — dispara em
  // segundo plano no servidor (202); recarrega a árvore na hora só pra refletir o reset
  // imediato (pendente/enviando) e em seguida acompanha até o resultado definitivo chegar.
  const sincronizarAlocacao = useCallback(
    async (atividadeConsultorId: number) => {
      try {
        await axios.post(`/api/alocacao/alocacoes/${atividadeConsultorId}/reenviar`);
        carregar();
        acompanharSincronizacaoAlocacao(atividadeConsultorId);
      } catch (err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        throw new Error(axiosErr.response?.data?.error ?? "Falha ao reenviar ao Senior");
      }
    },
    [carregar]
  );

  // Duplica só o nó (não a subárvore) — cria uma cópia rasa com "(cópia)" no nome e
  // recarrega do servidor pra garantir consistência, já que envolve 2 chamadas
  // encadeadas (criar + preencher os campos que POST /estrutura não aceita).
  const duplicarNo = useCallback(
    async (no: NoCronogramaCompleto) => {
      let criadoId: number | undefined;
      try {
        const { data } = await axios.post("/api/alocacao/estrutura", {
          codemp: Number(codemp),
          codpro: Number(codpro),
          ...(no.seqite != null ? { seqite: no.seqite } : {}),
          tipo: no.tipo,
          nome: `${no.nome} (cópia)`,
          parentId: parentIdReal(no.parentId),
        });
        criadoId = data.id;
        if (no.tipo === "atividade") {
          await axios.patch(`/api/alocacao/estrutura/${data.id}`, {
            duracaoHoras: no.horasPrevistas,
            dataPrevistaInicio: no.dataPrevistaInicio,
            dataPrevistaFim: no.dataPrevistaFim,
            predecessoraId: no.predecessoraId,
            status: no.statusManual,
            responsavelCodfor: no.responsavelCodfor,
            observacao: no.observacao,
          });
        }
        carregar();
      } catch (err) {
        // Se o nó chegou a ser criado mas o PATCH com os demais campos falhou (ex.: saldo
        // do item já esgotado), desfaz a criação — melhor falhar por completo do que deixar
        // uma cópia capenga (só nome, sem horas/predecessora/etc.) na árvore.
        if (criadoId != null) {
          await axios.delete(`/api/alocacao/estrutura/${criadoId}`).catch(() => {});
        }
        const axiosErr = err as { response?: { data?: { error?: string } } };
        throw new Error(axiosErr.response?.data?.error ?? "Falha ao duplicar");
      }
    },
    [carregar, codemp, codpro]
  );

  // Liga/desliga o bypass "Salvar mesmo excedendo" da edição de duração (ver
  // DrawerAtividade/PATCH /propostas/:codemp/:codpro/configuracao-alocacao). Optimistic,
  // mesmo padrão de atualizarNo — desfaz no erro.
  const atualizarBloqueiaExcedenteEstrutura = useCallback(
    async (bloqueiaExcedenteEstrutura: boolean) => {
      const snapshot = proposta;
      setProposta((atual) => (atual ? { ...atual, bloqueiaExcedenteEstrutura } : atual));
      try {
        await axios.patch(`/api/alocacao/propostas/${codemp}/${codpro}/configuracao-alocacao`, { bloqueiaExcedenteEstrutura });
      } catch (err) {
        setProposta(snapshot);
        const axiosErr = err as { response?: { data?: { error?: string } } };
        throw new Error(axiosErr.response?.data?.error ?? "Falha ao salvar a configuração");
      }
    },
    [codemp, codpro, proposta]
  );

  // Liga/desliga o bloqueio de apontamento/excedente EM NÍVEL DE PROPOSTA (ver
  // PATCH /propostas/:codemp/:codpro/configuracao-alocacao). Optimistic, mesmo padrão de
  // atualizarBloqueiaExcedenteEstrutura acima — desfaz no erro. Também recalcula o
  // "efetivo" de toda alocação da árvore (mesma lógica OR de
  // domain/bloqueioApontamento.ts no backend, replicada aqui só pro toggle parecer
  // instantâneo; o servidor confirma/recusa de verdade em cada ação).
  // Pedido de mudança pra quem NÃO tem alçada (ver podeAprovarConfiguracao). Sem update
  // otimista de propósito: o valor só muda quando alguém aprovar — o que muda agora é só a
  // pendência, e é `carregar()` que a traz de volta pra travar o checkbox.
  const solicitarConfigProposta = useCallback(
    async (campo: string, valorSolicitado: boolean, motivo: string) => {
      try {
        await axios.post("/api/solicitacoes-config-proposta", {
          codemp: Number(codemp),
          codpro: Number(codpro),
          campo,
          valorSolicitado,
          motivo,
        });
        await carregar();
      } catch (err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        throw new Error(axiosErr.response?.data?.error ?? "Falha ao enviar a solicitação");
      }
    },
    [carregar, codemp, codpro]
  );

  const atualizarConfigApontamentoProposta = useCallback(
    async (patch: Partial<{ bloqueiaApontamento: boolean; bloqueiaExcedente: boolean }>) => {
      const snapshotProposta = proposta;
      const snapshotNos = nos;
      const novaProposta = proposta ? { ...proposta, ...patch } : proposta;
      setProposta(novaProposta);
      if (novaProposta) {
        setNos((atual) =>
          atual.map((n) => ({
            ...n,
            alocacoesResumo: n.alocacoesResumo.map((a) => ({
              ...a,
              bloqueadoApontamentoEfetivo: novaProposta.bloqueiaApontamento || a.bloqueiaApontamento,
              bloqueadoExcedenteEfetivo: novaProposta.bloqueiaExcedente || a.bloqueiaExcedente,
            })),
          }))
        );
      }
      try {
        await axios.patch(`/api/alocacao/propostas/${codemp}/${codpro}/configuracao-alocacao`, patch);
      } catch (err) {
        setProposta(snapshotProposta);
        setNos(snapshotNos);
        const axiosErr = err as { response?: { data?: { error?: string } } };
        throw new Error(axiosErr.response?.data?.error ?? "Falha ao salvar a configuração");
      }
    },
    [codemp, codpro, proposta, nos]
  );

  // Equivalente por ALOCAÇÃO (gestor bloqueia só uma atividade de um consultor, sem mexer
  // na proposta inteira) — ver PATCH /atividades/:id/config-apontamento. Mesmo padrão
  // optimistic acima, combinando com o bloqueio da proposta (já em `proposta`) pra
  // recalcular o efetivo desta alocação só.
  const atualizarConfigApontamentoAlocacao = useCallback(
    async (alocacaoId: number, patch: Partial<{ bloqueiaApontamento: boolean; bloqueiaExcedente: boolean }>) => {
      const snapshot = nos;
      setNos((atual) =>
        atual.map((n) => ({
          ...n,
          alocacoesResumo: n.alocacoesResumo.map((a) => {
            if (a.id !== alocacaoId) return a;
            const bloqueiaApontamento = patch.bloqueiaApontamento ?? a.bloqueiaApontamento;
            const bloqueiaExcedente = patch.bloqueiaExcedente ?? a.bloqueiaExcedente;
            return {
              ...a,
              bloqueiaApontamento,
              bloqueiaExcedente,
              bloqueadoApontamentoEfetivo: (proposta?.bloqueiaApontamento ?? false) || bloqueiaApontamento,
              bloqueadoExcedenteEfetivo: (proposta?.bloqueiaExcedente ?? true) || bloqueiaExcedente,
            };
          }),
        }))
      );
      try {
        await axios.patch(`/api/atividades/${alocacaoId}/config-apontamento`, patch);
      } catch (err) {
        setNos(snapshot);
        const axiosErr = err as { response?: { data?: { error?: string } } };
        throw new Error(axiosErr.response?.data?.error ?? "Falha ao salvar a configuração");
      }
    },
    [nos, proposta]
  );

  // Equivalente por ALOCAÇÃO do "Salvar" de TetoApontamento.tsx, mas chamável direto da
  // árvore (coluna Excedente vira input quando não bloqueada) — ver PATCH
  // /atividades/:id/horas-excedentes.
  const atualizarHorasExcedentesAlocacao = useCallback(
    async (alocacaoId: number, horasExcedentes: number) => {
      const snapshot = nos;
      setNos((atual) =>
        atual.map((n) => {
          if (!n.alocacoesResumo.some((a) => a.id === alocacaoId)) return n;
          const novasAlocacoes = n.alocacoesResumo.map((a) => (a.id === alocacaoId ? { ...a, horasExcedentes } : a));
          return {
            ...n,
            alocacoesResumo: novasAlocacoes,
            // horasExcedentes do NÓ é soma das alocações (mesmo cálculo do backend, mapNo) —
            // recalculado aqui pra coluna Excedente (agregarHoras lê no.horasExcedentes direto
            // pra tipo="atividade") atualizar na hora.
            horasExcedentes: novasAlocacoes.reduce((soma, a) => soma + a.horasExcedentes, 0),
          };
        })
      );
      try {
        await axios.patch(`/api/atividades/${alocacaoId}/horas-excedentes`, { horasExcedentes });
      } catch (err) {
        setNos(snapshot);
        const axiosErr = err as { response?: { data?: { error?: string } } };
        throw new Error(axiosErr.response?.data?.error ?? "Falha ao salvar as horas excedentes");
      }
    },
    [nos]
  );

  return {
    proposta,
    nos,
    loading,
    erro,
    recarregar: carregar,
    atualizarNo,
    criarNo,
    excluirNo,
    duplicarNo,
    moverItem,
    atualizarBloqueiaExcedenteEstrutura,
    atualizarConfigApontamentoProposta,
    solicitarConfigProposta,
    atualizarConfigApontamentoAlocacao,
    atualizarHorasExcedentesAlocacao,
    sincronizarAlocacao,
    acompanharSincronizacaoAlocacao,
  };
}
