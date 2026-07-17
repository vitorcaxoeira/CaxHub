// Domínio "USU_TipUsuRat" do Senior (tipo de usuário pra RAT), presente em Consultor.tipusurat.
export const TIPUSURAT_LABELS: Record<number, string> = {
  1: "Adm. Pleno",
  2: "Comercial",
  3: "Consultor de Serviços",
  4: "Gerente de Serviços",
  5: "Consultor Suporte",
  6: "Gerente Suporte",
  7: "Gerente Comercial",
  8: "Gerente Dev. SoelX",
  9: "Desenvolvedor SoelX",
};

export function tipusuratLabel(tipusurat: number | null): string {
  if (tipusurat === null) return "—";
  return TIPUSURAT_LABELS[tipusurat] ?? `Tipo ${tipusurat}`;
}

// Sugestão de papel (Role.name) do CaxHub a partir do tipusurat do Consultor vinculado.
// Agrupado só por área funcional (sem separar gerente/colaborador) — quem gerencia o quê
// já é derivado dinamicamente de DepartamentoGestor/DepartamentoTime (ver GET
// /dashboard/meu-perfil), então o papel não precisa mais carregar essa distinção.
export const TIPUSURAT_ROLE_SUGERIDO: Record<number, string> = {
  1: "administrativo",
  2: "comercial",
  3: "consultoria",
  4: "consultoria",
  5: "suporte",
  6: "suporte",
  7: "comercial",
  8: "desenvolvimento",
  9: "desenvolvimento",
};

export function papelSugeridoPorTipusurat(tipusurat: number | null): string | null {
  if (tipusurat === null) return null;
  return TIPUSURAT_ROLE_SUGERIDO[tipusurat] ?? null;
}
