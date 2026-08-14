import axios from "axios";
import { StatusNo } from "./cronograma";

export interface NoHierarquia {
  id: number;
  tipo: "pasta" | "atividade";
  nome: string;
  status: Exclude<StatusNo, "bloqueada"> | null;
  responsavelNome: string | null;
}

// Cache em memória (module-level, não é hook) da cadeia de ancestrais de UMA atividade —
// usado pela tooltip de hierarquia da Lista de Atividades (ver HierarquiaAtividadeTooltip).
// Chave é o id da ATIVIDADE (AtividadeConsultor), não do item/proposta: o endpoint (GET
// /atividades/:id/hierarquia) já devolve só a estrutura do item dela, então não há nada a
// ganhar compartilhando cache entre atividades diferentes do mesmo item.
//
// Sem invalidação/TTL de propósito, mesmo raciocínio do cache antigo que este substituiu:
// vive só enquanto a Lista de Atividades está montada.
const cache = new Map<number, Promise<NoHierarquia[]>>();

export function carregarHierarquiaAtividade(atividadeId: number) {
  let entrada = cache.get(atividadeId);
  if (!entrada) {
    entrada = axios.get(`/api/atividades/${atividadeId}/hierarquia`).then(({ data }) => data.cadeia as NoHierarquia[]);
    // Falha não fica em cache — o próximo hover tenta buscar de novo.
    entrada.catch(() => cache.delete(atividadeId));
    cache.set(atividadeId, entrada);
  }
  return entrada;
}
