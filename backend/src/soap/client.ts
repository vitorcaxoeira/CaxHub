import axios from "axios";
import { XMLParser } from "fast-xml-parser";

const SENIOR_NAMESPACE = "http://services.senior.com.br";

const parser = new XMLParser({ ignoreAttributes: false });

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Erros do Senior — TRÊS camadas, e cada uma fala por um canal diferente.
// Medido contra o serviço real em 04/08/2026:
//
//   1. SOAP Fault      HTTP 4xx/5xx, com o motivo em <faultstring>. Ex.: chamar uma porta
//                      inexistente devolve 400 e "A porta "x" não foi encontrada na lista
//                      de serviços". O axios LANÇA nesse caso, então a resposta nunca
//                      chega ao parser — e era aqui que o CaxHub perdia tudo, guardando só
//                      "Request failed with status code 400". Ver a pendência 132.
//   2. erroExecucao    HTTP 200 com o campo preenchido. Ex.: SQL inválido devolve
//                      "Ocorreu um erro ao executar o serviço "Consulta Genérica": ...".
//   3. statusProcesso  HTTP 200, campo != 1 — recusa de negócio de registrarAtividades,
//                      com o texto em `mensagemProcesso` (o geral) e no `msg` do item (o
//                      específico). O nome do campo é `mensagemProcesso`, confirmado no
//                      XSD publicado: `mensagemRetorno` não existe em nenhuma operação.
//
// A precedência é essa mesma ordem: fault > erroExecucao > statusProcesso.
// ---------------------------------------------------------------------------

/** Texto do <faultstring> de um SOAP Fault, quando a resposta de erro trouxer um. */
function faultstringDaResposta(corpo: unknown): string | null {
  if (typeof corpo !== "string" || corpo === "") return null;
  try {
    const fault = parser.parse(corpo)?.["S:Envelope"]?.["S:Body"]?.["S:Fault"];
    const texto = fault?.faultstring;
    if (typeof texto === "string" && texto.trim() !== "") return texto.trim();
  } catch {
    // Corpo que não é XML — cai no recorte cru abaixo, melhor que perder a informação.
  }
  return null;
}

// Traduz a falha de uma chamada SOAP na mensagem mais informativa disponível. Sem isto,
// todo erro de transporte vira "Request failed with status code 400" e o motivo que o
// Senior mandou junto é jogado fora.
export function mensagemDeFalhaSoap(erro: unknown, operacao: string): string {
  if (axios.isAxiosError(erro) && erro.response) {
    const fault = faultstringDaResposta(erro.response.data);
    if (fault) return `Senior recusou "${operacao}" (HTTP ${erro.response.status}): ${fault}`;
    const cru = typeof erro.response.data === "string" ? erro.response.data.slice(0, 500) : "";
    return `Senior recusou "${operacao}" (HTTP ${erro.response.status})${cru ? `: ${cru}` : " — sem corpo na resposta"}`;
  }
  return erro instanceof Error ? erro.message : String(erro);
}

export interface RunSqlOptions {
  limit?: number;
  offSet?: number;
}

/**
 * Executa uma consulta SQL através do serviço "Consulta Genérica" do Senior
 * ERP (operação `getData` do WSDL sapiens_Synccom_br_CaxHub). O serviço usa
 * FOR JSON do SQL Server internamente, então toda coluna do SELECT precisa
 * de um alias (ex.: `SELECT 1 AS exemplo`), senão o serviço retorna erro.
 *
 * A resposta vem com o JSON em base64 dentro de `pmJsonResponse`.
 */
