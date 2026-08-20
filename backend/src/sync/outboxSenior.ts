import cron from "node-cron";
import { randomUUID } from "crypto";
import { AtividadeConsultor, Prisma, SincronizacaoPendente } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  AlocarAtividadesPayload,
  RegistrarAtividadesPayload,
  alocarAtividadesViaSoap,
  formatarDataSenior,
  formatarHoraSenior,
  ideExtAlocacao,
  ideExtItem,
  ideExtRat,
  mensagemDeRecusa,
  montarEnvelopeAlocarAtividades,
  montarEnvelopeRegistrarAtividades,
  registrarAtividadesViaSoap,
  runSqlViaSoap,
  SIS_ORI,
  TIP_EVE,
  TIP_EVE_ALTERAR,
  TIP_EVE_EXCLUIR,
  TIP_EVE_INCLUIR,
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
//
// Dispara o envio DESSA pendência na hora, sem segurar quem chamou (fire-and-forget) — só 2
// dos 13 chamadores desta função replicavam isso manualmente antes (17/08/2026: os outros 11
// só enfileiravam e esperavam o cron de 15 min, sem motivo técnico real). Central aqui:
// chamador novo não precisa lembrar de disparar. `adiarEnvio` existe só pros pontos que
// enfileiram vários itens por request (aprovar RAT inteira, alocar em lote) — esses disparam
// UMA varredura no fim (`processarFilaSincronizacao()` sem `apenasId`), não N chamadas SOAP
// concorrentes.
// "Criar alocação" sem horas (qtdhor nulo ou <= 0) não tem o que mandar pro Senior — em vez
// de nascer "pendente" e gastar 5 tentativas até "bloqueado" (dando a entender que é um
// problema de rede/canal, quando na verdade é dado ausente), a pendência já nasce "invalido"
// (18/08/2026, pedido do Vitor): some da fila de envio, nunca é tentada, e fica visível na
// tela só pra quem for corrigir a alocação. Só `criar_atividade` tem essa regra hoje — é o
// único tipo cujo payload carrega `qtdhor` como a informação central do envio.
function payloadDeAlocacaoInvalido(tipo: string, payload: Record<string, unknown>): boolean {
  if (tipo !== "criar_atividade") return false;
  const qtdhor = payload.qtdhor as number | null | undefined;
  return qtdhor == null || qtdhor <= 0;
}

export async function enfileirar(
  atividadeId: number,
  tipo: string,
  payload: Record<string, unknown>,
  opcoes: { adiarEnvio?: boolean } = {}
): Promise<number> {
  const invalido = payloadDeAlocacaoInvalido(tipo, payload);
  const criada = await prisma.sincronizacaoPendente.create({
    data: {
      atividadeId,
      tipo,
      payload: payload as Prisma.InputJsonValue,
      ...(invalido ? { status: "invalido" } : {}),
    },
  });
  if (!invalido && !opcoes.adiarEnvio) {
    processarFilaSincronizacao({ apenasId: criada.id }).catch((erro) => {
      console.error(`[outbox] envio imediato (${tipo}) falhou:`, erro instanceof Error ? erro.message : erro);
    });
  }
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
//
// Duas formas hoje: apontamento (write-back em Rat/RatItem) e criação de alocação
// (write-back em AtividadeConsultor.seqati). Remover alocação não gera write-back nenhum —
// `enviarParaSenior` devolve `null` nesse caso, e a fila só baixa pra "enviado". Editar
// TAMBÉM pode gerar esse mesmo write-back (18/08/2026): o Senior aceita "Alterar" pra um
// registro que ainda não existe do lado dele — insere e devolve `seqAti`, igual a um
// "Incluir" — então `enviarEditarAtividade` devolve o mesmo formato quando a alocação local
// ainda não tinha `seqAti` antes do envio.
interface ResultadoEnvioApontamento {
  tipo: "apontamento";
  ratId: number;
  ratItemId: number;
  numrat: number;
  seqrat: number;
}

interface ResultadoEnvioAlocacaoCriada {
  tipo: "alocacao_criada";
  atividadeConsultorId: number;
  seqAti: number;
}

type ResultadoEnvio = ResultadoEnvioApontamento | ResultadoEnvioAlocacaoCriada;

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

/** RatItem já validado (data/hora e Rat.codpro presentes) — o que `montarPayloadApontamento` exige. */
interface RatItemPronto {
  id: number;
  ratId: number;
  codemp: number;
  seqite: number | null;
  // Gravado em confirmarSessao (routes/apontamentos.ts) a partir de AtividadeConsultor.seqati
  // — vira o seqAti que a Senior recebe, ver montarPayloadApontamento logo abaixo.
  seqati: bigint | null;
  datati: Date;
  horini: number;
  horfim: number;
  desati: string | null;
  rat: { codfor: number; codpro: number };
}

// Monta o payload de `registrarAtividades` a partir do RatItem já validado. Isolado à parte
// pra ser a MESMA função usada no envio real (enviarApontamento) e na prévia sem envio
// (previewEnvioSenior) — não existe outro lugar que decida esse mapeamento de campo.
function montarPayloadApontamento(ratItem: RatItemPronto): RegistrarAtividadesPayload {
  return {
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
        ...(ratItem.seqati != null ? { seqAti: Number(ratItem.seqati) } : {}),
        datAti: formatarDataSenior(ratItem.datati),
        horIni: formatarHoraSenior(ratItem.horini),
        horFim: formatarHoraSenior(ratItem.horfim),
        desAti: ratItem.desati ?? "",
      },
    ],
  };
}

