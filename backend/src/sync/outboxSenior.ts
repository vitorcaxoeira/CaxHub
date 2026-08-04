import cron from "node-cron";
import { randomUUID } from "crypto";
import { Prisma, SincronizacaoPendente } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  formatarDataSenior,
  formatarHoraSenior,
  ideExtItem,
  ideExtRat,
  mensagemDeRecusa,
  registrarAtividadesViaSoap,
  runSqlViaSoap,
  SIS_ORI,
  TIP_EVE,
} from "../soap/client";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";

const JOB_NAME = "outbox_senior-sync";

// Excedido esse número de tentativas, o item para de ser reprocessado sozinho e vira
// "bloqueado" — evita ficar tentando pra sempre contra um canal que ainda não existe.
const MAX_TENTATIVAS = 5;

// Enfileira uma mudança feita no CaxHub que precisa ser propagada de volta pro Senior.
// Só faz sentido enfileirar quando a atividade já tem `seqati` (veio do ERP originalmente)
// — sem isso não há registro no Senior pra atualizar.
// Devolve o id da pendência criada pra quem quiser disparar o envio DELA na hora, sem
// varrer a fila inteira (ver processarFilaSincronizacao).
export async function enfileirar(atividadeId: number, tipo: string, payload: Record<string, unknown>): Promise<number> {
  const criada = await prisma.sincronizacaoPendente.create({
    data: { atividadeId, tipo, payload: payload as Prisma.InputJsonValue },
  });
  return criada.id;
}

// Tipo de mudança que ainda não tem operação publicada do lado do Senior. Tratado
// diferente de uma falha: não consome tentativa, porque o item não fez nada de errado —
// só não existe pra onde mandá-lo ainda. Assim que a operação for publicada, esses itens
// voltam a fluir sozinhos, sem precisar reprocessar um por um.
class CanalIndisponivelError extends Error {}

// O ideExt do cabeçalho é o que faz o Senior ANEXAR o item a uma RAT já criada em vez de
// abrir outra; o do item é a alça pra casar a resposta. Definidos em soap/client.ts junto
// do resto do contrato.

// Identidade que o Senior atribuiu, junto das linhas locais que devem recebê-la.
// `numrat` preenchido é o que trava edição e exclusão do apontamento (ver
// routes/apontamentos.ts e o `editavel` de routes/rats.ts) — por isso o write-back
// precisa ser atômico com a baixa da fila.
interface ResultadoEnvio {
  ratId: number;
  ratItemId: number;
  numrat: number;
  seqrat: number;
}

/** Só a identidade devolvida pelo ERP, antes de saber a quem ela pertence localmente. */
interface IdentidadeSenior {
  numrat: number;
  seqrat: number;
}

// Procura o apontamento direto na origem, pelos mesmos campos que o identificam de forma
// única. Serve pra um caso específico e perigoso: o Senior gravou, mas a resposta se
// perdeu (timeout, queda de rede) e o item ficou marcado como falho aqui. Reenviar às
// cegas duplicaria o apontamento no ERP; então, antes de qualquer RETENTATIVA, pergunta.
// Só é barato porque leitura e escrita moram no mesmo serviço.
async function procurarApontamentoNoSenior(item: {
  codemp: number;
  codpro: number | null;
  seqite: number | null;
  datati: Date;
  horini: number;
  horfim: number;
}): Promise<IdentidadeSenior | null> {
  const filtros = [
    `USU_CODEMP = ${item.codemp}`,
    item.codpro != null ? `USU_CodPro = ${item.codpro}` : null,
    item.seqite != null ? `USU_SeqIte = ${item.seqite}` : null,
    `USU_DATATI = '${item.datati.toISOString().slice(0, 10)}'`,
    `USU_HORINI = ${item.horini}`,
    `USU_HORFIM = ${item.horfim}`,
  ].filter(Boolean);

  const linhas = (await runSqlViaSoap(
    `SELECT USU_NUMRAT AS numrat, USU_SEQRAT AS seqrat FROM USU_TE777IAT WHERE ${filtros.join(" AND ")}`
  )) as { numrat: number; seqrat: number }[];

  if (linhas.length !== 1) return null; // 0 = não existe; >1 = ambíguo, melhor não adivinhar
  return { numrat: Number(linhas[0].numrat), seqrat: Number(linhas[0].seqrat) };
}

