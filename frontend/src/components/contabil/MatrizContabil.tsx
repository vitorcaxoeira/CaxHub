import { useMemo, useState } from "react";

// Espelha backend/src/domain/matrizContabil.ts (LinhaMatrizResultado) — resposta de
// GET /contabil/resultado.
export interface LinhaMatrizContabil {
  chave: string;
  chavePai: string | null;
  nivel: number;
  rotulo: string;
  // "grupo" = Conta Paralela, "conta" = conta contábil (inclui os níveis reais 1-6 do plano,
  // sem nível sintético Receitas/Despesas — removido em 26/08/2026, o próprio nível 1 real já
  // cumpre esse papel).
  tipo: "grupo" | "conta";
  /** Nível da conta no plano (E045PLA.NivCta); null em grupo/bucket. */
  nivelPlano: number | null;
  anasin: string | null;
  valores: number[];
  total: number;
  /**
   * `ctared`s das contas-folha que compõem este nó (só em `tipo: "conta"` — ver
   * LinhaMatrizResultado.ctareds no backend). Normalmente 1 item; pode ter mais quando o
   * filtro de níveis oculta o nível da folha real. É o que o drilldown de lançamentos usa pra
   * bater exatamente com o valor exibido, em vez de assumir 1 folha = 1 conta.
   */
  ctareds: number[];
}

// Parâmetros do valor clicado, repassados pra quem abre o modal de detalhe — a MESMA
// identidade (contas + mês) que o backend precisa pra devolver os lançamentos certos (ver
// GET /contabil/resultado/lancamentos).
export interface ValorClicado {
  ctareds: number[];
  mesReferencia: string;
  rotulo: string;
}

interface MatrizContabilProps {
  meses: string[]; // ["2026-01", ..., "2026-12"]
  linhas: LinhaMatrizContabil[];
  totalGeral: { valores: number[]; total: number };
  loading: boolean;
  /** Header da 1ª coluna — "Conta" (padrão) ou "Centro de Custo" na aba de CC. */
  rotuloColuna?: string;
  // Drilldown de lançamentos — só a aba Matriz passa isto hoje. Sem ela, os valores continuam
  // texto puro (Orçado x Realizado e Centro de Custo ainda não têm o detalhe implementado).
  onClickValor?: (params: ValorClicado) => void;
}

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

// Exportada pro modal de detalhe de lançamentos (mesmo formato "Jun/26" no subtítulo).
export function formatarMes(mes: string): string {
  const [ano, mesNum] = mes.split("-");
  return `${MESES_ABREV[Number(mesNum) - 1]}/${ano.slice(2)}`;
}

function Valor({ v, className = "" }: { v: number; className?: string }) {
  return (
    <span className={`font-mono text-[12.5px] tabular-nums ${v < 0 ? "text-destructive" : "text-foreground"} ${className}`}>
      {numero.format(v)}
    </span>
  );
}

