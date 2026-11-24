import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import type { ColunaCalculadaNova, ColunaCalculadaSalva } from "./colunasCalculadas";

/**
 * As colunas calculadas de uma lista (28/10/2026): as minhas e as publicadas, de /api/perfil/calculadas/:tabela (mesma chave da arrumação
 * das colunas). `salvar` cria ou altera; `remover` exclui. Publicar é de admin/master (o servidor confere de novo).
 */
export function useColunasCalculadas(tabela: string) {
  const { user } = useAuth();
  const [lista, setLista] = useState<ColunaCalculadaSalva[]>([]);
  const url = `/api/perfil/calculadas/${encodeURIComponent(tabela)}`;

  const carregar = useCallback(
    () =>
      axios
        .get<ColunaCalculadaSalva[]>(url)
        .then(({ data }) => setLista(data))
        // Sem as calculadas a lista funciona igual (só sem elas): não vale incomodar com aviso.
        .catch(() => undefined),
    [url],
  );

  useEffect(() => {
    setLista([]);
    void carregar();
  }, [carregar]);

  /** Cria (sem `id`) ou altera. Devolve o id; erro do servidor sobe como texto em português. */
  const salvar = useCallback(
    async (dados: ColunaCalculadaNova, id?: number): Promise<number> => {
      try {
        const { data } = id ? await axios.put<{ id: number }>(`${url}/${id}`, dados) : await axios.post<{ id: number }>(url, dados);
        await carregar();
        return data.id;
      } catch (err) {
        throw new Error(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Falha ao gravar a coluna calculada") : "Falha ao gravar a coluna calculada");
      }
    },
    [url, carregar],
  );

  const remover = useCallback(
    async (id: number) => {
      try {
        await axios.delete(`${url}/${id}`);
        await carregar();
      } catch (err) {
        throw new Error(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Falha ao excluir a coluna calculada") : "Falha ao excluir a coluna calculada");
      }
    },
    [url, carregar],
  );

  return { lista, salvar, remover, podePublicar: user?.role === "admin" };
}

export type GestaoCalculadas = ReturnType<typeof useColunasCalculadas>;