// Envia um apontamento confirmado (RatItem) pro Senior e devolve a identidade que o ERP
// atribuiu. NÃO grava nada — o write-back é feito pelo chamador junto com a baixa da fila,
// numa transação só.
async function enviarApontamento(item: SincronizacaoPendente): Promise<ResultadoEnvio> {
  const payload = item.payload as { ratItemId?: number };
  const ratItemId = Number(payload?.ratItemId);
  if (!Number.isFinite(ratItemId)) {
    throw new Error(`Payload sem ratItemId (pendência ${item.id})`);
  }

  // Relê do banco em vez de confiar no payload enfileirado: entre confirmar e enviar, a
  // descrição pode ter sido editada pelo consultor (PATCH /apontamentos/:id).
  const ratItem = await prisma.ratItem.findUnique({ where: { id: ratItemId }, include: { rat: true } });
  if (!ratItem) throw new Error(`RatItem ${ratItemId} não existe mais — apontamento desfeito antes do envio`);
  if (ratItem.datati == null || ratItem.horini == null || ratItem.horfim == null) {
    throw new Error(`RatItem ${ratItemId} sem data/hora — nada a enviar`);
  }
  if (ratItem.rat.codpro == null) throw new Error(`RAT ${ratItem.rat.id} sem codpro — não dá pra registrar`);

  // Já registrado (reprocessamento manual, ou corrida entre o cron e o disparo imediato):
  // devolve o que já existe em vez de mandar de novo.
  if (ratItem.numrat != null && ratItem.seqrat != null) {
    return { ratId: ratItem.ratId, ratItemId: ratItem.id, numrat: ratItem.numrat, seqrat: ratItem.seqrat };
  }

  // Confere na origem ANTES de todo envio, não só nas retentativas. Custa uma leitura
  // pequena por apontamento (volume baixo: alguns por consultor por dia) e elimina de
  // vez a duplicação, que aqui não teria desfazer — o serviço não tem operação de
  // exclusão. `tentativas > 0` não serve como gatilho porque não cobre dois casos reais:
  //   - reprocessar() zera as tentativas, então um item que já foi enviado e travou
  //     voltaria a parecer "primeira tentativa";
  //   - o envio pode ter acontecido fora da fila (script manual de verificação, que de
  //     propósito não faz o write-back local).
  const jaExiste = await procurarApontamentoNoSenior({
    codemp: ratItem.codemp,
    codpro: ratItem.codpro,
    seqite: ratItem.seqite,
    datati: ratItem.datati,
    horini: ratItem.horini,
    horfim: ratItem.horfim,
  });
  if (jaExiste) {
    console.warn(
      `[${JOB_NAME}] apontamento ${ratItemId} já existe no Senior (RAT ${jaExiste.numrat}/${jaExiste.seqrat}) — não reenvia, só reconcilia`
    );
    return { ratId: ratItem.ratId, ratItemId: ratItem.id, ...jaExiste };
  }

  const resposta = await registrarAtividadesViaSoap({
    codEmp: ratItem.codemp,
    codFor: ratItem.rat.codfor,
    codPro: ratItem.rat.codpro,
    ideExt: ideExtRat(ratItem.ratId),
    sisOri: SIS_ORI,
    tipEve: TIP_EVE,
    itens: [
      {
        ideExt: ideExtItem(ratItem.id),
        seqite: ratItem.seqite ?? 0,
        datAti: formatarDataSenior(ratItem.datati),
        horIni: formatarHoraSenior(ratItem.horini),
        horFim: formatarHoraSenior(ratItem.horfim),
        desAti: ratItem.desati ?? "",
      },
    ],
  });

  // Casa pelo ideExt em vez de pegar o primeiro: o serviço aceita lote e nada garante a
  // ordem de volta.
  const meuIdeExtRat = ideExtRat(ratItem.ratId);
  const meuIdeExtItem = ideExtItem(ratItem.id);
  const resultado = resposta.resultados.find((r) => r.ideExt === meuIdeExtRat) ?? resposta.resultados[0];
  const itemRetornado = resultado?.itens.find((i) => i.ideExt === meuIdeExtItem) ?? resultado?.itens[0];

  // A recusa é lida DEPOIS de localizar o item na resposta, porque o motivo específico
  // costuma vir no `msg` dele, não no `mensagemProcesso` geral — e é esse texto que o
  // consultor vê na tela (chega até lá via ultimoErro da pendência).
  const recusa = mensagemDeRecusa(resposta, itemRetornado?.msg);
  if (recusa) throw new Error(recusa);

  if (resultado?.numRat == null || itemRetornado?.seqRat == null) {
    throw new Error(
      `Senior respondeu sucesso mas sem numRat/seqRat (item: ${itemRetornado?.msg ?? "sem detalhe"}) — não dá pra confirmar o registro`
    );
  }

  return { ratId: ratItem.ratId, ratItemId: ratItem.id, numrat: resultado.numRat, seqrat: itemRetornado.seqRat };
}

