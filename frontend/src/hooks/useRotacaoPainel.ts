import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Motor de rotação do Modo Painel/TV — GENÉRICO: nenhuma linha aqui conhece o
// domínio de qualquer painel específico, só o contrato itens/dados. Portável
// pra outro projeto que herde o mecanismo sem alteração nenhuma.
//
// Duas disciplinas que o projeto já aprendeu à custa de bug real, e que aqui
// pesam mais que em qualquer outro lugar do app — isto roda 24/7, sem ninguém
// olhando, então um erro sutil vira ruído permanente, não um replay isolado:
//   1. UM timer central pra N painéis, nunca um por painel (Atividades.tsx:250-254
//      — timer por item virou rajada de requisições concorrentes).
//   2. setTimeout RECURSIVO, nunca setInterval (useCronograma.ts:482-490 —
//      setInterval sobrepõe consultas quando uma demora mais que o intervalo).
// ---------------------------------------------------------------------------

export interface ItemRotacaoPainel {
  id: number;
  painelId: string;
  duracaoSegundos: number;
  modoAtualizacao: "nenhum" | "local" | "erp";
  dominioSync: string | null;
}

interface EstadoRotacao {
  indice: number;
  dados: Record<number, unknown>;
}

export function useRotacaoPainel(itens: ItemRotacaoPainel[]) {
  const [estado, setEstado] = useState<EstadoRotacao>({ indice: 0, dados: {} });
  // "Em voo" por item — se já há uma busca pendente pra esta chave, não dispara outra.
  // Cobre o painel lento cuja resposta demora mais que a própria duração dele na tela.
  const emVooRef = useRef<Set<number>>(new Set());
  const timerRef = useRef<number | undefined>(undefined);

  const buscar = useCallback(async (item: ItemRotacaoPainel) => {
    if (item.modoAtualizacao === "nenhum") return;
    if (emVooRef.current.has(item.id)) return;
    emVooRef.current.add(item.id);
    try {
      if (item.modoAtualizacao === "erp" && item.dominioSync) {
        // Pré-busca: dispara a sincronização e NÃO espera o resultado. 202 (iniciou),
        // 409 (já rodando) e 200 "recente" (dentro do cooldown) são todos sucesso do
        // ponto de vista da TV — ela nunca fica numa tela de "aguarde", só mostra o
        // último dado bom até o próximo GET/dados trazer algo mais fresco.
        axios.post(`/api/painel-tv/sync/${item.dominioSync}`).catch(() => {});
      }
      const { data } = await axios.get(`/api/painel-tv/dados/${item.painelId}`, { params: { item: item.id } });
      setEstado((atual) => ({ ...atual, dados: { ...atual.dados, [item.id]: data } }));
    } catch {
      // Silêncio de propósito: a TV segue exibindo o último dado bom. Uma falha de
      // rede às 3h da manhã não pode virar uma tela de erro plantada até alguém notar.
    } finally {
      emVooRef.current.delete(item.id);
    }
  }, []);

  useEffect(() => {
    if (itens.length === 0) return;
    const atual = itens[estado.indice % itens.length];
    if (!atual) return;

    // Busca o painel atual (cobre a partida a frio, quando ele ainda não tem dado) e já
    // pré-busca o PRÓXIMO — quando a vez dele chegar, o dado já está pronto.
    void buscar(atual);
    const proximo = itens[(estado.indice + 1) % itens.length];
    if (proximo && proximo.id !== atual.id) void buscar(proximo);

    timerRef.current = window.setTimeout(() => {
      setEstado((s) => ({ ...s, indice: (s.indice + 1) % itens.length }));
    }, atual.duracaoSegundos * 1000);

    return () => window.clearTimeout(timerRef.current);
  }, [estado.indice, itens, buscar]);

  // Aba/TV voltando a ficar visível — setTimeout fica estrangulado em segundo plano
  // (ex.: economia de energia do monitor apagando e voltando), então refaz a busca do
  // painel atual ao retomar, em vez de esperar o próximo timer natural.
  useEffect(() => {
    function aoMudarVisibilidade() {
      if (document.visibilityState !== "visible" || itens.length === 0) return;
      const atual = itens[estado.indice % itens.length];
      if (atual) void buscar(atual);
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, [itens, estado.indice, buscar]);

  const atual = itens.length > 0 ? itens[estado.indice % itens.length] : null;
  return { atual, dados: atual ? estado.dados[atual.id] : undefined };
}
