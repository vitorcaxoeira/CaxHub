// Rótulos dos domínios do Senior HCM usados nas telas. Vêm do dicionário (r996lsf) do HCM da Soeltech
// (conferido em 09/10/2026), exceto `GRAU_INSTRUCAO`, que o dicionário não enumera: segue a tabela de
// grau de instrução do eSocial, que é a que o Senior grava em R034FUN.GraIns.

export const TIPO_COLABORADOR: Record<number, string> = { 1: "Empregado", 2: "Terceiro", 3: "Parceiro" };

export const SEXO: Record<string, string> = { F: "Feminino", M: "Masculino" };

export const ESTADO_CIVIL: Record<number, string> = {
  1: "Solteiro", 2: "Casado", 3: "Divorciado", 4: "Viúvo", 5: "Concubinato", 6: "Separado", 7: "União estável", 9: "Outros",
};

export const GRAU_INSTRUCAO: Record<number, string> = {
  1: "Analfabeto",
  2: "Até o 5º ano incompleto",
  3: "5º ano completo",
  4: "6º ao 9º ano incompleto",
  5: "Fundamental completo",
  6: "Médio incompleto",
  7: "Médio completo",
  8: "Superior incompleto",
  9: "Superior completo",
  10: "Pós-graduação",
  11: "Mestrado",
  12: "Doutorado",
  13: "Pós-doutorado",
};

// R010SIT.ConAbs — a própria classificação do Senior de quanto cada situação do ponto entra no
// cálculo de absenteísmo.
export const CONSIDERA_ABSENTEISMO: Record<number, string> = {
  1: "Não considera",
  2: "Horas trabalhadas",
  3: "Faltas não justificadas",
  4: "Faltas justificadas",
  5: "Atestado médico",
};

// R008EVC.TipEve — tipo do evento da folha.
export const TIPO_EVENTO: Record<number, string> = {
  1: "Provento", 2: "Vantagem", 3: "Desconto", 4: "Outros", 5: "Outros env. provento", 6: "Outros env. desconto",
};

// R044CAL.TipCal — só os cálculos que entram na análise de custo.
export const TIPO_CALCULO: Record<number, string> = {
  11: "Mensal", 12: "Complementar", 13: "Complementar de dissídio", 14: "Pagamento de dissídio", 15: "Complementar de rescisão",
  31: "Adiantamento de 13º", 32: "13º salário", 91: "Adiantamento salarial", 92: "PLR", 93: "Especiais", 94: "Reclamatória",
};

// Situação do colaborador no cadastro (R034FUN.SitAfa) = código da situação do ponto (R010SIT.CodSit).
export const SITUACAO_DEMITIDO = 7;

// Causas de demissão (R042CAU) agrupadas pela iniciativa. As do cadastro padrão do Senior:
//   1/2 iniciativa da empresa (com/sem justa causa)      3/4 iniciativa do empregado (com/sem justa causa)
//   11 abandono de emprego (empregado)      12 fim de contrato      13 fim antecipado (empresa)      14 fim antecipado
//   (empregado)      15 extinção da empresa      26 acordo mútuo      demais (morte, aposentadoria...) = outros
export type IniciativaDesligamento = "empresa" | "empregado" | "contrato" | "acordo" | "outros";

export function iniciativaDaCausa(caudem: number | null): IniciativaDesligamento {
  switch (caudem) {
    case 1: case 2: case 13: case 15: return "empresa";
    case 3: case 4: case 11: case 14: return "empregado";
    case 12: return "contrato";
    case 26: return "acordo";
    default: return "outros";
  }
}

export const ROTULO_INICIATIVA: Record<IniciativaDesligamento, string> = {
  empresa: "Pela empresa",
  empregado: "Pelo colaborador",
  contrato: "Fim de contrato",
  acordo: "Acordo",
  outros: "Outros",
};

// R042RCV.TclRcs: grupo do evento dentro da rescisão (domínio LTclRcs). Os vários "Férias" do
// Senior (75-79, 95-99) são vencidas, proporcionais, em dobro etc.; para a tela ficam como "Férias".
export const TIPO_EVENTO_RESCISAO: Record<number, string> = {
  61: "Dissídio coletivo", 62: "Saldo de salários", 63: "Aviso prévio indenizado", 64: "Aviso prévio reavido",
  65: "Fim antecipado (empresa)", 66: "Fim antecipado (empregado)", 67: "Gratificação", 68: "Indenização FGTS (opção)",
  69: "Indenização do mês anterior à data-base", 70: "Estabilidade", 71: "13º proporcional", 72: "13º indenizado",
  73: "Licença especial", 74: "Gratificação (internacional)", 75: "Férias", 76: "Férias", 77: "Férias", 78: "Férias",
  79: "Férias", 80: "Outros eventos", 81: "FGTS", 82: "Multa do FGTS", 83: "Impostos", 84: "Férias indenizadas",
  86: "Multa de qualificação profissional", 87: "Ajuste de base do FGTS", 89: "Líquido / estouro", 95: "Férias",
  96: "Férias", 97: "Férias", 98: "Férias", 99: "Férias",
};