export function MatrizContabil({ meses, linhas, totalGeral, loading, rotuloColuna = "Conta", onClickValor }: MatrizContabilProps) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  // "Chave -> tem filhos" — decide se a linha ganha seta de expandir/recolher.
  const temFilhos = useMemo(() => {
    const s = new Set<string>();
    for (const l of linhas) if (l.chavePai) s.add(l.chavePai);
    return s;
  }, [linhas]);

  const tudoExpandido = temFilhos.size > 0 && [...temFilhos].every((chave) => expandidos.has(chave));

  // Mesma lógica de visibilidade de ArvoreCronograma.tsx: `linhas` já vem em pré-ordem do
  // backend (pai sempre antes dos filhos), então uma passada só basta — uma linha some se
  // o próprio pai estiver oculto, e a ocultação se propaga pros filhos dela também.
  const visiveis = useMemo(() => {
    const ocultos = new Set<string>();
    const resultado: LinhaMatrizContabil[] = [];
    for (const linha of linhas) {
      if (linha.chavePai && ocultos.has(linha.chavePai)) {
        ocultos.add(linha.chave);
        continue;
      }
      resultado.push(linha);
      if (!expandidos.has(linha.chave)) ocultos.add(linha.chave);
    }
    return resultado;
  }, [linhas, expandidos]);

  function alternarExpandir(chave: string) {
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }

  function alternarExpandirTudo() {
    setExpandidos(tudoExpandido ? new Set() : new Set(temFilhos));
  }

  if (loading) {
    return (
      <div className="space-y-0 rounded-lg border border-border bg-surface">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex h-9 items-center gap-2 border-b border-border/50 px-4">
            <div className="h-3 flex-1 max-w-[240px] animate-pulse rounded bg-surface-2" />
            <div className="ml-auto h-3 w-64 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
    );
  }

  if (linhas.length === 0) {
    return <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">Nenhum resultado com os filtros atuais.</p>;
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <button
          onClick={alternarExpandirTudo}
          className="text-[12px] text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {tudoExpandido ? "Recolher tudo" : "Expandir tudo"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="sticky left-0 z-10 w-[340px] max-w-[340px] bg-surface-2 px-4 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                {rotuloColuna}
              </th>
              {meses.map((mes) => (
                <th key={mes} className="min-w-[92px] px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                  {formatarMes(mes)}
                </th>
              ))}
              <th className="min-w-[100px] px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((linha) => {
              const podeExpandir = temFilhos.has(linha.chave);
              const expandido = expandidos.has(linha.chave);
              return (
                <tr key={linha.chave} className="border-b border-border/50 hover:bg-surface-2/60">
                  <td
                    className={`sticky left-0 z-10 w-[340px] max-w-[340px] bg-surface px-4 py-1.5 ${
                      linha.tipo === "conta" ? "" : "font-semibold"
                    }`}
                    // 14px por nível (não 18): com grupo + Receitas/Despesas + até 6 níveis de
                    // conta, a indentação come a coluna fixa e não sobra texto legível.
                    style={{ paddingLeft: 16 + linha.nivel * 14 }}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {podeExpandir ? (
                        <button
                          onClick={() => alternarExpandir(linha.chave)}
                          className="flex h-4 w-4 flex-none items-center justify-center text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`transition-transform ${expandido ? "rotate-90" : ""}`}
                          >
                            <polyline points="9 6 15 12 9 18" />
                          </svg>
                        </button>
                      ) : (
                        <span className="w-4 flex-none" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={linha.rotulo}>
                        {linha.rotulo}
                      </span>
                    </div>
                  </td>
                  {linha.valores.map((v, i) => {
                    // Link só no último nível REALMENTE exibido (folha visível, não pasta/grupo
                    // recolhida por cima dela) e só quando há algo pra detalhar (conta real,
                    // ctareds preenchido, valor diferente de zero) — regra 2 do pedido.
                    const podeDetalhar = Boolean(
                      onClickValor && linha.tipo === "conta" && !podeExpandir && linha.ctareds.length > 0 && v !== 0
                    );
                    return (
                      <td key={i} className="px-3 py-1.5 text-right">
                        {podeDetalhar ? (
                          <button
                            type="button"
                            onClick={() => onClickValor!({ ctareds: linha.ctareds, mesReferencia: meses[i], rotulo: linha.rotulo })}
                            className="rounded px-1 -mx-1 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title="Ver os lançamentos que compõem este valor"
                          >
                            <Valor v={v} className="underline decoration-dotted underline-offset-2" />
                          </button>
                        ) : (
                          <Valor v={v} />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right">
                    <Valor v={linha.total} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-surface-2">
              <td className="sticky left-0 z-10 w-[340px] max-w-[340px] truncate bg-surface-2 px-4 py-2 font-semibold text-[13px] text-foreground">
                Total
              </td>
              {totalGeral.valores.map((v, i) => (
                <td key={i} className="px-3 py-2 text-right">
                  <Valor v={v} />
                </td>
              ))}
              <td className="px-3 py-2 text-right">
                <Valor v={totalGeral.total} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
