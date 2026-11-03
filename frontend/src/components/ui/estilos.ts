// Aparência comum dos controles (03/11/2026, modernização visual): filtros, seletores e campos de busca com a mesma altura, borda, raio,
// hover e foco em todas as telas. Só classes utilitárias exportadas: nada de seletor global, cada componente escolhe usar.

/** Gatilho de seletor/filtro e campo de texto: 36 px de altura, borda fina, raio suave, foco visível. */
export const CONTROLE =
  "inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-foreground transition-colors hover:border-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70";

/**
 * Controle com um acessório no canto superior direito (ex.: a estrela de "padrão do filtro" do Acompanhamento de Compra, 03/11/2026): a
 * borda passa para a caixa em volta (que não é clicável) e o gatilho/campo fica sem borda, com um recuo à direita onde o acessório se
 * posiciona (absolute). Assim o acessório é um botão IRMÃO do gatilho, nunca um botão dentro de outro. Mesma altura e aparência do CONTROLE.
 */
export const CAIXA_CONTROLE =
  "relative inline-flex h-9 items-stretch rounded-md border border-border bg-surface text-sm text-foreground transition-colors hover:border-muted/50 focus-within:border-primary/60";
export const GATILHO_EMBUTIDO =
  "inline-flex min-w-0 flex-1 items-center gap-2 rounded-md pl-3 pr-8 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70";

/** Ícone de controle (lucide): mesmo tamanho e traço em todo lugar. */
export const ICONE_CONTROLE = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
