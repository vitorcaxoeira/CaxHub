import cron from "node-cron";
import { randomUUID } from "crypto";
import { SincronizacaoPendenteProposta } from "@prisma/client";
import { escritaNoSeniorDesligada } from "../config/sistemaSenior";
import { prisma } from "../db/prisma";
import {
  ManterSituacaoPropostaPayload,
  manterSituacaoPropostaViaSoap,
  montarEnvelopeManterSituacaoProposta,
} from "../soap/client";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdProposta } from "../audit/identidadeEntidade";
import { sitproLabel } from "../domain/propostasDominio";
import { SITRAT_BLOQUEIA_FINALIZAR } from "../domain/gestaoPropostasSql";
import { criarFilaUnica } from "./filaUnica";

// Fila de saída das mudanças de SITUAÇÃO de proposta feitas na tela Gestão Propostas (09/11/2026). Fila IRMÃ de outboxSenior.ts e
// outboxSeniorDespesa.ts: a chave é a proposta (codemp+codpro), não uma atividade. Mesmas regras da casa:
//  - a rota que pede a mudança só GRAVA A PENDÊNCIA; `propostas.sitpro` não muda ali (nada de write otimista);
//  - o banco local só muda DEPOIS que o Senior confirma (statusProcesso = 1), na mesma transação que baixa a fila;
//  - uma varredura por vez, e a pendência é reservada ("enviando") antes da chamada;
//  - tentativas limitadas (MAX_TENTATIVAS), depois "bloqueado" até alguém reprocessar.

const JOB_NAME = "outbox_senior_proposta-sync";
const MAX_TENTATIVAS = 5;

export const TIPO_FINALIZAR_PROPOSTA = "finalizar_proposta";
export const TIPO_REABRIR_EXECUCAO_PROPOSTA = "reabrir_execucao_proposta";

/**
 * A operação `ManterSituacaoProposta` está publicada no Senior e o contrato foi conferido no WSDL/XSD (soap/client.ts). Desde 10/11/2026 o envio NÃO tem
 * mais interruptor próprio (a variável SENIOR_PORTA_SITPRO foi aposentada por decisão do Vitor): a fila envia sempre que a escrita no Senior está ligada.
 * A única trava que sobra é a geral, `SENIOR_SOMENTE_LEITURA` (escritaNoSeniorDesligada): com ela ligada nada sai e as pendências esperam SEM gastar tentativa
 * (gastar levaria as 5 e bloquearia por um motivo que não é erro, a lição dos itens travados de julho/2026, CanalIndisponivelError em outboxSenior.ts).
 */
export function envioDeSituacaoLigado(): boolean {
  return !escritaNoSeniorDesligada();
}

export const AVISO_ESCRITA_DESLIGADA =
  "Aguardando: a escrita no Senior está desligada neste ambiente (SENIOR_SOMENTE_LEITURA). A pendência segue na fila.";
// Textos que pendências criadas ANTES de 10/11/2026 já têm gravados (quando existia o interruptor SENIOR_PORTA_SITPRO): continuam valendo como espera.
const AVISO_PORTA_LEGADO =
  "Aguardando a publicação da operação alterarSituacaoProposta no Senior (SENIOR_PORTA_SITPRO desligada). A pendência segue na fila.";
const AVISO_PORTA_LEGADO_2 =
  "Aguardando: o envio da situação ao Senior (operação ManterSituacaoProposta) está desligado neste ambiente (SENIOR_PORTA_SITPRO). A pendência segue na fila.";

/** O `ultimoErro` é só um aviso de espera (a fila ainda não pode enviar), não uma falha de envio? A tela mostra "Aguardando ERP" em vez de erro. */
export function ehAvisoDeEspera(ultimoErro: string | null | undefined): boolean {
  return !ultimoErro || ultimoErro === AVISO_PORTA_LEGADO || ultimoErro === AVISO_PORTA_LEGADO_2 || ultimoErro === AVISO_ESCRITA_DESLIGADA;
}