export async function runSqlViaSoap(query: string, options: RunSqlOptions = {}): Promise<unknown[]> {
  const soapUrl = process.env.SOAP_URL;
  const soapUser = process.env.SOAP_USER;
  const soapPassword = process.env.SOAP_PASSWORD;

  if (!soapUrl || !soapUser || !soapPassword) {
    throw new Error("SOAP_URL, SOAP_USER e SOAP_PASSWORD precisam estar definidos no .env");
  }

  const endpoint = soapUrl.replace(/\?wsdl$/i, "");

  const parametersXml = [
    `<query><![CDATA[${query}]]></query>`,
    options.limit !== undefined ? `<limit>${options.limit}</limit>` : "",
    options.offSet !== undefined ? `<offSet>${options.offSet}</offSet>` : "",
  ].join("");

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="${SENIOR_NAMESPACE}">
  <soapenv:Header/>
  <soapenv:Body>
    <ser:getData>
      <user>${escapeXml(soapUser)}</user>
      <password>${escapeXml(soapPassword)}</password>
      <encryption>0</encryption>
      <parameters>${parametersXml}</parameters>
    </ser:getData>
  </soapenv:Body>
</soapenv:Envelope>`;

  const response = await axios
    .post(endpoint, envelope, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '""',
      },
      timeout: 20000,
    })
    .catch((erro) => {
      throw new Error(mensagemDeFalhaSoap(erro, "getData"));
    });

  const parsed = parser.parse(response.data);
  const result = parsed?.["S:Envelope"]?.["S:Body"]?.["ns2:getDataResponse"]?.result;

  if (!result) {
    throw new Error("Resposta SOAP em formato inesperado — ajustar parsing em soap/client.ts");
  }

  if (typeof result.erroExecucao === "string") {
    throw new Error(`Erro no serviço Senior: ${result.erroExecucao}`);
  }

  if (typeof result.pmJsonResponse !== "string") {
    return [];
  }

  // O conteúdo dentro do base64 vem em Windows-1252, não UTF-8 — decodificar como utf-8
  // corrompe acentos (ex.: "Aliança" virava "Alian�a").
  //
  // E NÃO é Latin-1, embora se pareça: os dois só coincidem de 0xA0 pra cima. Na faixa
  // 0x80–0x9F o Windows-1252 tem pontuação (travessão, aspas curvas, bullet, reticências)
  // onde o Latin-1 tem caracteres de controle. Decodificar como "latin1" — como se fazia
  // aqui até 30/07/2026 — transformava todo travessão num controle invisível, que aparecia
  // como quadradinho na tela; 543 registros ficaram assim antes de alguém notar (ver a
  // migration 20260730_reparo_encoding_windows1252). `TextDecoder` resolve sem dependência
  // nova: o Node 18+ já vem com ICU completo.
  const json = new TextDecoder("windows-1252").decode(Buffer.from(result.pmJsonResponse, "base64"));
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Canal de ESCRITA — operação `registrarAtividades` do mesmo serviço.
//
// Grava RAT e Itens de RAT no Senior a partir dos apontamentos confirmados no CaxHub.
// Publicada em 29/07/2026; até então o serviço só expunha `getData` (leitura) e o envio
// era um stub que sempre falhava (ver sync/outboxSenior.ts).
// ---------------------------------------------------------------------------

// Data no formato que o serviço espera: dd/mm/yyyy.
// Formata em UTC de propósito: `RatItem.datati` é @db.Date, gravado como meia-noite UTC,
// e formatar em horário local jogaria a data um dia pra trás em fuso negativo (o Brasil).
export function formatarDataSenior(data: Date): string {
  const dia = String(data.getUTCDate()).padStart(2, "0");
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${data.getUTCFullYear()}`;
}

