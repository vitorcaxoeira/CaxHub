// Montagem do caminho e da URL completa de um recurso da documentação do Kyria (Mapeamento de Campos, 18/11/2026). Funções puras: a tela guarda só os
// VALORES dos parâmetros e daqui sai o caminho que vai pro preview e a URL que o admin vê.

export interface ParametroDoc {
  nome: string;
  local: "path" | "query";
  obrigatorio: boolean;
  tipo: string | null;
  enumValores: string[] | null;
  padrao: string | null;
  descricao: string | null;
  /** O sistema preenche (as datas do relatório de horas usam o mês corrente): a pessoa não digita e o valor nunca é gravado no recurso. */
  preenchidoPeloSistema: boolean;
}

export interface RegistradoCasado {
  resourceId: number;
  resourcePath: string;
  displayName: string;
  valoresCaminho: Record<string, string>;
  valoresQuery: Record<string, string>;
}

export interface RecursoDoc {
  caminho: string;
  resumo: string;
  grupo: string;
  parametrosCaminho: ParametroDoc[];
  parametrosQuery: ParametroDoc[];
  paginado: boolean;
  schemaItem: string | null;
  registrados: RegistradoCasado[];
}

const preenchido = (v: string | undefined) => (v ?? "").trim() !== "";

/** Parâmetros de query que a PESSOA preenche (os do sistema ficam de fora). */
export const queryDaPessoa = (r: RecursoDoc) => r.parametrosQuery.filter((p) => !p.preenchidoPeloSistema);

/** Caminho pronto para o preview: `{x}` trocado pelo valor (codificado) e a query só com o que foi preenchido, na ordem da documentação. */
export function montarCaminho(r: RecursoDoc, valoresCaminho: Record<string, string>, valoresQuery: Record<string, string>): string {
  const base = r.caminho.replace(/\{([^}]+)\}/g, (_, nome: string) => (preenchido(valoresCaminho[nome]) ? encodeURIComponent(valoresCaminho[nome].trim()) : `{${nome}}`));
  const consulta = queryDaPessoa(r)
    .filter((p) => preenchido(valoresQuery[p.nome]))
    .map((p) => `${encodeURIComponent(p.nome)}=${encodeURIComponent(valoresQuery[p.nome].trim())}`)
    .join("&");
  return consulta ? `${base}?${consulta}` : base;
}

/** Nomes dos parâmetros obrigatórios (de caminho ou de query) que ainda estão em branco. */
export function faltaPreencher(r: RecursoDoc, valoresCaminho: Record<string, string>, valoresQuery: Record<string, string>): string[] {
  return [
    ...r.parametrosCaminho.filter((p) => !preenchido(valoresCaminho[p.nome])).map((p) => p.nome),
    ...queryDaPessoa(r).filter((p) => p.obrigatorio && !preenchido(valoresQuery[p.nome])).map((p) => p.nome),
  ];
}

/** URL completa: base da API (já com /api/v1) + caminho. */
export function urlCompleta(baseUrl: string, caminho: string): string {
  return `${baseUrl.replace(/\/$/, "")}${caminho}`;
}