export interface NovaPendenciaSituacao {
  codemp: number;
  codpro: number;
  tipo: typeof TIPO_FINALIZAR_PROPOSTA | typeof TIPO_REABRIR_EXECUCAO_PROPOSTA;
  sitproDe: number | null;
  sitproPara: number;
  usuarioId?: number | null;
}

/** Grava a pendência e tenta o envio na hora (fire-and-forget); com a porta desligada, o envio imediato só deixa o aviso na pendência. */
export async function enfileirarSituacaoProposta(nova: NovaPendenciaSituacao): Promise<number> {
  const criada = await prisma.sincronizacaoPendenteProposta.create({
    data: {
      codemp: nova.codemp,
      codpro: nova.codpro,
      tipo: nova.tipo,
      sitproDe: nova.sitproDe,
      sitproPara: nova.sitproPara,
      payload: { codEmp: nova.codemp, codPro: nova.codpro, sitPro: nova.sitproPara },
      usuarioId: nova.usuarioId ?? null,
    },
  });
  processarFilaSituacaoProposta({ apenasId: criada.id }).catch((erro) => {
    console.error("[outbox-proposta] envio imediato falhou:", erro instanceof Error ? erro.message : erro);
  });
  return criada.id;
}

/** Há uma mudança de situação desta proposta a caminho do Senior (pendente ou enviando)? Usado para recusar uma segunda ação (409). */
export async function pendenciaDeSituacaoEmAndamento(codemp: number, codpro: number) {
  return prisma.sincronizacaoPendenteProposta.findFirst({
    where: { codemp, codpro, status: { in: ["pendente", "enviando"] } },
    orderBy: { id: "desc" },
  });
}

/** O que seria enviado agora para esta pendência, relido do dado vivo (nunca do `payload` congelado). */
function payloadDe(item: Pick<SincronizacaoPendenteProposta, "codemp" | "codpro" | "sitproPara">): ManterSituacaoPropostaPayload {
  return { codEmp: item.codemp, codPro: item.codpro, sitPro: item.sitproPara };
}

/** Erro de pré-condição: repetir não adianta (a situação mudou por fora, ou apareceu RAT que impede finalizar). Bloqueia na hora. */
class PreCondicaoDaSituacaoError extends Error {}

const emFilaUnica = criarFilaUnica();

export function processarFilaSituacaoProposta(opcoes: { apenasId?: number; apenasIds?: number[] } = {}): Promise<void> {
  return emFilaUnica(() => varrerFila(opcoes));
}

