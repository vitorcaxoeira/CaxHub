// Regras de decisão da fila de envio ao Senior que não dependem de banco nem de rede. Ficam à parte
// de outboxSenior.ts pra serem testáveis sem subir Prisma/SOAP.

// Âncora da RAT de um apontamento: em qual RAT do Senior o item deve entrar.
//   - RAT local já com número: manda `numRat` (é a RAT que quem confirmou escolheu).
//   - RAT local sem número, mas o Senior já tem uma Digitada criada por ela (achada pelo ideExt do
//     cabeçalho): manda o `numRat` dessa. É o caso da resposta perdida do 1º envio de uma RAT nova
//     (13/10/2026): o Senior gravou, a resposta não chegou, e pedir `gerRat=S` de novo abriria uma
//     segunda RAT pro mesmo cabeçalho local.
//   - Senão: `gerRat=S`, RAT nova.
export type AncoraRat = { numRat: number; deSenior: boolean; ambigua: boolean } | { gerRat: "S" };

export function escolherAncoraRat(numratLocal: number | null, numratsNoSenior: number[]): AncoraRat {
  if (numratLocal != null) return { numRat: numratLocal, deSenior: false, ambigua: false };
  const candidatos = [...new Set(numratsNoSenior.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  if (candidatos.length === 0) return { gerRat: "S" };
  // Mais de uma Digitada pro mesmo cabeçalho local = a divisão que este controle quer evitar já
  // aconteceu; fica com a mais antiga (menor número) e deixa o rastro da ambiguidade pro chamador.
  return { numRat: candidatos[0], deSenior: true, ambigua: candidatos.length > 1 };
}

// Pra onde volta uma pendência que ficou presa em "enviando" porque o servidor reiniciou no meio do
// envio. Só é seguro repetir o envio quando repetir não cria nada de novo no Senior:
//   - apontamento: `procurarApontamentoNoSenior` confere antes de enviar;
//   - fechar RAT: fechar uma RAT já fechada não muda nada;
//   - remover alocação: excluir de novo é a intenção;
//   - criar/editar alocação: sem `seqAti` local o envio cria a alocação, e não há conferência
//     equivalente à do apontamento, então reenviar duplicaria. Vai pra "bloqueado" e a pessoa decide.
export type DestinoPosReinicio = "pendente" | "bloqueado";

export function destinoDaPendenciaInterrompida(tipo: string, seqatiDaAlocacao: bigint | null): DestinoPosReinicio {
  if (tipo === "criar_atividade" || tipo === "editar_atividade") {
    return seqatiDaAlocacao != null && seqatiDaAlocacao > 0n ? "pendente" : "bloqueado";
  }
  return "pendente";
}

export const MOTIVO_ENVIO_INTERROMPIDO =
  "Envio interrompido por reinício do servidor — a confirmação do Senior não chegou. Reenvio confere no Senior antes de gravar.";

export const MOTIVO_ENVIO_INTERROMPIDO_BLOQUEADO =
  "Envio interrompido por reinício do servidor e não há como saber se o Senior gravou a alocação — confira no Senior antes de reprocessar.";

// "Alterar" (tipEve A) sem `seqAti` só é seguro quando o consultor não tem outra alocação no mesmo
// item. Com uma irmã já confirmada, o Senior aplicou o "Alterar" NELA e devolveu o seqAti dela
// (23/10/2026, proposta 8638, item 3: a alocação 461252, nova, gravou as horas em cima da 6474, que
// já estava 100% realizada). Devolve o motivo do bloqueio, ou null quando pode enviar.
export function motivoBloqueioAlterarSemSeqAti(seqatisDasIrmas: (bigint | null)[]): string | null {
  const confirmadas = [...new Set(seqatisDasIrmas.filter((s): s is bigint => s != null && s > 0n))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  if (confirmadas.length === 0) return null;
  return (
    `Alocação ainda sem confirmação do Senior e o consultor já tem outra neste item (seqAti ${confirmadas.join(", ")}). ` +
    `Um "Alterar" sem seqAti gravaria as horas nessa outra alocação, por isso não foi enviado. ` +
    `Confira no Senior e reprocesse a criação desta alocação.`
  );
}

// O Senior respondeu sucesso, mas o seqAti devolvido já pertence a outra alocação local: ele gravou
// numa alocação existente em vez de criar esta. Não adianta reenviar (cada reenvio grava de novo na
// mesma), então a pendência vai direto pra "bloqueado" com este motivo.
export function motivoSeqAtiDeOutraAlocacao(
  seqAti: number,
  dona: { id: number; estruturaAtividadeId: number | null; sitreg: string | null }
): string {
  const ondeEsta = dona.estruturaAtividadeId != null ? ` (Est. ${dona.estruturaAtividadeId})` : "";
  const inativa = dona.sitreg === "I" ? ", hoje inativa no CaxHub" : "";
  return (
    `O Senior devolveu o seqAti ${seqAti}, que já pertence à alocação ${dona.id}${ondeEsta}${inativa}: ` +
    `ele gravou nessa alocação em vez de criar esta. Confira as horas da alocação ${seqAti} no Senior antes de reprocessar.`
  );
}
