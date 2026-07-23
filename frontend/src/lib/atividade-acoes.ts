// Regra de negócio de habilitação dos botões Iniciar/Parar — única fonte de verdade,
// usada tanto pelo Kanban quanto pela Lista (e espelhada no backend, que é quem valida
// de verdade: ver podeIniciar/podeParar em backend/src/domain/execucaoAtividade.ts).
//
// | Situação      | Iniciar      | Parar        |
// |---------------|--------------|--------------|
// | A Fazer       | habilitado   | desabilitado |
// | Em Andamento  | desabilitado | habilitado   |
// | Bloqueado     | desabilitado | desabilitado |
// | Concluído     | desabilitado | desabilitado |
export const RAIA_A_FAZER = "A Fazer";
export const RAIA_EM_ANDAMENTO = "Em Andamento";

// Quando true, o card/linha sempre mostra os dois botões (Iniciar e Parar), cada um
// desabilitado quando não se aplica. Quando false, mostra só o botão aplicável ao
// estado atual (só Iniciar em "A Fazer", só Parar em "Em Andamento", nenhum em
// "Bloqueado"/"Concluído").
export const EXIBIR_AMBOS_BOTOES = true;

export interface AtividadeComColuna {
  coluna: { nome: string } | null;
}

export function podeIniciar(atividade: AtividadeComColuna): boolean {
  return atividade.coluna?.nome === RAIA_A_FAZER;
}

export function podeParar(atividade: AtividadeComColuna): boolean {
  return atividade.coluna?.nome === RAIA_EM_ANDAMENTO;
}

// Motivo legível pra tooltip do botão desabilitado.
export function motivoIniciarDesabilitado(atividade: AtividadeComColuna): string {
  if (podeIniciar(atividade)) return "";
  return `Atividade não está em "${RAIA_A_FAZER}".`;
}

export function motivoPararDesabilitado(atividade: AtividadeComColuna): string {
  if (podeParar(atividade)) return "";
  return `Atividade não está em "${RAIA_EM_ANDAMENTO}".`;
}
