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

// Busca feriados de todos os anos que o período [de, ate] atravessa (normalmente 1, pode
// ser 2 se o período cruzar virada de ano) e devolve só os que caem dentro do intervalo.
export async function carregarFeriadosDoPeriodo(de: string, ate: string): Promise<Feriado[]> {
  const anoDe = Number(de.slice(0, 4));
  const anoAte = Number(ate.slice(0, 4));
  const anos = anoDe === anoAte ? [anoDe] : [anoDe, anoAte];
  const listas = await Promise.all(anos.map(carregarFeriados));
  return listas.flat().filter((f) => f.date >= de && f.date <= ate);
}
