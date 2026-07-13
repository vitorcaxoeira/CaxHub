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

  const response = await axios.post(endpoint, envelope, {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '""',
    },
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

  // O conteúdo dentro do base64 vem em Latin-1/Windows-1252 (não UTF-8) —
  // decodificar como utf-8 corrompe acentos (ex.: "Aliança" virava "Alian�a").
  const json = Buffer.from(result.pmJsonResponse, "base64").toString("latin1");
  return JSON.parse(json);
}
