import cron from "node-cron";
import { randomUUID } from "crypto";
import { RegistroDespesaViagem, SincronizacaoPendenteDespesa } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  formatarDataSenior,
  ideExtDespesa,
  ItemDespesaSenior,
  ManterItemDespesaPayload,
  manterItemDespesaViaSoap,
  mensagemDeRecusa,
  montarEnvelopeManterItemDespesa,
  runSqlViaSoap,
  SIS_ORI,
  TIP_EVE_ALTERAR,
  TIP_EVE_EXCLUIR,
  TIP_EVE_INCLUIR,
} from "../soap/client";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdDespesa } from "../audit/identidadeEntidade";

const JOB_NAME = "outbox_senior_despesa-sync";

// Mesmo limite de sync/outboxSenior.ts — excedido, o item para de ser reprocessado sozinho e
// vira "bloqueado", evita ficar tentando pra sempre.
const MAX_TENTATIVAS = 5;

// Enfileira uma pendência de despesa com o `tipo` pedido e dispara o envio na hora
// (fire-and-forget, mesmo espírito de enfileirar() em outboxSenior.ts) — quem chama não
// precisa esperar a rede nem lembrar do cron. Base compartilhada pelos 3 helpers exportados
// abaixo (inclusão/edição/exclusão) — únicos que variam é o `tipo`, que decide o tipEve
// montado em enviarDespesa.
async function enfileirarComTipo(despesaId: number, tipo: string, opcoes: { adiarEnvio?: boolean } = {}): Promise<number> {
  const criada = await prisma.sincronizacaoPendenteDespesa.create({
    data: { despesaId, tipo, payload: { despesaId } },
  });
  if (!opcoes.adiarEnvio) {
    processarFilaDespesas({ apenasId: criada.id }).catch((erro) => {
      console.error(`[outbox-despesa] envio imediato (${tipo}) falhou:`, erro instanceof Error ? erro.message : erro);
    });
  }
  return criada.id;
}

/** Despesa recém-lançada no CaxHub (POST /rats/:id/despesas) — tipEve I. */
export async function enfileirarDespesa(despesaId: number, opcoes: { adiarEnvio?: boolean } = {}): Promise<number> {
  return enfileirarComTipo(despesaId, "enviar_despesa", opcoes);
}

/** Despesa já registrada no Senior, editada aqui (PATCH /rats/despesas/:id) — tipEve A + seqRdv. */
export async function enfileirarEdicaoDespesa(despesaId: number, opcoes: { adiarEnvio?: boolean } = {}): Promise<number> {
  return enfileirarComTipo(despesaId, "editar_despesa", opcoes);
}

/** Despesa já registrada no Senior, excluída aqui (DELETE /rats/despesas/:id) — tipEve E + seqRdv. */
export async function enfileirarExclusaoDespesa(despesaId: number, opcoes: { adiarEnvio?: boolean } = {}): Promise<number> {
  return enfileirarComTipo(despesaId, "excluir_despesa", opcoes);
}

// Usado pelas rotas de editar/excluir (rats.ts) pra recusar a ação com 409 enquanto o envio
// anterior ainda está em voo — mesma janela que `enviarApontamento`/`processarFilaSincronizacao`
// fecham marcando "enviando" antes da chamada SOAP.
export async function pendenciaEmAndamento(despesaId: number): Promise<boolean> {
  const emAndamento = await prisma.sincronizacaoPendenteDespesa.findFirst({ where: { despesaId, status: "enviando" } });
  return emAndamento != null;
}

/** RegistroDespesaViagem já validado — o que `montarPayloadDespesa` exige. */
interface DespesaPronta {
  id: number;
  codemp: number;
  numrat: number;
  seqrdv: number | null;
  datemi: Date;
  desrdv: string;
  tipdes: number;
  moddes: string | null;
  qtdrdv: number;
  vlrunt: number;
  fatrdv: string;
  rotid: number | null;
}

