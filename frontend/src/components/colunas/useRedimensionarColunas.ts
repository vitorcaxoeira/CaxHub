import { useRef, useState } from "react";
import { limitarLargura } from "./layoutColunas";
import type { RedimensionarColuna } from "./ThColuna";
import type { LayoutColunas } from "./useLayoutColunas";

const LARGURA_SEM_PADRAO = 120;
// Folga do "ajustar ao conteúdo", para o texto não encostar na alça.
const FOLGA_AUTO = 4;

/**
 * Largura das colunas (26/10/2026), em cima do useLayoutColunas. Sem largura salva a tabela fica no layout automático, como sempre foi
 * (`larguras` = null). No primeiro ajuste mede todas as colunas visíveis e guarda as medidas, para a tabela ficar igual e só a coluna
 * puxada mudar; dali em diante a tabela tem larguras fixas (`table-fixed` + `<colgroup>`). Enquanto a alça é puxada a largura muda só na
 * tela; soltar grava. Uso:
 *
 *   const larg = useRedimensionarColunas(layout, { descricao: 360 });
 *   <table className={larg.larguras ? "table-fixed" : "w-full"} style={larg.total ? { width: larg.total } : undefined}>
 *   {larg.larguras && <colgroup>...<col style={{ width: larg.larguras[nome] }} /></colgroup>}
 *   <tr ref={larg.refCabecalho}> <ThColuna ... redimensionar={larg.alca(nome)} />
 *   <td data-coluna={nome} ...>   // para o duplo clique medir o conteúdo
 *
 * `larguraPadrao`: largura de coluna que aparece depois do primeiro ajuste (ex.: era oculta), sem largura salva.
 */
export function useRedimensionarColunas(layout: LayoutColunas, larguraPadrao: Record<string, number> = {}) {
  const refCabecalho = useRef<HTMLTableRowElement>(null);
  const [aoVivo, setAoVivo] = useState<Record<string, number> | null>(null);
  const medidas = useRef<Record<string, number> | undefined>(undefined);

  const base = aoVivo ?? (layout.comLarguras ? layout.larguras : null);
  const larguras = base ? Object.fromEntries(layout.visiveis.map((n) => [n, base[n] ?? larguraPadrao[n] ?? LARGURA_SEM_PADRAO])) : null;
  const total = larguras ? Object.values(larguras).reduce((s, px) => s + px, 0) : null;

  /** Largura atual de cada coluna visível, medida na tela (layout automático, antes do primeiro ajuste). */
  const medir = () => {
    const r: Record<string, number> = {};
    refCabecalho.current?.querySelectorAll<HTMLElement>("th[data-coluna]").forEach((th) => {
      r[th.dataset.coluna!] = th.getBoundingClientRect().width;
    });
    return r;
  };

  /** Maior conteúdo da coluna (título e células com `data-coluna`). */
  const conteudo = (nome: string) => {
    const tabela = refCabecalho.current?.closest("table");
    let maior = 0;
    tabela?.querySelectorAll<HTMLElement>(`[data-coluna="${CSS.escape(nome)}"]`).forEach((el) => {
      maior = Math.max(maior, el.scrollWidth);
    });
    return maior + FOLGA_AUTO;
  };

  const alca = (nome: string): RedimensionarColuna => ({
    cortar: larguras !== null,
    onInicio: () => {
      const medido = layout.comLarguras ? undefined : medir();
      medidas.current = medido;
      setAoVivo(larguras ?? medido ?? {});
    },
    onAjustar: (px) => setAoVivo((a) => ({ ...a, [nome]: limitarLargura(px) })),
    onFim: (px) => {
      layout.redimensionar(nome, px, medidas.current);
      medidas.current = undefined;
      setAoVivo(null);
    },
    onAutoAjuste: () => layout.redimensionar(nome, conteudo(nome), layout.comLarguras ? undefined : medir()),
  });

  return { refCabecalho, larguras, total, alca };
}
