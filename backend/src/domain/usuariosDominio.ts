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
// Lista provisória — pendente de revisão quando a estrutura de gestores por
// departamento for definida (ver plano "Papéis de usuário baseados em tipusurat").
export const TIPUSURAT_ROLE_SUGERIDO: Record<number, string> = {
  1: "administrativo",
  2: "comercial",
  3: "consultoria",
  4: "gerente_consultoria",
  5: "suporte",
  6: "gerente_suporte",
  7: "gerente_comercial",
  8: "gerente_desenvolvimento",
  9: "desenvolvimento",
};

export function papelSugeridoPorTipusurat(tipusurat: number | null): string | null {
  if (tipusurat === null) return null;
  return TIPUSURAT_ROLE_SUGERIDO[tipusurat] ?? null;
}