async function varrerFila(opcoes: { apenasId?: number; apenasIds?: number[] }): Promise<void> {
  const ids = opcoes.apenasIds ?? (opcoes.apenasId != null ? [opcoes.apenasId] : undefined);

  // Somente leitura (SENIOR_SOMENTE_LEITURA): nada sai; os itens ficam "pendente" e NÃO gastam tentativa. O motivo fica à vista na tela (selo "Aguardando
  // ERP" + title) pelo `ultimoErro`, que só recebe o aviso se estiver vazio (não apaga uma falha real).
  if (!envioDeSituacaoLigado()) {
    console.warn("[outbox-proposta] escrita no Senior desligada (SENIOR_SOMENTE_LEITURA): fila não enviada");
    await prisma.sincronizacaoPendenteProposta.updateMany({
      where: { status: "pendente", ultimoErro: null, ...(ids != null ? { id: { in: ids } } : {}) },
      data: { ultimoErro: AVISO_ESCRITA_DESLIGADA },
    });
    return;
  }

  const pendentes = await prisma.sincronizacaoPendenteProposta.findMany({
    where: { status: "pendente", tentativas: { lt: MAX_TENTATIVAS }, ...(ids != null ? { id: { in: ids } } : {}) },
    orderBy: { criadoEm: "asc" },
  });

  let enviados = 0;
  let falhas = 0;

  for (const item of pendentes) {
    const entidadeId = entidadeIdProposta(item.codemp, item.codpro);
    const entidadeRotulo = `Proposta ${item.codemp}/${item.codpro}`;
    const correlationId = randomUUID();
    const inicioEnvio = Date.now();
    try {
      // Reserva (não só marca): só segue quem trocou "pendente" por "enviando"; se outra varredura já pegou, pula.
      const reserva = await prisma.sincronizacaoPendenteProposta.updateMany({
        where: { id: item.id, status: "pendente" },
        data: { status: "enviando" },
      });
      if (reserva.count === 0) continue;

      // Relê a proposta: o payload congelado no pedido pode estar velho (a pendência pode ter esperado dias pela porta).
      const proposta = await prisma.proposta.findUnique({
        where: { codemp_codpro: { codemp: item.codemp, codpro: item.codpro } },
        select: { sitpro: true, removidoEmSenior: true },
      });
      if (!proposta) throw new PreCondicaoDaSituacaoError("A proposta não existe mais no CaxHub.");
      if (proposta.removidoEmSenior != null) throw new PreCondicaoDaSituacaoError("A proposta foi excluída no Senior.");

      const jaNoDestino = proposta.sitpro === item.sitproPara;
      if (!jaNoDestino) {
        // A premissa do pedido era a situação de origem. Se ela mudou por fora, o pedido não vale mais.
        if (item.sitproDe != null && proposta.sitpro !== item.sitproDe) {
          throw new PreCondicaoDaSituacaoError(
            `A situação da proposta mudou desde o pedido (era "${sitproLabel(item.sitproDe)}", agora "${sitproLabel(proposta.sitpro)}"). Refaça a ação na tela.`,
          );
        }
        // Finalizar: a regra das RATs vale no ENVIO também, não só no clique (a pendência pode ter esperado pela porta).
        if (item.tipo === TIPO_FINALIZAR_PROPOSTA) {
          const bloqueando = await prisma.rat.count({
            where: { codemp: item.codemp, codpro: item.codpro, removidoEmSenior: null, sitrat: { in: [...SITRAT_BLOQUEIA_FINALIZAR] } },
          });
          if (bloqueando > 0) {
            throw new PreCondicaoDaSituacaoError(`Há ${bloqueando} RAT(s) Digitada(s) ou Fechada(s) nesta proposta — finalize-as antes de finalizar a proposta.`);
          }
        }
        const resposta = await manterSituacaoPropostaViaSoap(payloadDe(item));
        if (resposta.statusProcesso !== 1) {
          throw new Error(
            `Senior recusou a mudança de situação (statusProcesso=${resposta.statusProcesso}): ${resposta.mensagemProcesso ?? resposta.erroExecucao ?? "sem mensagem"}`,
          );
        }
      }
      const duracaoMs = Date.now() - inicioEnvio;

      // Write-back na MESMA transação que baixa a fila: ou a proposta ganha a situação e a pendência fecha, ou nenhum dos dois. Já no destino
      // (o sync de entrada trouxe antes, ou um envio anterior confirmou sem fechar a fila) só baixa a fila: a auditoria da mudança já saiu.
      await prisma.$transaction([
        ...(jaNoDestino
          ? []
          : [
              prisma.proposta.update({
                where: { codemp_codpro: { codemp: item.codemp, codpro: item.codpro } },
                data: { sitpro: item.sitproPara },
              }),
              // MESMO evento e MESMO formato de metadata do sync de entrada (sync/propostaSync.ts): a aba Auditoria da proposta mostra as
              // duas origens na mesma linha do tempo; o que as diferencia é `origem` ("job" aqui, "integracao_senior" lá).
              criarEventoAuditoria({
                origem: "job",
                usuarioId: item.usuarioId,
                codemp: item.codemp,
                codpro: item.codpro,
                entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA,
                entidadeId,
                entidadeRotulo,
                eventoTipo: EVENTOS_AUDITORIA.PROPOSTA_STATUS_ALTERADO,
                alteracoes: { sitpro: { de: item.sitproDe, para: item.sitproPara, rotulo: "Situação" } },
                metadata: {
                  status_de: sitproLabel(item.sitproDe),
                  status_para: sitproLabel(item.sitproPara),
                  tipo: item.tipo,
                  duracaoMs,
                },
                correlationId,
              }),
            ]),
        prisma.sincronizacaoPendenteProposta.update({
          where: { id: item.id },
          data: { status: "enviado", processadoEm: new Date(), ultimoErro: null },
        }),
      ]);
      enviados += 1;
    } catch (error) {
      const duracaoMs = Date.now() - inicioEnvio;
      const message = error instanceof Error ? error.message : String(error);
      const tentativas = item.tentativas + 1;
      const bloqueioImediato = error instanceof PreCondicaoDaSituacaoError;
      await prisma.$transaction([
        prisma.sincronizacaoPendenteProposta.update({
          where: { id: item.id },
          data: { tentativas, ultimoErro: message, status: bloqueioImediato || tentativas >= MAX_TENTATIVAS ? "bloqueado" : "pendente" },
        }),
        criarEventoAuditoria({
          origem: "job",
          usuarioId: item.usuarioId,
          codemp: item.codemp,
          codpro: item.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA,
          entidadeId,
          entidadeRotulo,
          eventoTipo: EVENTOS_AUDITORIA.PROPOSTA_SITUACAO_SOLICITADA,
          alteracoes: null,
          metadata: {
            tipo: item.tipo,
            de: sitproLabel(item.sitproDe),
            para: sitproLabel(item.sitproPara),
            sucesso: false,
            erro: message,
            duracaoMs,
          },
          correlationId,
        }),
      ]);
      falhas += 1;
    }
  }

  if (pendentes.length > 0) {
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: `${pendentes.length} item(ns) na fila`,
        status: falhas > 0 ? "error" : "success",
        message: `${enviados} enviado(s), ${falhas} falha(s)`,
      },
    });
  }
}