// Envia um apontamento confirmado (RatItem) pro Senior e devolve a identidade que o ERP
// atribuiu. NÃO grava nada — o write-back é feito pelo chamador junto com a baixa da fila,
// numa transação só.
async function enviarApontamento(item: SincronizacaoPendente): Promise<ResultadoEnvioApontamento> {
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
    return { tipo: "apontamento", ratId: ratItem.ratId, ratItemId: ratItem.id, numrat: ratItem.numrat, seqrat: ratItem.seqrat };
  }

  // Não há retenção por ajuste de horário aqui, de propósito: a trava vive na CONFIRMAÇÃO
  // (ver confirmarSessao em routes/apontamentos.ts). Apontamento com pedido pendente não
  // chega a virar RatItem, então nada com ajuste em aberto passa por este ponto.

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
    return { tipo: "apontamento", ratId: ratItem.ratId, ratItemId: ratItem.id, ...jaExiste };
  }

  const resposta = await registrarAtividadesViaSoap(montarPayloadApontamento(ratItem as RatItemPronto));

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

  return { tipo: "apontamento", ratId: ratItem.ratId, ratItemId: ratItem.id, numrat: resultado.numRat, seqrat: itemRetornado.seqRat };
}

// ---------------------------------------------------------------------------
// Canal de alocação — operação `alocarAtividades`, publicada em 10/08/2026. Três tipos
// de mudança, um tipEve cada (I/A/E — aqui os três fazem sentido de verdade, diferente do
// apontamento: alocação TEM exclusão real no Senior). Ver soap/client.ts pro contrato e
// pra observação sobre o formato de qtdHor/hrsExc ainda não confirmado contra o serviço.
// ---------------------------------------------------------------------------

// Espelho local da AtividadeConsultor, relido do banco (nunca do payload enfileirado —
// pode ter mudado entre o enfileiramento e o envio, mesmo espírito de enviarApontamento).
async function buscarAlocacao(atividadeConsultorId: number) {
  const alocacao = await prisma.atividadeConsultor.findUnique({ where: { id: atividadeConsultorId } });
  if (!alocacao) {
    throw new Error(`AtividadeConsultor ${atividadeConsultorId} não existe mais — removida antes do envio`);
  }
  return alocacao;
}

// `qtdHor`/`hrsExc` são horas em minutos localmente; a hipótese de formato pro Senior é
// "HH:MM" (mesmo estilo de horIni/horFim) — ainda não confirmada, ver comentário em
// soap/client.ts. formatarHoraSenior já faz exatamente essa conta, só reaproveitando.
function horasParaQtdHorSenior(minutos: number): string {
  return formatarHoraSenior(minutos);
}

/** Quais campos do item entram no payload — varia por tipEve (ver os três chamadores abaixo). */
interface OpcoesPayloadAlocacao {
  /** `seqAti` só existe do lado do Senior a partir da criação — ausente ao incluir. */
  incluirSeqAti: boolean;
  /** `qtdHor`/`hrsExc` não fazem sentido ao excluir (nada a informar). */
  incluirHoras: boolean;
}

