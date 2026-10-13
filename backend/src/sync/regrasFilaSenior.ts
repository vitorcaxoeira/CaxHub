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