function despesaPronta(despesa: RegistroDespesaViagem): DespesaPronta {
  if (despesa.datemi == null) throw new Error(`Despesa ${despesa.id} sem datemi — nada a enviar`);
  if (despesa.desrdv == null) throw new Error(`Despesa ${despesa.id} sem desrdv — nada a enviar`);
  if (despesa.tipdes == null) throw new Error(`Despesa ${despesa.id} sem tipdes — nada a enviar`);
  if (despesa.qtdrdv == null) throw new Error(`Despesa ${despesa.id} sem qtdrdv — nada a enviar`);
  if (despesa.vlrunt == null) throw new Error(`Despesa ${despesa.id} sem vlrunt — nada a enviar`);
  if (despesa.fatrdv == null) throw new Error(`Despesa ${despesa.id} sem fatrdv — nada a enviar`);
  return {
    id: despesa.id,
    codemp: despesa.codemp,
    numrat: despesa.numrat,
    seqrdv: despesa.seqrdv,
    datemi: despesa.datemi,
    desrdv: despesa.desrdv,
    tipdes: despesa.tipdes,
    moddes: despesa.moddes,
    qtdrdv: despesa.qtdrdv,
    vlrunt: Number(despesa.vlrunt),
    fatrdv: despesa.fatrdv,
    rotid: despesa.rotid,
  };
}

/** Quais campos entram no payload — `seqRdv` só faz sentido quando a despesa já existe lá (editar/excluir). */
interface OpcoesPayloadDespesa {
  incluirSeqRdv: boolean;
}

// Monta o payload de `ManterItemDespesa` a partir da despesa já validada. Isolado à parte pra
// ser a MESMA função usada no envio real (enviarDespesa) e na prévia sem envio
// (previewEnvioDespesa) — mesmo princípio de montarPayloadApontamento em outboxSenior.ts.
// `tipEve`/`opcoes` variam por tipo de pendência (enviar/editar/excluir), ver os 3 chamadores
// de enviarDespesa mais abaixo — mesmo espírito de montarPayloadAlocacao em outboxSenior.ts.
export function montarPayloadDespesa(despesa: DespesaPronta, tipEve: string, opcoes: OpcoesPayloadDespesa): ManterItemDespesaPayload {
  const item: ItemDespesaSenior = {
    ideExt: ideExtDespesa(despesa.id),
    datRdv: formatarDataSenior(despesa.datemi),
    desRdv: despesa.desrdv,
    tipDes: despesa.tipdes,
    ...(despesa.moddes != null ? { modDes: despesa.moddes } : {}),
    qtdRdv: despesa.qtdrdv,
    vlrUni: despesa.vlrunt,
    fatRdv: despesa.fatrdv,
    ...(despesa.rotid != null ? { idRota: despesa.rotid } : {}),
    ...(opcoes.incluirSeqRdv && despesa.seqrdv != null ? { seqRdv: despesa.seqrdv } : {}),
    tipEve,
  };
  return {
    codEmp: despesa.codemp,
    numRat: despesa.numrat,
    sisOri: SIS_ORI,
    despesas: [item],
  };
}

/** Só a identidade devolvida pelo ERP. */
interface IdentidadeSeniorDespesa {
  seqrdv: number;
}

// Procura a despesa direto na origem, pelos mesmos campos que a identificam de forma única.
// Mesmo motivo de procurarApontamentoNoSenior em outboxSenior.ts: o Senior pode ter gravado e a
// resposta se perdido (timeout, queda de rede) — reenviar às cegas duplicaria a despesa no ERP.
// Só usada na INCLUSÃO — editar/excluir já têm `seqRdv` confiável, não precisam adivinhar.
// Mesma limitação aceita lá: duas despesas idênticas (mesmo tipo/valor/dia) na mesma RAT colidem
// e esta busca não desempata — aceitável, é o mesmo risco já assumido no apontamento.
async function procurarDespesaNoSenior(despesa: DespesaPronta): Promise<IdentidadeSeniorDespesa | null> {
  const filtros = [
    `USU_CODEMP = ${despesa.codemp}`,
    `USU_NUMRAT = ${despesa.numrat}`,
    `USU_TIPDES = ${despesa.tipdes}`,
    `USU_DATEMI = '${despesa.datemi.toISOString().slice(0, 10)}'`,
    `USU_QTDRDV = ${despesa.qtdrdv}`,
    `USU_VLRUNT = ${despesa.vlrunt}`,
  ];

  const linhas = (await runSqlViaSoap(
    `SELECT USU_SEQRDV AS seqrdv FROM USU_TE777RDV WHERE ${filtros.join(" AND ")}`
  )) as { seqrdv: number }[];

  if (linhas.length !== 1) return null; // 0 = não existe; >1 = ambíguo, melhor não adivinhar
  return { seqrdv: Number(linhas[0].seqrdv) };
}