// Monta o payload de `alocarAtividades` a partir da AtividadeConsultor viva. Isolado à parte
// pra ser a MESMA função usada no envio real (enviarCriarAtividade/enviarEditarAtividade/
// enviarRemoverAtividade) e na prévia sem envio (previewEnvioSenior).
function montarPayloadAlocacao(
  alocacao: AtividadeConsultor,
  tipEve: string,
  opcoes: OpcoesPayloadAlocacao
): AlocarAtividadesPayload {
  const meuIdeExt = ideExtAlocacao(alocacao.id);
  return {
    codEmp: alocacao.codemp,
    codFor: alocacao.codfor,
    codPro: alocacao.codpro,
    ideExt: meuIdeExt,
    sisOri: SIS_ORI,
    tipEve,
    itens: [
      {
        ideExt: meuIdeExt,
        seqite: alocacao.seqite,
        ...(opcoes.incluirSeqAti && alocacao.seqati != null ? { seqAti: Number(alocacao.seqati) } : {}),
        ...(opcoes.incluirHoras ? { qtdHor: horasParaQtdHorSenior(alocacao.qtdhor ?? 0) } : {}),
        ...(opcoes.incluirHoras && alocacao.horasExcedentes > 0
          ? { hrsExc: horasParaQtdHorSenior(alocacao.horasExcedentes) }
          : {}),
      },
    ],
  };
}

// Cria a alocação no Senior (tipEve I). Idempotência: se `seqati` já estiver preenchido
// localmente, a criação já aconteceu numa tentativa anterior — não reenvia (reenviar um
// "I" já processado arriscaria duplicar a alocação lá, e diferente do apontamento não há
// aqui uma consulta de reconciliação equivalente a USU_TE777IAT ainda implementada).
async function enviarCriarAtividade(item: SincronizacaoPendente): Promise<ResultadoEnvioAlocacaoCriada | null> {
  const alocacao = await buscarAlocacao(item.atividadeId);

  if (alocacao.seqati != null) {
    console.warn(`[${JOB_NAME}] alocação ${alocacao.id} já tem seqAti (${alocacao.seqati}) — não reenvia criação`);
    return null;
  }

  // Segunda trava contra a mesma regra de enfileirar() (payloadDeAlocacaoInvalido) — aqui
  // relendo do banco, não do payload congelado. Nunca deveria disparar sozinho (pendência já
  // nasce "invalido" e processarFilaSincronizacao não pega esse status), só protege contra
  // reprocessar() manual numa pendência que foi resetada pra "pendente" sem a alocação ter
  // ganhado horas de verdade nesse meio-tempo.
  if (alocacao.qtdhor == null || alocacao.qtdhor <= 0) {
    throw new Error(`Alocação ${alocacao.id} sem horas (qtdhor=${alocacao.qtdhor ?? "nulo"}) — não é enviada ao Senior`);
  }

  const meuIdeExt = ideExtAlocacao(alocacao.id);
  const resposta = await alocarAtividadesViaSoap(
    montarPayloadAlocacao(alocacao, TIP_EVE_INCLUIR, { incluirSeqAti: false, incluirHoras: true })
  );

  const resultado = resposta.resultados.find((r) => r.ideExt === meuIdeExt) ?? resposta.resultados[0];
  const itemRetornado = resultado?.itens.find((i) => i.ideExt === meuIdeExt) ?? resultado?.itens[0];

  const recusa = mensagemDeRecusa(resposta, itemRetornado?.msg);
  if (recusa) throw new Error(recusa);

  // `=== 0` também é rejeitado, não só `== null`: um seqAti zero não é um seqAti real — se
  // gravado, "rouba" pra si (nos cálculos de realizado que buscam RatItem por seqati) a soma
  // de todo RatItem de seqati=0 do banco inteiro, de qualquer consultor/proposta (caso real
  // já corrigido: alocação 78035/estrutura 2440, ver routes/alocacao.ts).
  if (itemRetornado?.seqAti == null || itemRetornado.seqAti === 0) {
    throw new Error(
      `Senior respondeu sucesso mas sem seqAti válido (item: ${itemRetornado?.msg ?? "sem detalhe"}, seqAti=${itemRetornado?.seqAti}) — não dá pra confirmar a alocação`
    );
  }

  return { tipo: "alocacao_criada", atividadeConsultorId: alocacao.id, seqAti: itemRetornado.seqAti };
}

