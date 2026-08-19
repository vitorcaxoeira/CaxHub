import axios from "axios";
import { useState } from "react";

// Estado padrão de qualquer ação "Sinc. ERP" — sync manual e síncrona de UM registro contra
// o Senior, disparada por clique, sem esperar o job noturno. Generaliza o padrão que já
// existia duplicado em duas telas (RatItem em MeusApontamentos.tsx, pedidos por cliente em
// ListarPedidos.tsx — cada uma com seu próprio `useState<number|null>` + try/catch/finally).
//
// `chave` (string) é o que permite reaproveitar isto tanto numa LISTA (uma chave por linha,
// ex. `${codemp}-${codpro}`, só aquela linha fica desabilitada) quanto numa tela de detalhe
// único (uma chave fixa, ex. "unico"). Não decide UI (texto do botão, toast de resultado) —
// cada tela tem contexto próprio pra isso; só concentra loading e a chamada.
export function useSincronizarErp<T = unknown>() {
  const [emAndamento, setEmAndamento] = useState<Set<string>>(new Set());

  async function sincronizar(chave: string, url: string): Promise<{ ok: true; data: T } | { ok: false; erro: string }> {
    setEmAndamento((atual) => new Set(atual).add(chave));
    try {
      const { data } = await axios.post<T>(url);
      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, erro: err.response?.data?.error ?? "Falha ao sincronizar com o ERP" };
    } finally {
      setEmAndamento((atual) => {
        const proximo = new Set(atual);
        proximo.delete(chave);
        return proximo;
      });
    }
  }

  return { sincronizar, estaSincronizando: (chave: string) => emAndamento.has(chave) };
}