// Resultado do envio, discriminado por `tipo` — é o que diz ao chamador (processarFilaDespesas)
// qual write-back fazer (seqrdv+enviadoEmSenior na inclusão, só enviadoEmSenior na edição,
// excluidaEm na exclusão) e qual EVENTOS_AUDITORIA registrar. `qtdrdv`/`vlrunt`/`vlrtot`
// (inclusão/edição) só vêm preenchidos quando o Result do Senior trouxe `qtdRdv` e/ou `vlrUni`
// — os valores que ELE confirmou pra despesa, que podem diferir do que mandamos (ajuste do
// lado de lá); `vlrtot` é recalculado em cima do par confirmado-ou-local (mesma fórmula de
// validarCamposDespesa em routes/rats.ts: `qtdrdv * vlrunt`, arredondado a 2 casas), pra nunca
// ficar dessincronizado dos outros dois. `hordes` (minutos) é independente dos outros três —
// não entra em nenhuma conta, só grava o que o Senior calculou (campo `horDes` publicado por
// lá em 09/09/2026, o Senior é quem decide essa duração, nunca calculamos aqui — ver
// "regra de cálculo automático adiada" no histórico do projeto). `undefined` em qualquer um
// desses campos quando o Result não trouxe o correspondente, e o write-back não mexe nele.
type ResultadoEnvioDespesa =
  | { despesaId: number; tipo: "incluida"; seqrdv: number; qtdrdv?: number; vlrunt?: number; vlrtot?: number; hordes?: number }
  | { despesaId: number; tipo: "editada"; qtdrdv?: number; vlrunt?: number; vlrtot?: number; hordes?: number }
  | { despesaId: number; tipo: "excluida" };

// Mesma fórmula/arredondamento de validarCamposDespesa (routes/rats.ts) — usada aqui pra
// recalcular vlrtot em cima do que o Senior confirmou (qtdrdv e/ou vlrUni), nunca do que
// mandamos.
function vlrtotConfirmado(qtdrdv: number, vlrUni: number): number {
  return Math.round(qtdrdv * vlrUni * 100) / 100;
}

// A partir do item devolvido pelo Result, monta só os campos que o Senior de fato confirmou
// (qtdRdv/vlrUni/horDes podem vir ausentes — nesse caso o local não muda) — `vlrtot` sempre
// junto quando PELO MENOS um de qtdRdv/vlrUni vier, calculado com o par confirmado-ou-local
// (nunca deixa vlrtot dessincronizado de qtdrdv/vlrunt); `hordes` é independente, entra sozinho
// quando `horDes` vier. Compartilhado por inclusão e edição.
function camposConfirmadosPeloSenior(
  itemRetornado: { qtdRdv: number | null; vlrUni: number | null; horDes: number | null } | undefined,
  pronta: { qtdrdv: number; vlrunt: number }
): { qtdrdv?: number; vlrunt?: number; vlrtot?: number; hordes?: number } {
  if (!itemRetornado) return {};
  const qtdConfirmada = itemRetornado.qtdRdv != null ? Math.round(itemRetornado.qtdRdv) : pronta.qtdrdv;
  const vlrUniConfirmado = itemRetornado.vlrUni ?? pronta.vlrunt;
  return {
    ...(itemRetornado.qtdRdv != null || itemRetornado.vlrUni != null
      ? {
          ...(itemRetornado.qtdRdv != null ? { qtdrdv: qtdConfirmada } : {}),
          ...(itemRetornado.vlrUni != null ? { vlrunt: vlrUniConfirmado } : {}),
          vlrtot: vlrtotConfirmado(qtdConfirmada, vlrUniConfirmado),
        }
      : {}),
    ...(itemRetornado.horDes != null ? { hordes: Math.round(itemRetornado.horDes) } : {}),
  };
}