// Altera qtdHor/horasExcedentes de uma alocação no Senior (tipEve A). NÃO exige `seqAti`
// local (18/08/2026, pedido do Vitor — antes recusava com CanalIndisponivelError e ficava
// esperando pra sempre o criar_atividade correspondente resolver, o que nem sempre acontece:
// esse create pode ter sido marcado "invalido" ou ficado "bloqueado", e o editar ficaria
// pendente para sempre por uma dependência morta). O Senior aceita "Alterar" pra um registro
// que ainda não existe do lado dele — insere e devolve `seqAti`, igual a um "Incluir" — então
// este envio FAZ o papel do create que faltou quando for o caso.
async function enviarEditarAtividade(item: SincronizacaoPendente): Promise<ResultadoEnvioAlocacaoCriada | null> {
  const alocacao = await buscarAlocacao(item.atividadeId);
  const jaTinhaSeqAti = alocacao.seqati != null;

  const meuIdeExt = ideExtAlocacao(alocacao.id);
  const resposta = await alocarAtividadesViaSoap(
    montarPayloadAlocacao(alocacao, TIP_EVE_ALTERAR, { incluirSeqAti: true, incluirHoras: true })
  );

  const resultado = resposta.resultados.find((r) => r.ideExt === meuIdeExt) ?? resposta.resultados[0];
  const itemRetornado = resultado?.itens.find((i) => i.ideExt === meuIdeExt) ?? resultado?.itens[0];
  const recusa = mensagemDeRecusa(resposta, itemRetornado?.msg);
  if (recusa) throw new Error(recusa);

  // Edição normal (a alocação já tinha identidade lá) — qtdhor/horasExcedentes já estão
  // certos, nada novo pra gravar localmente.
  if (jaTinhaSeqAti) return null;

  // Não tinha seqAti local: este "Alterar" fez o papel de criação. Mesmo write-back de
  // enviarCriarAtividade — sem isso, a alocação fica pra sempre sem identidade mesmo já
  // existindo de verdade no Senior. Mesma rejeição de `seqAti === 0`, ver comentário em
  // enviarCriarAtividade acima.
  if (itemRetornado?.seqAti == null || itemRetornado.seqAti === 0) {
    throw new Error(
      `Senior respondeu sucesso mas sem seqAti válido (alocação ${alocacao.id} não tinha seqAti local e a resposta não trouxe um novo válido, seqAti=${itemRetornado?.seqAti})`
    );
  }
  return { tipo: "alocacao_criada", atividadeConsultorId: alocacao.id, seqAti: itemRetornado.seqAti };
}

// Exclui a alocação no Senior (tipEve E). Sem operação de exclusão pra reconciliar contra
// — mas diferente do apontamento, aqui excluir de novo por engano não é catastrófico: o
// Senior já sabe que o registro não existe mais e é essa a intenção.
async function enviarRemoverAtividade(item: SincronizacaoPendente): Promise<null> {
  const alocacao = await buscarAlocacao(item.atividadeId);

  // Nunca chegou a ser criada no Senior — não há o que excluir lá.
  if (alocacao.seqati == null) {
    return null;
  }

  const meuIdeExt = ideExtAlocacao(alocacao.id);
  const resposta = await alocarAtividadesViaSoap(
    montarPayloadAlocacao(alocacao, TIP_EVE_EXCLUIR, { incluirSeqAti: true, incluirHoras: false })
  );

  const resultado = resposta.resultados.find((r) => r.ideExt === meuIdeExt) ?? resposta.resultados[0];
  const itemRetornado = resultado?.itens.find((i) => i.ideExt === meuIdeExt) ?? resultado?.itens[0];
  const recusa = mensagemDeRecusa(resposta, itemRetornado?.msg);
  if (recusa) throw new Error(recusa);

  return null;
}

