import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../ui/Toast";
import { alternarOculta, definirLargura, ehPadrao, type LayoutSalvo, moverColuna, moverPasso, resolverLayout } from "./layoutColunas";
import type { FuncaoResumo } from "./resumo";

const ESPERA_GRAVAR_MS = 600;

/**
 * Ordem, colunas ocultas e larguras de uma tabela, do usuário logado, guardadas no servidor (26/10/2026). Enquanto o GET não volta, vale o padrão
 * (a tabela aparece na hora, sem esqueleto). Cada mudança vale na tela na hora e é gravada depois de ESPERA_GRAVAR_MS sem mexer (arrastar
 * várias vezes = um pedido); o que estiver pendente ao sair da tela é gravado na saída. `padrao` e `obrigatorias` precisam ser estáveis
 * (constantes). Uso:
 *
 *   const layout = useLayoutColunas("plannix.obra.materiais", PADRAO, ["descricao"]);
 *   layout.visiveis.map((nome) => <ThColuna ... arrastar={layout.arrastar} />)
 *   <PainelColunas layout={layout} titulos={TITULOS} />
 */
export function useLayoutColunas(tabela: string, padrao: string[], obrigatorias: string[] = []) {
  const { mostrar } = useToast();
  const [salvo, setSalvo] = useState<LayoutSalvo | null>(null);
  const mexeu = useRef(false);
  const pendente = useRef<{ timer: number; layout: LayoutSalvo } | null>(null);
  const url = `/api/perfil/colunas/${encodeURIComponent(tabela)}`;

  useEffect(() => {
    let cancelado = false;
    mexeu.current = false;
    // Outra tabela (chave dinâmica, como o "Ver dados"): a arrumação da anterior não vale aqui.
    setSalvo(null);
    axios
      .get<LayoutSalvo>(url)
      .then(({ data }) => !cancelado && !mexeu.current && setSalvo(data))
      // Sem a preferência a tabela funciona no padrão; não vale incomodar com aviso.
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [url]);

  const gravar = useCallback(
    (layout: LayoutSalvo) =>
      (ehPadrao(padrao, layout) ? axios.delete(url) : axios.put(url, layout)).catch(() => mostrar("Não foi possível guardar a arrumação das colunas", "warning")),
    [url, padrao, mostrar],
  );

  // Sai da tela com gravação pendente: grava já.
  useEffect(
    () => () => {
      if (!pendente.current) return;
      window.clearTimeout(pendente.current.timer);
      void gravar(pendente.current.layout);
      pendente.current = null;
    },
    [gravar],
  );

  const resolvido = useMemo(() => resolverLayout(padrao, salvo, obrigatorias), [padrao, salvo, obrigatorias]);

  const mudar = useCallback(
    (proximo: LayoutSalvo) => {
      mexeu.current = true;
      setSalvo(proximo);
      if (pendente.current) window.clearTimeout(pendente.current.timer);
      const timer = window.setTimeout(() => {
        pendente.current = null;
        void gravar(proximo);
      }, ESPERA_GRAVAR_MS);
      pendente.current = { timer, layout: proximo };
    },
    [gravar],
  );

  const { ordem, ocultas, larguras, resumos } = resolvido;
  // Toda mudança leva junto o que não mudou (a arrumação é gravada inteira).
  const com = (parte: Partial<LayoutSalvo>) => mudar({ ordem, ocultas, larguras, resumos, ...parte });
  return {
    ...resolvido,
    obrigatorias,
    personalizado: !ehPadrao(padrao, { ordem, ocultas, larguras }),
    /** Alguma largura ajustada: a tabela passa a ter larguras fixas (sem nenhuma, layout automático, como antes de qualquer ajuste). */
    comLarguras: Object.keys(larguras).length > 0,
    mover: (nome: string, destino: string) => com({ ordem: moverColuna(ordem, nome, destino) }),
    passo: (nome: string, passo: -1 | 1) => com({ ordem: moverPasso(ordem, nome, passo) }),
    alternar: (nome: string) => com({ ocultas: alternarOculta(ocultas, nome, obrigatorias) }),
    /** Nova largura de `nome`; no primeiro ajuste, `medidas` = largura atual de cada coluna visível (definirLargura). */
    redimensionar: (nome: string, px: number, medidas?: Record<string, number>) => com({ larguras: definirLargura(larguras, nome, px, medidas) }),
    /** Resumo do rodapé da coluna (null = nenhum). Não entra no "Restaurar" das colunas: é escolha à parte, no próprio rodapé. */
    definirResumo: (nome: string, funcao: FuncaoResumo | null) => {
      const { [nome]: _antes, ...outros } = resumos;
      com({ resumos: funcao ? { ...outros, [nome]: funcao } : outros });
    },
    restaurar: () => com({ ordem: padrao, ocultas: [], larguras: {} }),
    /** Para o `arrastar` do ThColuna: soltar a coluna `origem` em cima de `destino`. */
    arrastar: { grupo: tabela, onSoltar: (origem: string, destino: string) => com({ ordem: moverColuna(ordem, origem, destino) }) },
  };
}

export type LayoutColunas = ReturnType<typeof useLayoutColunas>;
