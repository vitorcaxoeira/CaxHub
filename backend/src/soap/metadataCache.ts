// Cache em memória pro dicionário de dados do Senior (r996fld/r996tbl/r998fld/r998tbl e os
// domínios de r996lsf/r998lsf) — Fase 2 do plano de filtros na importação
// (~/.claude/plans/se-liga-na-necessidade-resilient-lark.md). Não existia nenhum cache antes
// desta feature: toda chamada a getTableFields/getFieldDomainValues era um round-trip SOAP
// novo (~3s, timeout 20s). O dicionário é praticamente imutável (muda só quando alguém mexe
// no cadastro de tabela/campo customizado no Senior, evento raro e administrativo) — TTL
// longo (12h) é seguro e evita reconsultar o mesmo catálogo a cada vez que um admin abre a
// mesma linha da tela de Importados do Senior.
//
// Deliberadamente em memória, não em tabela do Postgres: processo único no compose (mesma
// premissa já assumida por filtrosAtivos.ts, Fase 3), reinicia raramente, e o pior caso de
// cache frio é só "mais um round-trip SOAP" — não vale a complexidade de uma tabela pra isso.
const TTL_MS = 12 * 60 * 60 * 1000; // 12h

interface Entrada<T> {
  valor: T;
  expiraEm: number;
}

const cache = new Map<string, Entrada<unknown>>();

/** Busca no cache, ou executa `buscar()` e guarda o resultado por TTL_MS. */
export async function comCache<T>(chave: string, buscar: () => Promise<T>): Promise<T> {
  const entrada = cache.get(chave) as Entrada<T> | undefined;
  if (entrada && entrada.expiraEm > Date.now()) {
    return entrada.valor;
  }
  const valor = await buscar();
  cache.set(chave, { valor, expiraEm: Date.now() + TTL_MS });
  return valor;
}

/** Derruba uma entrada específica (ou o cache inteiro, sem argumento) — uso administrativo/teste. */
export function invalidarCache(chave?: string): void {
  if (chave) cache.delete(chave);
  else cache.clear();
}