// Despacha cada mudança pro canal certo. Tipos ainda sem operação publicada esperam sem
// consumir tentativa (ver CanalIndisponivelError).
async function enviarParaSenior(item: SincronizacaoPendente): Promise<ResultadoEnvio | null> {
  if (item.tipo === "criar_apontamento") return enviarApontamento(item);
  if (item.tipo === "criar_atividade") return enviarCriarAtividade(item);
  if (item.tipo === "editar_atividade") return enviarEditarAtividade(item);
  if (item.tipo === "remover_atividade") return enviarRemoverAtividade(item);

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
        ...(registrado?.tipo === "apontamento"
          ? [
              prisma.rat.update({ where: { id: registrado.ratId }, data: { numrat: registrado.numrat } }),
              prisma.ratItem.update({
                where: { id: registrado.ratItemId },
                data: { numrat: registrado.numrat, seqrat: registrado.seqrat, datreg: new Date() },
              }),
            ]
          : []),
        ...(registrado?.tipo === "alocacao_criada"
          ? [
              prisma.atividadeConsultor.update({
                where: { id: registrado.atividadeConsultorId },
                data: { seqati: BigInt(registrado.seqAti) },
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

export interface PreviewEnvioSenior {
  payload: RegistrarAtividadesPayload | AlocarAtividadesPayload;
  envelopeXml: string;
}

// Reconstrói, SEM chamar o Senior, o que seria de fato enviado pra esta pendência agora —
// relê o dado VIVO (RatItem/AtividadeConsultor), a mesma fonte que enviarParaSenior usa,
// nunca `item.payload` (que é só um retrato interno tirado no momento em que a pendência foi
// criada — nomes e formato diferentes do contrato do Senior, não serve pra comparar contra o
// WSDL/XSD). Usado pelo endpoint admin de prévia em backend/src/routes/sincronizacao.ts.
// `user`/`password` mascarados de propósito: isto nunca precisa da credencial real, é só pra
// exibição.
export async function previewEnvioSenior(item: SincronizacaoPendente): Promise<PreviewEnvioSenior> {
  if (item.tipo === "criar_apontamento") {
    const payload = item.payload as { ratItemId?: number };
    const ratItemId = Number(payload?.ratItemId);
    if (!Number.isFinite(ratItemId)) throw new Error(`Payload sem ratItemId (pendência ${item.id})`);

    const ratItem = await prisma.ratItem.findUnique({ where: { id: ratItemId }, include: { rat: true } });
    if (!ratItem) throw new Error(`RatItem ${ratItemId} não existe mais — apontamento desfeito antes do envio`);
    if (ratItem.datati == null || ratItem.horini == null || ratItem.horfim == null) {
      throw new Error(`RatItem ${ratItemId} sem data/hora — nada a montar`);
    }
    if (ratItem.rat.codpro == null) throw new Error(`RAT ${ratItem.rat.id} sem codpro — não dá pra montar`);

    const payloadReal = montarPayloadApontamento(ratItem as RatItemPronto);
    return { payload: payloadReal, envelopeXml: montarEnvelopeRegistrarAtividades(payloadReal, "***", "***") };
  }

  if (item.tipo === "criar_atividade" || item.tipo === "editar_atividade" || item.tipo === "remover_atividade") {
    const alocacao = await buscarAlocacao(item.atividadeId);

    let tipEve: string;
    let opcoes: OpcoesPayloadAlocacao;
    if (item.tipo === "criar_atividade") {
      tipEve = TIP_EVE_INCLUIR;
      opcoes = { incluirSeqAti: false, incluirHoras: true };
    } else if (item.tipo === "editar_atividade") {
      tipEve = TIP_EVE_ALTERAR;
      opcoes = { incluirSeqAti: true, incluirHoras: true };
    } else {
      tipEve = TIP_EVE_EXCLUIR;
      opcoes = { incluirSeqAti: true, incluirHoras: false };
    }

    const payloadReal = montarPayloadAlocacao(alocacao, tipEve, opcoes);
    return { payload: payloadReal, envelopeXml: montarEnvelopeAlocarAtividades(payloadReal, "***", "***") };
  }

  // Mesmo erro que enviarParaSenior lançaria — explica por que não há prévia possível.
  throw new CanalIndisponivelError(`Ainda não há operação publicada no Senior para "${item.tipo}"`);
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
