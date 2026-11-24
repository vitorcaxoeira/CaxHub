import { type RefObject, useLayoutEffect, useState } from "react";
import { deslocamentosCongeladas, quantasCongeladasCabem } from "./layoutColunas";

interface Medidas {
  /** Largura medida de cada coluna parada. */
  larguras: Record<string, number>;
  /** Largura visível da área que rola (a tabela cabe nela ou rola dentro dela). */
  disponivel: number;
}

const SEM_MEDIDAS: Medidas = { larguras: {}, disponivel: 0 };

const iguais = (a: Medidas, b: Medidas) =>
  a.disponivel === b.disponivel && Object.keys(a.larguras).length === Object.keys(b.larguras).length && Object.entries(b.larguras).every(([n, px]) => a.larguras[n] === px);

/**
 * Onde cada coluna parada fica (09/11/2026, "congelar até aqui"): `left` = `inicio` (a coluna do ícone) + a largura das paradas que vêm antes. As
 * larguras são MEDIDAS no cabeçalho (`th[data-coluna]`), não presumidas: no layout automático a largura depende do conteúdo da página, e com
 * larguras ajustadas pelo usuário (table-fixed) vale a que ele escolheu. Medido antes da pintura (useLayoutEffect, sem piscar) e de novo
 * quando a janela, o conteúdo ou o redimensionar de coluna mudam a largura (ResizeObserver).
 *
 * Trava de segurança: se as paradas passarem de `FRACAO_MAX_CONGELADAS` da largura visível, só as primeiras que couberem ficam paradas; senão
 * sobraria pouco espaço para rolar o resto. Devolve só as que valem (`nomes`) e o `left` de cada uma.
 */
export function useDeslocamentosCongeladas(
  refCabecalho: RefObject<HTMLTableRowElement | null>,
  nomes: string[],
  inicio: number,
  larguraEstimada: Record<string, number>,
) {
  const [medidas, setMedidas] = useState<Medidas>(SEM_MEDIDAS);
  const chave = nomes.join("\u0000");

  useLayoutEffect(() => {
    const tr = refCabecalho.current;
    if (!tr || nomes.length === 0) {
      setMedidas((v) => (iguais(v, SEM_MEDIDAS) ? v : SEM_MEDIDAS));
      return;
    }
    const area = tr.closest("table")?.parentElement ?? null;
    const ths = nomes.map((n) => tr.querySelector<HTMLElement>(`th[data-coluna="${CSS.escape(n)}"]`));
    const medir = () => {
      const larguras: Record<string, number> = {};
      nomes.forEach((n, i) => {
        const th = ths[i];
        if (th) larguras[n] = th.getBoundingClientRect().width;
      });
      const proximo = { larguras, disponivel: area?.clientWidth ?? 0 };
      setMedidas((v) => (iguais(v, proximo) ? v : proximo));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(tr);
    if (area) observador.observe(area);
    ths.forEach((th) => th && observador.observe(th));
    return () => observador.disconnect();
    // `nomes` entra pela chave (o array é novo a cada render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, refCabecalho]);

  const larguras = nomes.map((n) => medidas.larguras[n] ?? larguraEstimada[n] ?? 120);
  const validas = nomes.slice(0, quantasCongeladasCabem(larguras, medidas.disponivel));
  const lefts = deslocamentosCongeladas(validas, { ...larguraEstimada, ...medidas.larguras }, inicio);
  return { nomes: validas, lefts };
}