// Hora no formato que o serviço espera: hh:mm.
// A entrada é MINUTOS DESDE A MEIA-NOITE (é assim que horini/horfim vivem no banco,
// confirmado contra amostra real do Senior: 480 = 08:00), nunca HHMM — tratar como HHMM
// produziria "4:80" a partir de 480.
export function formatarHoraSenior(minutosDesdeMeiaNoite: number): string {
  const horas = Math.trunc(minutosDesdeMeiaNoite / 60);
  const minutos = minutosDesdeMeiaNoite % 60;
  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

// Constantes do contrato, num lugar só: o job de envio (sync/outboxSenior.ts) e o script
// de verificação manual (prisma/verificarEnvioApontamento.ts) precisam concordar, senão o
// script valida um payload diferente do que a aplicação manda de verdade.

/** Identificador externo mandado ao Senior: o ID local puro, nos dois níveis. */
export const ideExtRat = (ratId: number) => String(ratId);
export const ideExtItem = (ratItemId: number) => String(ratItemId);

/** Sistema de origem, com a grafia exata que o serviço espera. */
export const SIS_ORI = process.env.SENIOR_SIS_ORI ?? "CaxHub";

// Domínio de tipEve no Senior: I = Incluir, E = Excluir, A = Alterar.
// Hoje o CaxHub só inclui — editar e excluir apontamento ficam bloqueados depois do
// registro (ver routes/apontamentos.ts). Quando esses fluxos existirem, é aqui que "A" e
// "E" entram.
export const TIP_EVE_INCLUIR = "I";
export const TIP_EVE = process.env.SENIOR_TIP_EVE ?? TIP_EVE_INCLUIR;

export interface ItemAtividadeSenior {
  /** Identificador externo do item — é a alça pra casar a resposta e pra reconciliar. */
  ideExt: string;
  seqite: number;
  datAti: string;
  horIni: string;
  horFim: string;
  desAti: string;
}

export interface RegistrarAtividadesPayload {
  codEmp: number;
  codFor: number;
  codPro: number;
  /** Identificador externo da RAT. Reenviar o mesmo valor ANEXA à mesma RAT no Senior. */
  ideExt: string;
  sisOri: string;
  tipEve: string;
  itens: ItemAtividadeSenior[];
}

export interface ItemRegistrado {
  ideExt: string | null;
  seqIte: number | null;
  seqRat: number | null;
  status: number | null;
  msg: string | null;
}

// Camada 3: recusa de negócio. `statusProcesso` 1 é sucesso — qualquer outro valor é
// recusa, e o texto vem em `mensagemProcesso` (geral) e no `msg` do item (específico).
// Os dois entram juntos porque nem sempre os dois vêm preenchidos, e qual deles traz o
// motivo varia com a recusa.
export function mensagemDeRecusa(
  resposta: Pick<RegistrarAtividadesResposta, "statusProcesso" | "mensagemProcesso">,
  msgDoItem: string | null | undefined
): string | null {
  if (resposta.statusProcesso === 1) return null;
  const detalhes = [resposta.mensagemProcesso, msgDoItem].filter(Boolean).join(" — ");
  return `Senior recusou o registro (statusProcesso=${resposta.statusProcesso}): ${detalhes || "sem mensagem"}`;
}

export interface RegistrarAtividadesResposta {
  /** 1 = sucesso (confirmado com o publicador do serviço). */
  statusProcesso: number | null;
  mensagemProcesso: string | null;
  erroExecucao: string | null;
  resultados: { ideExt: string | null; numRat: number | null; itens: ItemRegistrado[] }[];
}

// O parser XML devolve um objeto só quando há um elemento e array quando há vários —
// normalizar evita ter que testar isso em cada ponto de leitura da resposta.
function comoArray<T>(valor: T | T[] | undefined | null): T[] {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function numeroOuNulo(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

// `ideExt` vai como o ID local puro ("27530"), e o parser de XML converte isso em NÚMERO
// na volta. Normalizar pra string aqui é o que mantém o casamento da resposta funcionando
// — sem isso o valor viraria null e a leitura cairia no "pega o primeiro resultado", que
// só não quebra porque hoje se envia um item por vez.
function ideExtOuNulo(valor: unknown): string | null {
  if (typeof valor === "string") return valor === "" ? null : valor;
  if (typeof valor === "number") return String(valor);
  return null;
}

/** Monta o XML que seria enviado, sem enviar — usado pelo script de verificação manual. */
export function montarEnvelopeRegistrarAtividades(payload: RegistrarAtividadesPayload, user: string, password: string): string {
  const itensXml = payload.itens
    .map(
      (i) =>
        `<itens>` +
        `<datAti>${escapeXml(i.datAti)}</datAti>` +
        `<desAti>${escapeXml(i.desAti)}</desAti>` +
        `<horFim>${escapeXml(i.horFim)}</horFim>` +
        `<horIni>${escapeXml(i.horIni)}</horIni>` +
        `<ideExt>${escapeXml(i.ideExt)}</ideExt>` +
        `<seqite>${i.seqite}</seqite>` +
        `</itens>`
    )
    .join("");

  const parametersXml =
    `<codEmp>${payload.codEmp}</codEmp>` +
    `<codFor>${payload.codFor}</codFor>` +
    `<codPro>${payload.codPro}</codPro>` +
    `<ideExt>${escapeXml(payload.ideExt)}</ideExt>` +
    itensXml +
    `<sisOri>${escapeXml(payload.sisOri)}</sisOri>` +
    `<tipEve>${escapeXml(payload.tipEve)}</tipEve>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="${SENIOR_NAMESPACE}">
  <soapenv:Header/>
  <soapenv:Body>
    <ser:registrarAtividades>
      <user>${escapeXml(user)}</user>
      <password>${escapeXml(password)}</password>
      <encryption>0</encryption>
      <parameters>${parametersXml}</parameters>
    </ser:registrarAtividades>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Registra apontamentos (RAT + itens) no Senior.
 *
 * Não interpreta sucesso/fracasso — devolve a resposta normalizada e deixa a decisão pro
 * chamador (sync/outboxSenior.ts), que é quem sabe o que fazer com cada item. Só lança
 * quando a chamada em si falha (rede, XML inesperado, erroExecucao preenchido).
 */
export async function registrarAtividadesViaSoap(payload: RegistrarAtividadesPayload): Promise<RegistrarAtividadesResposta> {
  const soapUrl = process.env.SOAP_URL;
  const soapUser = process.env.SOAP_USER;
  const soapPassword = process.env.SOAP_PASSWORD;

  if (!soapUrl || !soapUser || !soapPassword) {
    throw new Error("SOAP_URL, SOAP_USER e SOAP_PASSWORD precisam estar definidos no .env");
  }

  const endpoint = soapUrl.replace(/\?wsdl$/i, "");
  const envelope = montarEnvelopeRegistrarAtividades(payload, soapUser, soapPassword);

  const response = await axios
    .post(endpoint, envelope, {
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
      timeout: 20000,
    })
    .catch((erro) => {
      throw new Error(mensagemDeFalhaSoap(erro, "registrarAtividades"));
    });

  const parsed = parser.parse(response.data);
  const result = parsed?.["S:Envelope"]?.["S:Body"]?.["ns2:registrarAtividadesResponse"]?.result;

  if (!result) {
    throw new Error("Resposta SOAP de registrarAtividades em formato inesperado — ajustar parsing em soap/client.ts");
  }

  const erroExecucao = textoOuNulo(result.erroExecucao);
  if (erroExecucao) {
    throw new Error(`Erro no serviço Senior (registrarAtividades): ${erroExecucao}`);
  }

  return {
    // camada 3 fica pro chamador (ver mensagemDeRecusa) — ele é quem tem o item da
    // resposta em mãos, e o motivo específico costuma vir no `msg` dele.
    statusProcesso: numeroOuNulo(result.statusProcesso),
    mensagemProcesso: textoOuNulo(result.mensagemProcesso),
    erroExecucao,
    resultados: comoArray<Record<string, unknown>>(result.result).map((r) => ({
      ideExt: ideExtOuNulo(r.ideExt),
      numRat: numeroOuNulo(r.numRat),
      itens: comoArray<Record<string, unknown>>(r.itens as never).map((i) => ({
        ideExt: ideExtOuNulo(i.ideExt),
        seqIte: numeroOuNulo(i.seqIte),
        seqRat: numeroOuNulo(i.seqRat),
        status: numeroOuNulo(i.status),
        msg: textoOuNulo(i.msg),
      })),
    })),
  };
}

const PAGE_SIZE = 10000;

/**
 * Para tabelas grandes, o serviço "Consulta Genérica" retorna uma resposta
 * vazia/truncada quando o resultado é grande demais (testado: quebra entre
 * 30.000 e 40.000 linhas). Esta função pagina automaticamente com
 * limit/offSet até não haver mais linhas.
 *
 * A query precisa ser determinística entre chamadas — por isso um ORDER BY
 * (idealmente pelas colunas de chave primária) é obrigatório.
 */
export async function runSqlViaSoapPaginated(
  query: string,
  orderByColumns: string[],
  pageSize: number = PAGE_SIZE
): Promise<unknown[]> {
  const orderedQuery = `${query} ORDER BY ${orderByColumns.join(", ")}`;
  const allRows: unknown[] = [];
  let offSet = 0;

  while (true) {
    const page = await runSqlViaSoap(orderedQuery, { limit: pageSize, offSet });
    allRows.push(...page);
    if (page.length < pageSize) break;
    offSet += pageSize;
  }

  return allRows;
}
