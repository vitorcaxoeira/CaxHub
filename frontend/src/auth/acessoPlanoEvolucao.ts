// Departamentos executores (USU_LDepExe do Senior) cujos gestores, além do admin, gerem o Plano de Evolução PJ (Gestão de Projetos ›
// Plano de Evolução PJ): 8 = Consultoria ERP, 9 = Consultoria HCM. Gestor não é papel (Role): vem de DepartamentoGestor, então trocar o
// gestor no Senior troca quem entra, sem deploy. Em sincronia com DEPEXES_PLANO_EVOLUCAO de backend/src/domain/propostasDominio.ts.
export const DEPEXES_PLANO_EVOLUCAO: readonly number[] = [8, 9];
