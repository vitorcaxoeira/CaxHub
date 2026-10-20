// Visões de Gestão de Projetos › Atividades. A lista é a mesma do backend (VISOES_ATIVIDADES em
// backend/src/domain/preferenciasTela.ts, com CHECK no banco): cada usuário escolhe em qual delas a tela abre.

export type VisaoAtividades = "quadro" | "lista" | "calendario" | "timeline" | "workload";

export const VISOES_ATIVIDADES: VisaoAtividades[] = ["quadro", "lista", "calendario", "timeline", "workload"];

export const ROTULO_VISAO: Record<VisaoAtividades, string> = {
  quadro: "Quadro",
  lista: "Lista",
  calendario: "Calendário",
  timeline: "Timeline",
  workload: "Workload",
};

export const VISAO_PADRAO_SISTEMA: VisaoAtividades = "quadro";

export const ehVisaoAtividades = (v: unknown): v is VisaoAtividades => typeof v === "string" && (VISOES_ATIVIDADES as string[]).includes(v);

/** Visão em que o usuário prefere abrir a tela; sem preferência (ou valor estranho), o Quadro. */
export const visaoPadraoDe = (preferida: string | null | undefined): VisaoAtividades =>
  ehVisaoAtividades(preferida) ? preferida : VISAO_PADRAO_SISTEMA;

/** Visão ao abrir a tela: `?visao=` válida manda (link compartilhado, voltar de um detalhe); senão a preferida do usuário. */
export const visaoInicial = (daUrl: string | null, preferida: string | null | undefined): VisaoAtividades =>
  ehVisaoAtividades(daUrl) ? daUrl : visaoPadraoDe(preferida);