export interface PreviewEnvioSituacaoProposta {
  payload: ManterSituacaoPropostaPayload;
  envelopeXml: string;
}

/** Reconstrói, SEM chamar o Senior, o que seria enviado agora para esta pendência (usuário e senha mascarados). */
export function previewEnvioSituacaoProposta(item: SincronizacaoPendenteProposta): PreviewEnvioSituacaoProposta {
  const payload = payloadDe(item);
  return { payload, envelopeXml: montarEnvelopeManterSituacaoProposta(payload, "***", "***") };
}

/** Reseta uma pendência bloqueada para pendente/0 tentativas, para tentar de novo manualmente. */
export async function reprocessarSituacaoProposta(id: number): Promise<void> {
  await prisma.sincronizacaoPendenteProposta.update({
    where: { id },
    data: { status: "pendente", tentativas: 0, ultimoErro: null },
  });
}

// Chamada no boot (server.ts), antes de agendar o cron: um único processo envia, então "enviando" ao subir é pendência órfã de um reinício no meio
// do envio. Volta para a fila; o reenvio é seguro porque a rotina confere a situação da proposta antes de chamar o Senior (jaNoDestino).
export async function recuperarEnviosSituacaoInterrompidos(): Promise<number> {
  const resultado = await prisma.sincronizacaoPendenteProposta.updateMany({
    where: { status: "enviando" },
    data: {
      status: "pendente",
      ultimoErro: "Envio interrompido por reinício do servidor — a confirmação do Senior não chegou. O reenvio confere a situação da proposta antes de enviar.",
    },
  });
  if (resultado.count > 0) {
    console.warn(`[${JOB_NAME}] ${resultado.count} envio(s) de situação interrompido(s) por reinício voltaram pra fila`);
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: "recuperação de envios interrompidos",
        status: "success",
        message: `${resultado.count} voltaram pra fila — mudanças de situação que estavam "enviando" quando o servidor reiniciou`,
      },
    });
  }
  return resultado.count;
}

export function scheduleOutboxSeniorPropostaSync(): void {
  // Mesma cadência das outras filas — rede de segurança para o que o disparo imediato não conseguiu.
  cron.schedule("*/15 * * * *", () => processarFilaSituacaoProposta());
}
