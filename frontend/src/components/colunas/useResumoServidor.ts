import axios from "axios";
import { useEffect, useState } from "react";
import type { PedidoResumo, ResultadoResumo } from "./resumo";

/**
 * Resumo do rodapé das listas do servidor (28/10/2026): pede à rota `/resumo` da lista, com os MESMOS parâmetros da lista (filtros do topo e
 * por coluna; paginação e ordem não importam), o resumo de todas as linhas do filtro. Separado da lista: o rodapé carrega sozinho e não
 * atrasa as linhas. Sem pedido (nenhuma coluna com resumo escolhido), não busca nada. `recarga` força buscar de novo (dados atualizados).
 */
export function useResumoServidor(url: string | null, params: Record<string, unknown>, pedidos: PedidoResumo[], recarga?: unknown) {
  const resumo = pedidos.length ? JSON.stringify(pedidos) : "";
  const chave = url && resumo ? JSON.stringify([url, params, resumo, recarga ?? null]) : "";
  const [estado, setEstado] = useState<{ chave: string; resultado: ResultadoResumo | null; erro: string | null } | null>(null);

  useEffect(() => {
    if (!chave || !url) return;
    const controle = new AbortController();
    axios
      .get<ResultadoResumo>(url, { params: { ...params, resumo }, signal: controle.signal })
      .then(({ data }) => setEstado({ chave, resultado: data, erro: null }))
      .catch((err) => {
        if (!axios.isCancel(err)) setEstado({ chave, resultado: null, erro: err.response?.data?.error ?? "Falha ao calcular o resumo" });
      });
    return () => controle.abort();
    // `chave` resume url, params, pedidos e recarga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const atual = estado?.chave === chave ? estado : null;
  return { resultado: atual?.resultado ?? null, erro: atual?.erro ?? null, carregando: !!chave && !atual };
}
