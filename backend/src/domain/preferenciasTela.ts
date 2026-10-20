// Preferências de tela de cada usuário (tabela preferencias_tela). Viajam junto com o usuário no login e em /auth/me, para a
// tela já abrir do jeito escolhido, sem esperar outra requisição.

/** Visões de Gestão de Projetos › Atividades, na ordem das abas. Igual ao CHECK da migration 20261020100000_preferencias_tela. */
export const VISOES_ATIVIDADES = ["quadro", "lista", "calendario", "timeline", "workload"] as const;
export type VisaoAtividades = (typeof VISOES_ATIVIDADES)[number];

export const VISAO_ATIVIDADES_PADRAO: VisaoAtividades = "quadro";

export interface PreferenciasPublicas {
  atividadesVisao: VisaoAtividades;
}

export function ehVisaoAtividades(v: unknown): v is VisaoAtividades {
  return typeof v === "string" && (VISOES_ATIVIDADES as readonly string[]).includes(v);
}

/** O que vai para o frontend; quem nunca escolheu (sem linha) recebe o padrão. */
export function preferenciasPublicas(pref: { atividadesVisao: string } | null | undefined): PreferenciasPublicas {
  return { atividadesVisao: ehVisaoAtividades(pref?.atividadesVisao) ? pref!.atividadesVisao as VisaoAtividades : VISAO_ATIVIDADES_PADRAO };
}

/**
 * Valida o corpo do PUT /perfil/preferencias. Devolve os campos a gravar ou a mensagem de erro. Campo ausente não muda nada;
 * corpo sem nenhum campo conhecido é erro (não há o que gravar).
 */
export function validarPreferencias(body: unknown): { dados: Partial<PreferenciasPublicas> } | { erro: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const dados: Partial<PreferenciasPublicas> = {};
  if (b.atividadesVisao !== undefined) {
    if (!ehVisaoAtividades(b.atividadesVisao)) return { erro: `atividadesVisao precisa ser uma de: ${VISOES_ATIVIDADES.join(", ")}` };
    dados.atividadesVisao = b.atividadesVisao;
  }
  if (Object.keys(dados).length === 0) return { erro: "Nenhuma preferência informada" };
  return { dados };
}
