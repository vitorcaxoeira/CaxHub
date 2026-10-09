import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { paramsDoFiltro, useFiltroRh } from "./filtroStore";

// Busca uma tela do módulo RH com o filtro único aplicado. Cada mudança de filtro refaz a busca e
// descarta a resposta de uma busca anterior que chegue atrasada (a mais nova sempre vence).

export interface RespostaBase {
  acesso: { individual: boolean };
  filtro: { tipcol: number[] | null; tipcolImplicito?: boolean };
}

export function useRh<T extends RespostaBase>(endpoint: string) {
  const filtro = useFiltroRh();
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const versao = useRef(0);

  const chave = JSON.stringify(paramsDoFiltro(filtro));

  const buscar = useCallback(() => {
    const minha = ++versao.current;
    setCarregando(true);
    axios
      .get<T>(`/api/rh/${endpoint}`, { params: JSON.parse(chave) })
      .then(({ data }) => {
        if (minha !== versao.current) return;
        setDados(data);
        setErro(null);
      })
      .catch((e) => {
        if (minha !== versao.current) return;
        setErro(axios.isAxiosError(e) ? e.response?.data?.error ?? e.message : "Falha ao carregar");
      })
      .finally(() => {
        if (minha === versao.current) setCarregando(false);
      });
  }, [endpoint, chave]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  return { dados, carregando, erro, recarregar: buscar };
}