// Despacha cada mudança pro canal certo. Hoje só apontamento tem operação publicada
// (`registrarAtividades`); os demais tipos esperam sem consumir tentativa.
async function enviarParaSenior(item: SincronizacaoPendente): Promise<ResultadoEnvio | null> {
  if (item.tipo === "criar_apontamento") return enviarApontamento(item);

  throw new CanalIndisponivelError(
    `Ainda não há operação publicada no Senior para "${item.tipo}" — o item fica aguardando na fila`
  );
}

// Processa a fila: tenta enviar cada item pendente, com no máximo MAX_TENTATIVAS.
//
// `apenasId` restringe a uma pendência só. É o que o disparo imediato da confirmação de
// apontamento usa: sem isso, cada confirmação varreria a fila inteira, e os tipos que
// ainda não têm canal ficam `pendente` pra sempre (de propósito, ver CanalIndisponivelError)
// — ou seja, seriam revisitados a cada confirmação, um UPDATE por item, à toa. O cron
// continua chamando sem argumento pra varrer tudo.
export async function processarFilaSincronizacao(opcoes: { apenasId?: number } = {}): Promise<void> {
  const pendentes = await prisma.sincronizacaoPendente.findMany({
    where: {
      status: "pendente",
      tentativas: { lt: MAX_TENTATIVAS },
      ...(opcoes.apenasId != null ? { id: opcoes.apenasId } : {}),
    },
    orderBy: { criadoEm: "asc" },
  });

  let enviados = 0;
  let falhas = 0;
  let semCanal = 0;

  for (const item of pendentes) {
    // Auditoria registra a TENTATIVA de envio, não só sucesso — o evento nasce aqui
    // (processamento assíncrono da fila), não no clique do usuário que originou o
    // SincronizacaoPendente: o correlationId é por item processado, não pela ação
    // original. codemp/codpro vêm da atividade (denormalização do proposta_id).
    const atividade = await prisma.atividadeConsultor.findUnique({ where: { id: item.atividadeId } });
    const entidadeId = entidadeIdAtividade(item.atividadeId);
    const entidadeRotulo = atividade ? `Atividade — Proposta ${atividade.codpro}` : `Atividade ${item.atividadeId}`;
    const correlationId = randomUUID();
    const payloadResumo = JSON.stringify(item.payload).slice(0, 1000);
    const inicioEnvio = Date.now();

    try {
      // Marca "enviando" ANTES da chamada. Isso fecha a janela em que o consultor
      // conseguiria excluir o apontamento com a requisição em voo: o DELETE de
      // routes/apontamentos.ts só permite desfazer enquanto a pendência está "pendente",
      // e o registro nasceria órfão no ERP se a exclusão passasse no meio do envio.
      await prisma.sincronizacaoPendente.update({ where: { id: item.id }, data: { status: "enviando" } });

      const registrado = await enviarParaSenior(item);
      const duracaoMs = Date.now() - inicioEnvio;

      // O write-back vai na MESMA transação que baixa a fila: ou o apontamento fica
      // marcado como registrado e a pendência fecha, ou nenhum dos dois. É o que impede
      // um item de ficar "enviado" sem numrat (e portanto ainda excluível na tela).
      await prisma.$transaction([
        ...(registrado
          ? [
              prisma.rat.update({ where: { id: registrado.ratId }, data: { numrat: registrado.numrat } }),
              prisma.ratItem.update({
                where: { id: registrado.ratItemId },
                data: { numrat: registrado.numrat, seqrat: registrado.seqrat, datreg: new Date() },
              }),
            ]
          : []),
        prisma.sincronizacaoPendente.update({
          where: { id: item.id },
          data: { status: "enviado", processadoEm: new Date(), ultimoErro: null },
        }),
        criarEventoAuditoria({
          origem: "job",
          codemp: atividade?.codemp ?? null,
          codpro: atividade?.codpro ?? null,
          entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
          entidadeId,
          entidadeRotulo,
          eventoTipo: EVENTOS_AUDITORIA.ATIVIDADE_ENVIADA_SENIOR,
          alteracoes: null,
          metadata: { tipo: item.tipo, payload: payloadResumo, sucesso: true, duracaoMs },
          correlationId,
        }),
      ]);
      enviados += 1;
    } catch (error) {
      const duracaoMs = Date.now() - inicioEnvio;
      const message = error instanceof Error ? error.message : String(error);

      // Tipo ainda sem operação publicada: devolve pra fila do jeito que estava, SEM
      // consumir tentativa e sem evento de auditoria (não houve tentativa de verdade).
      // Sem isso, esses itens queimariam as 5 tentativas e virariam "bloqueado" — foi
      // assim que os 43 itens travados de julho/2026 nasceram, quando não havia canal
      // nenhum. Quando a operação for publicada, eles fluem sozinhos.
      if (error instanceof CanalIndisponivelError) {
        await prisma.sincronizacaoPendente.update({
          where: { id: item.id },
          data: { status: "pendente", ultimoErro: message },
        });
        semCanal += 1;
        continue;
      }

      const tentativas = item.tentativas + 1;
      await prisma.$transaction([
        prisma.sincronizacaoPendente.update({
          where: { id: item.id },
          data: {
            tentativas,
            ultimoErro: message,
            status: tentativas >= MAX_TENTATIVAS ? "bloqueado" : "pendente",
          },
        }),
        criarEventoAuditoria({
          origem: "job",
          codemp: atividade?.codemp ?? null,
          codpro: atividade?.codpro ?? null,
          entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
          entidadeId,
          entidadeRotulo,
          eventoTipo: EVENTOS_AUDITORIA.ATIVIDADE_ENVIADA_SENIOR,
          alteracoes: null,
          metadata: { tipo: item.tipo, payload: payloadResumo, sucesso: false, erro: message, duracaoMs },
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
        message:
          `${enviados} enviado(s), ${falhas} falha(s)` +
          (semCanal > 0 ? `, ${semCanal} aguardando canal` : ""),
      },
    });
  }
}

// Reseta um item bloqueado pra pendente/0 tentativas, pra tentar de novo manualmente
// (usado pelo endpoint admin de reprocessar em backend/src/routes/sincronizacao.ts).
export async function reprocessar(id: number): Promise<void> {
  await prisma.sincronizacaoPendente.update({
    where: { id },
    data: { status: "pendente", tentativas: 0, ultimoErro: null },
  });
}

export function scheduleOutboxSeniorSync(): void {
  // Arrow em vez de passar a função direto: o node-cron chama o callback com a data da
  // execução, que seria interpretada como o objeto de opções. Aqui a varredura é sempre
  // da fila inteira — é a rede de segurança do que o disparo imediato não conseguiu.
  cron.schedule("*/15 * * * *", () => processarFilaSincronizacao());
}
