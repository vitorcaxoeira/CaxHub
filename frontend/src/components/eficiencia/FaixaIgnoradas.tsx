export type TipoIgnorado = "proposta" | "consultor" | "item" | "consultorProposta";

const TEXTOS: Record<TipoIgnorado, { um: string; varios: string; efeito: string; onde: string; restaurar: string }> = {
  proposta: { um: "proposta ignorada", varios: "propostas ignoradas", efeito: "nos cálculos", onde: "na lista da aba Propostas", restaurar: "Restaurar todas" },
  consultor: { um: "consultor ignorado", varios: "consultores ignorados", efeito: "nos indicadores da equipe", onde: "na lista da aba Equipe e carga", restaurar: "Restaurar todos" },
  item: { um: "item ignorado", varios: "itens ignorados", efeito: "no cálculo das propostas", onde: "no detalhe da proposta, em Itens e consultores", restaurar: "Restaurar todos" },
  consultorProposta: { um: "consultor ignorado", varios: "consultores ignorados", efeito: "no cálculo das propostas", onde: "no detalhe da proposta, na aba Consultores", restaurar: "Restaurar todos" },
};

// Lembra, em qualquer aba, que há propostas, itens ou consultores fora dos cálculos por escolha da própria pessoa. Sem este aviso, os
// totais pareceriam "errados" para quem esqueceu que marcou alguma coisa (a marcação fica guardada no navegador).
export function FaixaIgnoradas({
  total,
  tipo = "proposta",
  verRotulo = "Ver na lista",
  onVer,
  onRestaurar,
}: {
  total: number;
  tipo?: TipoIgnorado;
  verRotulo?: string;
  onVer: () => void;
  onRestaurar: () => void;
}) {
  const t = TEXTOS[tipo];
  const botao =
    "whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1 text-[12.5px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-border bg-surface-2/60 px-4 py-2.5 text-[13px] text-foreground"
    >
      <p className="min-w-0">
        <b>
          {total} {total > 1 ? t.varios : t.um} {t.efeito}.
        </b>{" "}
        <span className="text-muted">Escolha sua, vale só neste navegador. Marque ou desmarque {t.onde}.</span>
      </p>
      <span className="inline-flex gap-2">
        <button type="button" onClick={onVer} className={botao}>
          {verRotulo}
        </button>
        <button type="button" onClick={onRestaurar} className={botao}>
          {total > 1 ? t.restaurar : "Restaurar"}
        </button>
      </span>
    </div>
  );
}
