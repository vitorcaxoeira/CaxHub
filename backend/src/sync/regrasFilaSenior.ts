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
//   - editar apontamento (tipEve A): `enviarEdicaoApontamento` lê a linha antes e, se ela já tem os
//     valores novos, não envia — repetir o "A" grava os mesmos valores;
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

// ---------------------------------------------------------------------------
// Edição de apontamento já registrado (tipEve A em `registrarAtividades`).
//
// O Senior localiza a linha da IAT pelo `ideExt` do item, e não há como o CaxHub provar de fora que ele
// acertou a linha. Por isso o envio é cercado por duas leituras da RAT inteira na IAT: antes, para
// conferir que a linha existe e a RAT segue Digitada; depois, para provar que a nossa linha ficou com
// os valores enviados e que NENHUMA irmã mudou. Foi a falta dessa prova que deixou o "Alterar" de
// alocação gravar nas horas de outra alocação três vezes (out/2026) antes de alguém notar.
// ---------------------------------------------------------------------------

export interface LinhaIatSenior {
  seqrat: number;
  /** AAAA-MM-DD */
  datati: string | null;
  horini: number | null;
  horfim: number | null;
  desati: string;
}

export interface ValoresApontamento {
  datati: string;
  horini: number;
  horfim: number;
  desati: string;
}

const SITRAT_DIGITADO = 9;
const normalizarTexto = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function linhaTemOsValores(linha: LinhaIatSenior, v: ValoresApontamento): boolean {
  return (
    (linha.datati ?? "").slice(0, 10) === v.datati &&
    linha.horini === v.horini &&
    linha.horfim === v.horfim &&
    normalizarTexto(linha.desati) === normalizarTexto(v.desati)
  );
}

// Antes de enviar o "A": a linha tem de existir (uma vez só) e a RAT tem de seguir Digitada no Senior —
// a situação local pode estar atrasada em relação ao ERP. Devolve o motivo do bloqueio, ou null.
export function motivoBloqueioAntesDeAlterarApontamento(
  linhas: LinhaIatSenior[],
  sitratNoSenior: number | null,
  seqrat: number,
  numrat: number
): string | null {
  const nossas = linhas.filter((l) => l.seqrat === seqrat);
  if (nossas.length === 0) {
    return `O apontamento (RAT ${numrat}/${seqrat}) não existe mais no Senior — nada a alterar. Use "Sinc. ERP" na RAT para desvincular.`;
  }
  if (nossas.length > 1) {
    return `A consulta ao Senior devolveu a linha ${numrat}/${seqrat} mais de uma vez — ambíguo, nada foi enviado.`;
  }
  if (sitratNoSenior !== SITRAT_DIGITADO) {
    return `No Senior a RAT ${numrat} não está mais Digitada (situação ${sitratNoSenior ?? "desconhecida"}) — a alteração não foi enviada.`;
  }
  return null;
}

// Depois do "A": nossa linha com os valores enviados e todas as outras linhas da RAT idênticas ao antes.
export function motivoDivergenciaAposAlterarApontamento(
  antes: LinhaIatSenior[],
  depois: LinhaIatSenior[],
  seqrat: number,
  numrat: number,
  esperado: ValoresApontamento
): string | null {
  const nossa = depois.find((l) => l.seqrat === seqrat);
  if (!nossa || !linhaTemOsValores(nossa, esperado)) {
    return (
      `O Senior respondeu sucesso, mas a linha ${numrat}/${seqrat} não ficou com os valores enviados. ` +
      `Nada será reenviado automaticamente — confira o apontamento no Senior.`
    );
  }
  for (const irma of antes.filter((l) => l.seqrat !== seqrat)) {
    const agora = depois.find((l) => l.seqrat === irma.seqrat);
    const igual =
      agora != null &&
      (agora.datati ?? "").slice(0, 10) === (irma.datati ?? "").slice(0, 10) &&
      agora.horini === irma.horini &&
      agora.horfim === irma.horfim &&
      normalizarTexto(agora.desati) === normalizarTexto(irma.desati);
    if (!igual) {
      return (
        `O Senior alterou também a linha ${numrat}/${irma.seqrat}, que não era a deste apontamento. ` +
        `Nada será reenviado automaticamente — confira e restaure essa linha no Senior.`
      );
    }
  }
  return null;
}
