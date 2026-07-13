import axios from "axios";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false });

/**
 * Executa uma consulta SQL através da API SOAP legada e devolve o JSON
 * já desencapsulado do envelope de resposta.
 *
 * O envelope abaixo é um placeholder — precisa ser ajustado para o
 * formato exato exigido pela API assim que tivermos o WSDL/exemplo real
 * de request e response.
 */
export async function runSqlViaSoap(sql: string): Promise<unknown> {
  const soapUrl = process.env.SOAP_URL;
  const soapUser = process.env.SOAP_USER;
  const soapPassword = process.env.SOAP_PASSWORD;

  if (!soapUrl || !soapUser || !soapPassword) {
    throw new Error("SOAP_URL, SOAP_USER e SOAP_PASSWORD precisam estar definidos no .env");
  }

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <Auth>
      <User>${soapUser}</User>
      <Password>${soapPassword}</Password>
    </Auth>
  </soap:Header>
  <soap:Body>
    <ExecuteQuery>
      <Sql><![CDATA[${sql}]]></Sql>
    </ExecuteQuery>
  </soap:Body>
</soap:Envelope>`;

  const response = await axios.post(soapUrl, envelope, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });

  const parsed = parser.parse(response.data);
  const rawJson =
    parsed?.["soap:Envelope"]?.["soap:Body"]?.["ExecuteQueryResponse"]?.["ExecuteQueryResult"];

  if (!rawJson) {
    throw new Error("Resposta SOAP em formato inesperado — ajustar parsing em soap/client.ts");
  }

  return JSON.parse(rawJson);
}
