// Feriados nacionais via BrasilAPI (pública, gratuita, sem CORS) — mesma fonte usada pelo
// dashboard de referência (psoffice-dashboard) que inspirou esta tela. Chamada direto do
// navegador, sem proxy no backend: não há tabela nem sync novo só pra isso, e o cache em
// localStorage evita rebater a API a cada visita à Home (feriado de um ano não muda).
export interface Feriado {
  date: string; // YYYY-MM-DD
  name: string;
  type: string;
}

const PREFIXO_CACHE = "caxhub:feriados:";

export async function carregarFeriados(ano: number): Promise<Feriado[]> {
  const chave = `${PREFIXO_CACHE}${ano}`;
  const cache = localStorage.getItem(chave);
  if (cache) {
    try {
      return JSON.parse(cache) as Feriado[];
    } catch {
      // cache corrompido — ignora e busca de novo
    }
  }
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    if (!resp.ok) return [];
    const feriados = (await resp.json()) as Feriado[];
    localStorage.setItem(chave, JSON.stringify(feriados));
    return feriados;
  } catch {
    // API fora do ar não pode quebrar o dashboard — só fica sem a lista de feriados.
    return [];
  }
}
