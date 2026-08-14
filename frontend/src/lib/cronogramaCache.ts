import axios from "axios";
import { mapearRespostaCronograma, NoCronogramaCompleto, PropostaCronograma } from "../hooks/useCronograma";

// Cache em memória (module-level, não é hook) da árvore do cronograma por proposta — usado
// só pela tooltip de hierarquia da Lista de Atividades (ver HierarquiaAtividadeTooltip.tsx).
// Reaproveita a MESMA rota que a tela de Cronograma já usa (GET /alocacao/propostas/:codemp/
// :codpro/cronograma) em vez de criar um endpoint novo: a Lista já filtra por permissão de
// visualização (row.podeVerCronograma), então quem chega a abrir a tooltip já teria acesso à
// tela de Cronograma da mesma proposta.
//
// Sem invalidação/TTL de propósito: o cache vive só enquanto a Lista de Atividades estiver
// montada (é limpo ao recarregar a página). Passar o mouse em várias atividades da mesma
// proposta em sequência dispara UMA chamada só, não uma por atividade.
const cache = new Map<string, Promise<{ proposta: PropostaCronograma; nos: NoCronogramaCompleto[] }>>();

export function carregarCronogramaLeve(codemp: number, codpro: number) {
  const chave = `${codemp}-${codpro}`;
  let entrada = cache.get(chave);
  if (!entrada) {
    entrada = axios.get(`/api/alocacao/propostas/${codemp}/${codpro}/cronograma`).then(({ data }) => mapearRespostaCronograma(data));
    // Falha não fica em cache — o próximo hover tenta buscar de novo, em vez de ficar
    // preso a um erro passageiro (rede, 401 momentâneo) pelo resto da sessão.
    entrada.catch(() => cache.delete(chave));
    cache.set(chave, entrada);
  }
  return entrada;
}