// Envia uma despesa recém-lançada no CaxHub (nunca esteve no Senior) — tipEve I. NÃO grava
// nada — o write-back é feito pelo chamador (processarFilaDespesas) junto com a baixa da fila,
// numa transação só.
async function enviarInclusaoDespesa(despesa: RegistroDespesaViagem): Promise<ResultadoEnvioDespesa> {
  // Já registrada (reprocessamento manual, ou corrida entre o cron e o disparo imediato):
  // devolve o que já existe em vez de mandar de novo.
  if (despesa.seqrdv != null && despesa.enviadoEmSenior != null) {
    return { despesaId: despesa.id, tipo: "incluida", seqrdv: despesa.seqrdv };
  }

  const pronta = despesaPronta(despesa);

  // Confere na origem ANTES de enviar — mesmo cuidado de enviarApontamento, e pela mesma razão:
  // reenviar às cegas duplicaria a inclusão no ERP.
  const jaExiste = await procurarDespesaNoSenior(pronta);
  if (jaExiste) {
    console.warn(
      `[${JOB_NAME}] despesa ${despesa.id} já existe no Senior (seqrdv ${jaExiste.seqrdv}) — não reenvia, só reconcilia`
    );
    return { despesaId: despesa.id, tipo: "incluida", seqrdv: jaExiste.seqrdv };
  }

  const resposta = await manterItemDespesaViaSoap(montarPayloadDespesa(pronta, TIP_EVE_INCLUIR, { incluirSeqRdv: false }));

  const meuIdeExt = ideExtDespesa(despesa.id);
  const itemRetornado = resposta.resultados.find((r) => r.ideExt === meuIdeExt) ?? resposta.resultados[0];

  const recusa = mensagemDeRecusa(resposta, itemRetornado?.msg);
  if (recusa) throw new Error(recusa);

  if (itemRetornado?.seqRdv == null) {
    throw new Error(
      `Senior respondeu sucesso mas sem seqRdv (item: ${itemRetornado?.msg ?? "sem detalhe"}) — não dá pra confirmar o registro`
    );
  }

  return {
    despesaId: despesa.id,
    tipo: "incluida",
    seqrdv: itemRetornado.seqRdv,
    ...camposConfirmadosPeloSenior(itemRetornado, pronta),
  };
}

// Propaga uma edição de despesa JÁ registrada no Senior — tipEve A + seqRdv. Só chamado quando
// `despesa.seqrdv != null` (ver enfileirarEdicaoDespesa em PATCH /rats/despesas/:id) — sem
// seqRdv não há o que alterar lá, a rota trata esse caso sem passar pela fila.
async function enviarEdicaoDespesa(despesa: RegistroDespesaViagem): Promise<ResultadoEnvioDespesa> {
  if (despesa.seqrdv == null) {
    throw new Error(`Despesa ${despesa.id} sem seqrdv — não é possível editar no Senior (nunca foi incluída lá)`);
  }
  const pronta = despesaPronta(despesa);
  const resposta = await manterItemDespesaViaSoap(montarPayloadDespesa(pronta, TIP_EVE_ALTERAR, { incluirSeqRdv: true }));

  const meuIdeExt = ideExtDespesa(despesa.id);
  const itemRetornado = resposta.resultados.find((r) => r.ideExt === meuIdeExt) ?? resposta.resultados[0];
  const recusa = mensagemDeRecusa(resposta, itemRetornado?.msg);
  if (recusa) throw new Error(recusa);

  return {
    despesaId: despesa.id,
    tipo: "editada",
    ...camposConfirmadosPeloSenior(itemRetornado, pronta),
  };
}

// Propaga a exclusão de despesa JÁ registrada no Senior — tipEve E + seqRdv. Só chamado quando
// `despesa.seqrdv != null` (ver DELETE /rats/despesas/:id) — sem seqRdv a exclusão é resolvida
// direto ali, apagando a linha local sem passar pela fila (nada a desfazer no ERP).
async function enviarExclusaoDespesa(despesa: RegistroDespesaViagem): Promise<ResultadoEnvioDespesa> {
  if (despesa.seqrdv == null) {
    throw new Error(`Despesa ${despesa.id} sem seqrdv — exclusão sem envio prévio não deveria passar pela fila`);
  }
  const pronta = despesaPronta(despesa);
  const resposta = await manterItemDespesaViaSoap(montarPayloadDespesa(pronta, TIP_EVE_EXCLUIR, { incluirSeqRdv: true }));

  const meuIdeExt = ideExtDespesa(despesa.id);
  const itemRetornado = resposta.resultados.find((r) => r.ideExt === meuIdeExt) ?? resposta.resultados[0];
  const recusa = mensagemDeRecusa(resposta, itemRetornado?.msg);
  if (recusa) throw new Error(recusa);

  return { despesaId: despesa.id, tipo: "excluida" };
}

// Despacha pro canal certo conforme `item.tipo` — "enviar_despesa" é o default histórico
// (pendência criada antes de editar/excluir existirem), tratado como inclusão.
async function enviarDespesa(item: SincronizacaoPendenteDespesa): Promise<ResultadoEnvioDespesa> {
  // Relê do banco em vez de confiar no payload enfileirado — mesmo motivo de enviarApontamento
  // (o dado pode ter mudado entre o enfileiramento e o envio).
  const despesa = await prisma.registroDespesaViagem.findUnique({ where: { id: item.despesaId } });
  if (!despesa) throw new Error(`Despesa ${item.despesaId} não existe mais — apagada antes do envio`);

  if (item.tipo === "editar_despesa") return enviarEdicaoDespesa(despesa);
  if (item.tipo === "excluir_despesa") return enviarExclusaoDespesa(despesa);
  return enviarInclusaoDespesa(despesa);
}

