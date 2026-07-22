import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { NoCronograma, StatusNo } from "../lib/cronograma";

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
  // Item ao qual esse nó pertence — útil pra ações (criar/alocar) que dependem do
  // departamento/permissão do item, mesmo pra nós que estão vários níveis abaixo dele.
  // Null só pra pasta raiz da proposta (não pertence a nenhum item específico).
  seqite: number | null;
  podeEditarItem: boolean;
  depexe: number | null;
  depexeLabel: string | null;
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
  saldo: number | null;
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
            seqite: null,
            podeEditarItem: p.podeEditar,
            depexe: null,
            depexeLabel: null,
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
            seqite: item.seqite,
            podeEditarItem: item.podeEditar,
            depexe: item.depexe,
            depexeLabel: item.depexeLabel,
          });

          for (const n of item.nos) {
            todosNos.push({
              id: n.id,
              parentId: n.parentId ?? itemId,
              tipo: n.tipo,
              nome: n.nome,
              ordem: n.ordem,
              horasPrevistas: n.duracaoHoras,
              horasRealizadas: 0,
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
              seqite: item.seqite,
              podeEditarItem: item.podeEditar,
              depexe: item.depexe,
              depexeLabel: item.depexeLabel,
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
      await axios.patch(`/api/alocacao/estrutura/${id}`, {
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
    } catch (err) {
      setNos(snapshot);
      const axiosErr = err as { response?: { data?: { error?: string } } };
      throw new Error(axiosErr.response?.data?.error ?? "Falha ao salvar alteração");
    }
  }, []);

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
          seqite: novo.seqite ?? null,
          podeEditarItem: itemDoNo ? itemDoNo.podeEditarItem : proposta?.podeGerenciarProposta ?? false,
          depexe: itemDoNo?.depexe ?? null,
          depexeLabel: itemDoNo?.depexeLabel ?? null,
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

  return { proposta, nos, loading, erro, recarregar: carregar, atualizarNo, criarNo, excluirNo, duplicarNo, moverItem };
}
