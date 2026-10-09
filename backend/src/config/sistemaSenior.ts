// O Dash lê o Senior por DOIS sistemas, cada um com seu canal SOAP:
//   erp   Gestão Empresarial (financeiro, contábil, suprimentos, mercado, manufatura)
//   hcm   Gestão de Pessoas / Vetorh (módulo rh)
//
// O ERP é o padrão em tudo: quem não passa `sistema` continua falando com o ERP, exatamente como
// antes do HCM existir. Variáveis de instância (.env):
//   SOAP_URL / SOAP_USER / SOAP_PASSWORD                      canal do ERP
//   SENIOR_HCM_SOAP_URL / SENIOR_HCM_SOAP_USER / ..._PASSWORD  canal próprio do HCM (opcional)
//   SENIOR_HCM_BANCO     prefixo das tabelas do HCM quando ele é lido por outro canal que não o
//                        dele, ex.: "rhsenior.dbo." (o serviço do ERP enxerga o database do RH).
//                        Vazio = as tabelas estão no banco da própria conexão.
//   (dialeto: o Senior do CaxHub é SQL Server nos dois sistemas; ver sync/dialetoSenior.ts)
//
// Regra do canal do HCM: se SENIOR_HCM_SOAP_URL estiver preenchida, o trio do HCM vale inteiro
// (os três são obrigatórios); se estiver vazia, o HCM usa o canal do ERP. Misturar URL do HCM com
// usuário do ERP daria um erro de login difícil de enxergar.

export type SistemaSenior = "erp" | "hcm";

export const SISTEMAS_SENIOR: readonly SistemaSenior[] = ["erp", "hcm"];

export interface ConexaoSenior {
  sistema: SistemaSenior;
  url: string;
  usuario: string;
  senha: string;
  /** Prefixo das tabelas, já com o ponto final ("rhsenior.dbo.") ou "". */
  prefixo: string;
  /** Verdadeiro quando o HCM usa o canal do ERP (nenhuma variável SENIOR_HCM_SOAP_* preenchida). */
  herdaDoErp: boolean;
}

function env(nome: string): string {
  return (process.env[nome] ?? "").trim();
}

function normalizarPrefixo(bruto: string): string {
  const p = bruto.trim();
  if (!p) return "";
  if (!/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]*)*\.?$/.test(p)) {
    throw new Error(`SENIOR_HCM_BANCO inválido: "${p}" (use algo como "rhsenior.dbo.")`);
  }
  return p.endsWith(".") ? p : `${p}.`;
}

/** Conexão do sistema, lida do ambiente a cada chamada (os testes e o .env trocam valores). Lança
 * com a lista do que falta, em vez de deixar o SOAP falhar com "Request failed". */
export function conexaoSenior(sistema: SistemaSenior = "erp"): ConexaoSenior {
  if (sistema === "erp") {
    const url = env("SOAP_URL");
    const usuario = env("SOAP_USER");
    const senha = env("SOAP_PASSWORD");
    if (!url || !usuario || !senha) {
      throw new Error("SOAP_URL, SOAP_USER e SOAP_PASSWORD precisam estar definidos no .env");
    }
    return { sistema, url, usuario, senha, prefixo: "", herdaDoErp: false };
  }

  const urlHcm = env("SENIOR_HCM_SOAP_URL");
  const prefixo = normalizarPrefixo(env("SENIOR_HCM_BANCO"));
  if (urlHcm) {
    const usuario = env("SENIOR_HCM_SOAP_USER");
    const senha = env("SENIOR_HCM_SOAP_PASSWORD");
    if (!usuario || !senha) {
      throw new Error("SENIOR_HCM_SOAP_URL está preenchida: defina também SENIOR_HCM_SOAP_USER e SENIOR_HCM_SOAP_PASSWORD");
    }
    return { sistema, url: urlHcm, usuario, senha, prefixo, herdaDoErp: false };
  }
  const erp = conexaoSenior("erp");
  return { ...erp, sistema, prefixo, herdaDoErp: true };
}

/** Nome da tabela como entra num FROM do sistema: "r034fun" -> "rhsenior.dbo.r034fun" no HCM. */
export function tabelaSenior(tabela: string, sistema: SistemaSenior = "erp"): string {
  const nome = nomeSemPrefixo(tabela);
  if (sistema === "erp") return nome;
  return `${normalizarPrefixo(env("SENIOR_HCM_BANCO"))}${nome}`;
}

/** "rhsenior.dbo.r034fun" -> "r034fun". O dicionário (r996*) guarda o nome sem banco/schema. */
export function nomeSemPrefixo(tabela: string): string {
  const i = tabela.lastIndexOf(".");
  return i === -1 ? tabela : tabela.slice(i + 1);
}

/** Prefixo do sistema para ler as tabelas do dicionário (r996fld etc.). */
export function prefixoDoSistema(sistema: SistemaSenior = "erp"): string {
  return sistema === "erp" ? "" : normalizarPrefixo(env("SENIOR_HCM_BANCO"));
}

/** O HCM está configurado nesta instância? Usado para não agendar jobs à toa. Só vale como configurado
 * quem declarou ONDE ele está (canal próprio ou prefixo de banco): o canal do ERP sozinho não basta, porque
 * as tabelas do RH não existem no banco do ERP e a sincronização falharia todo dia no log. */
export function hcmConfigurado(): boolean {
  if (!env("SENIOR_HCM_SOAP_URL") && !env("SENIOR_HCM_BANCO")) return false;
  try {
    conexaoSenior("hcm");
    return true;
  } catch {
    return false;
  }
}

/** URL sem credenciais embutidas e com o caminho do serviço, para mostrar na tela de conexão. */
export function urlMascarada(url: string): string {
  try {
    const u = new URL(url.replace(/\?wsdl$/i, ""));
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "(URL inválida)";
  }
}
