import type { ColunaLocal, LeitorDeValor } from "../../components/colunas/aplicarLocal";

// Tabela "Atividades" da RAT expandida (Meus Apontamentos › RATs): regras puras de leitura das colunas para o filtro e a ordem do kit local
// (TabelaLocal). Fica fora da página para ser testável e porque `ler` e `LOCAIS_ATIVIDADES` precisam ser constantes do módulo.

/** Os campos de um item de RAT que as colunas leem. Estrutural, para não depender do tipo da página. */
export interface ItemAtividade {
  seqite: number | null;
  itemDescricao: string | null;
  horini: number | null;
  horfim: number | null;
  confirmadoNoSenior: boolean;
  removidoEmSenior: string | null;
  envioStatus: string | null;
  envioErro: string | null;
  edicaoStatus: "enviando" | "falha" | null;
}

// Item da proposta com a sequência como prefixo ("3 - Automação de indicadores"). Mesma forma de "código - descrição" já usada em cliente
// (`${codcli} - ${nomcli}`). Assinatura estrutural para servir às DUAS tabelas da tela (sessões pendentes e itens da RAT).
export function rotuloItem(item: { seqite: number | null; itemDescricao: string | null }): string {
  const descricao = item.itemDescricao ?? "—";
  return item.seqite != null ? `${item.seqite} - ${descricao}` : descricao;
}

export function formatHoraDoDia(minutosDesdeMeiaNoite: number): string {
  const h = Math.floor(minutosDesdeMeiaNoite / 60);
  const m = minutosDesdeMeiaNoite % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:50–11:00", ou null sem as duas horas. Começa pela hora inicial, então a ordem textual é a cronológica. */
export function horarioDoItem(item: Pick<ItemAtividade, "horini" | "horfim">): string | null {
  return item.horini != null && item.horfim != null ? `${formatHoraDoDia(item.horini)}–${formatHoraDoDia(item.horfim)}` : null;
}

// Rótulo da coluna Integração, para o funil ("só os com falha"). Mesma precedência de AcaoIntegracao (MeusApontamentos.tsx): excluído no
// Senior primeiro, depois a alteração da sessão (tipEve A) a caminho ou recusada, o registrado, o envio em voo, a falha e, por fim, o que
// nunca foi enviado. O "reenviando" local (spinner) é transitório e fica só na célula.
export function situacaoIntegracaoItem(item: Pick<ItemAtividade, "confirmadoNoSenior" | "removidoEmSenior" | "envioStatus" | "envioErro" | "edicaoStatus">): string {
  if (item.removidoEmSenior) return "Excluído no Senior";
  if (item.confirmadoNoSenior) {
    if (item.edicaoStatus === "enviando") return "Alterando no Senior";
    if (item.edicaoStatus === "falha") return "Falha ao alterar";
    return "Registrado";
  }
  if (item.envioStatus === "enviando" || (item.envioStatus === "pendente" && !item.envioErro)) return "Integrando";
  if (item.envioErro) return "Falha no envio";
  return "Não enviado";
}

/** Como cada coluna filtra e ordena. Os nomes são os de COLUNAS_ATIVIDADES (MeusApontamentos.tsx). */
export const LOCAIS_ATIVIDADES: ColunaLocal[] = [
  { nome: "atividadeId", tipo: "inteiro" },
  { nome: "sessaoId", tipo: "inteiro" },
  { nome: "codser", tipo: "texto" },
  { nome: "item", tipo: "texto" },
  // `datati` é @db.Date: a data pura em UTC, o dia é o da própria data.
  { nome: "datati", tipo: "data", utc: true },
  { nome: "horario", tipo: "texto" },
  { nome: "duracaoMinutos", tipo: "inteiro" },
  { nome: "desati", tipo: "texto" },
  { nome: "integracao", tipo: "texto" },
];

/** Valor de cada coluna que não é o campo da linha com o mesmo nome. */
export const lerAtividade: LeitorDeValor<ItemAtividade> = (linha, coluna) => {
  if (coluna === "item") return rotuloItem(linha);
  if (coluna === "horario") return horarioDoItem(linha);
  if (coluna === "integracao") return situacaoIntegracaoItem(linha);
  return (linha as unknown as Record<string, unknown>)[coluna];
};