// Processa a fila: tenta enviar cada despesa pendente, com no máximo MAX_TENTATIVAS. Mesma
// estrutura de processarFilaSincronizacao em outboxSenior.ts (disparo imediato via apenasId,
// varredura completa via cron).
export async function processarFilaDespesas(opcoes: { apenasId?: number; apenasIds?: number[] } = {}): Promise<void> {
  const ids = opcoes.apenasIds ?? (opcoes.apenasId != null ? [opcoes.apenasId] : undefined);
  const pendentes = await prisma.sincronizacaoPendenteDespesa.findMany({
    where: {
      status: "pendente",
      tentativas: { lt: MAX_TENTATIVAS },
      ...(ids != null ? { id: { in: ids } } : {}),
    },
    orderBy: { criadoEm: "asc" },
  });

  let enviados = 0;
  let falhas = 0;

  for (const item of pendentes) {
    const despesa = await prisma.registroDespesaViagem.findUnique({ where: { id: item.despesaId } });
    const entidadeId = entidadeIdDespesa(item.despesaId);
    const entidadeRotulo = despesa ? `Despesa — RAT ${despesa.codemp}/${despesa.numrat}` : `Despesa ${item.despesaId}`;
    const correlationId = randomUUID();
    const payloadResumo = JSON.stringify(item.payload).slice(0, 1000);
    const inicioEnvio = Date.now();
    // Calculado a partir de `item.tipo` (não do resultado, que só existe em caso de sucesso) —
    // usado tanto no evento de sucesso quanto no de falha, pra auditoria conseguir distinguir
    // "falhou incluindo" de "falhou excluindo".
    const eventoTipoDoItem =
      item.tipo === "editar_despesa"
        ? EVENTOS_AUDITORIA.DESPESA_EDITADA_SENIOR
        : item.tipo === "excluir_despesa"
          ? EVENTOS_AUDITORIA.DESPESA_EXCLUIDA_SENIOR
          : EVENTOS_AUDITORIA.DESPESA_ENVIADA_SENIOR;

    try {
      // Marca "enviando" ANTES da chamada — fecha a janela em que a despesa poderia ser
      // editada/excluída de novo com o envio em voo (ver pendenciaEmAndamento, checado pelas
      // rotas de editar/excluir antes de aceitar uma nova ação).
      await prisma.sincronizacaoPendenteDespesa.update({ where: { id: item.id }, data: { status: "enviando" } });

      const registrado = await enviarDespesa(item);
      const duracaoMs = Date.now() - inicioEnvio;

      // Write-back na MESMA transação que baixa a fila — ou a despesa fica com o estado
      // correto (seqrdv+enviadoEmSenior na inclusão, enviadoEmSenior na edição, excluidaEm na
      // exclusão) e a pendência fecha, ou nenhum dos dois.
      await prisma.$transaction([
        prisma.registroDespesaViagem.update({
          where: { id: registrado.despesaId },
          // `qtdrdv`/`vlrunt`/`vlrtot` só entram quando o Senior confirmou algo no Result
          // (qtdRdv e/ou vlrUni) — são os valores DELE que passam a valer localmente a partir
          // daqui, podem diferir do que mandamos (ajuste do lado de lá); `vlrtot` já vem
          // recalculado em cima do par confirmado-ou-local (camposConfirmadosPeloSenior),
          // nunca fica dessincronizado dos outros dois.
          data:
            registrado.tipo === "incluida"
              ? {
                  seqrdv: registrado.seqrdv,
                  enviadoEmSenior: new Date(),
                  ...(registrado.qtdrdv != null ? { qtdrdv: registrado.qtdrdv } : {}),
                  ...(registrado.vlrunt != null ? { vlrunt: registrado.vlrunt } : {}),
                  ...(registrado.vlrtot != null ? { vlrtot: registrado.vlrtot } : {}),
                  ...(registrado.hordes != null ? { hordes: registrado.hordes } : {}),
                }
              : registrado.tipo === "editada"
                ? {
                    enviadoEmSenior: new Date(),
                    ...(registrado.qtdrdv != null ? { qtdrdv: registrado.qtdrdv } : {}),
                    ...(registrado.vlrunt != null ? { vlrunt: registrado.vlrunt } : {}),
                    ...(registrado.vlrtot != null ? { vlrtot: registrado.vlrtot } : {}),
                    ...(registrado.hordes != null ? { hordes: registrado.hordes } : {}),
                  }
                : // `seqrdv: null` junto — o Senior de fato APAGA o registro (não é soft delete
                  // do lado dele), então o número fica livre pra ele reatribuir a uma despesa
                  // futura qualquer. Se a nossa linha excluída continuasse "dona" desse seqrdv,
                  // @@unique([codemp,numrat,seqrdv]) recusaria a PRÓXIMA despesa que o Senior
                  // confirmar com o mesmo número (achado real: RDV 285760 excluída, a despesa
                  // seguinte tentou herdar o mesmo seqrdv e o write-back falhou). Mantém
                  // excluidaEm + desrdv/vlrtot/datemi pra rastreabilidade do valor — só o
                  // vínculo com o Senior (que já não existe mais) é que some.
                  { excluidaEm: new Date(), seqrdv: null },
        }),
        prisma.sincronizacaoPendenteDespesa.update({
          where: { id: item.id },
          data: { status: "enviado", processadoEm: new Date(), ultimoErro: null },
        }),
        criarEventoAuditoria({
          origem: "job",
          codemp: despesa?.codemp ?? null,
          codpro: null,
          entidadeTipo: ENTIDADES_AUDITORIA.DESPESA,
          entidadeId,
          entidadeRotulo,
          eventoTipo: eventoTipoDoItem,
          alteracoes: null,
          metadata: { tipo: item.tipo, payload: payloadResumo, sucesso: true, duracaoMs },
          correlationId,
        }),
      ]);
      enviados += 1;
    } catch (error) {
      const duracaoMs = Date.now() - inicioEnvio;
      const message = error instanceof Error ? error.message : String(error);
      const tentativas = item.tentativas + 1;

      await prisma.$transaction([
        prisma.sincronizacaoPendenteDespesa.update({
          where: { id: item.id },
          data: {
            tentativas,
            ultimoErro: message,
            status: tentativas >= MAX_TENTATIVAS ? "bloqueado" : "pendente",
          },
        }),
        criarEventoAuditoria({
          origem: "job",
          codemp: despesa?.codemp ?? null,
          codpro: null,
          entidadeTipo: ENTIDADES_AUDITORIA.DESPESA,
          entidadeId,
          entidadeRotulo,
          eventoTipo: eventoTipoDoItem,
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
        message: `${enviados} enviado(s), ${falhas} falha(s)`,
      },
    });
  }
}

export interface PreviewEnvioDespesa {
  payload: ManterItemDespesaPayload;
  envelopeXml: string;
}

// Reconstrói, SEM chamar o Senior, o que seria de fato enviado pra esta pendência agora — relê
// o dado VIVO (RegistroDespesaViagem), nunca `item.payload`. Mesmo papel de previewEnvioSenior.
export async function previewEnvioDespesa(item: SincronizacaoPendenteDespesa): Promise<PreviewEnvioDespesa> {
  const despesa = await prisma.registroDespesaViagem.findUnique({ where: { id: item.despesaId } });
  if (!despesa) throw new Error(`Despesa ${item.despesaId} não existe mais`);

  const tipEve = item.tipo === "editar_despesa" ? TIP_EVE_ALTERAR : item.tipo === "excluir_despesa" ? TIP_EVE_EXCLUIR : TIP_EVE_INCLUIR;
  const incluirSeqRdv = item.tipo === "editar_despesa" || item.tipo === "excluir_despesa";

  const payloadReal = montarPayloadDespesa(despesaPronta(despesa), tipEve, { incluirSeqRdv });
  return { payload: payloadReal, envelopeXml: montarEnvelopeManterItemDespesa(payloadReal, "***", "***") };
}

// Reseta uma pendência bloqueada pra pendente/0 tentativas, pra tentar de novo manualmente.
export async function reprocessarDespesa(id: number): Promise<void> {
  await prisma.sincronizacaoPendenteDespesa.update({
    where: { id },
    data: { status: "pendente", tentativas: 0, ultimoErro: null },
  });
}

export function scheduleOutboxSeniorDespesaSync(): void {
  // Mesma cadência de scheduleOutboxSeniorSync — rede de segurança pro que o disparo imediato
  // não conseguiu.
  cron.schedule("*/15 * * * *", () => processarFilaDespesas());
}
