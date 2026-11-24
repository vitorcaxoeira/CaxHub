import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { normalizar } from "../../lib/normalizarBusca";
import {
  alternarRegra,
  chaveDaConta,
  contasComFilhos,
  contasVisiveis,
  planoComAncestrais,
  type ContaDoPlano,
  type RegraConta,
} from "../../lib/rentabilidade";
import { CaixaMarcacaoFiltro } from "../ui/ControlesFiltro";

// Seletor de contas do plano contábil por REGRAS (incluir / excluir, em qualquer nível): uma conta sintética vale por todas as analíticas abaixo dela, e excluir
// tira a conta e tudo abaixo do que foi incluído. Usado nos Indicadores de Rentabilidade e nas Contas da folha do Custo-hora real (extraído em 19/11/2026,
// era interno da tela de indicadores). A semântica é a do servidor: domain/rentabilidade/indicadores.ts (`contasSelecionadas`).
// 24/11/2026: sem busca, o plano é uma ÁRVORE com expansor de níveis (mesma lógica e seta da MatrizContabil do Resultado Analítico; começa recolhida);
// as regras escolhidas ficam num acordeão "Contas no cálculo"; e a tela pode oferecer um recorte (ex.: "Só contas usadas na folha").

const CAMPO = "w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP = "rounded border border-border bg-surface-2/60 px-1.5 py-0.5 text-[11.5px] text-foreground transition hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Empresa do plano quando a conta não a informa (a Soeltech só tem a 1). */
const CODEMP = 1;
/** Com busca, a lista é plana: mostra até este tanto de resultados. */
const LIMITE_BUSCA = 120;

interface Props {
  plano: ContaDoPlano[] | null;
  regras: RegraConta[];
  onChange: (r: RegraConta[]) => void;
  /** Rótulo do campo de busca. */
  rotuloBusca?: string;
  /** Esconde o texto de ajuda do rodapé (telas que preferem só mensagens do que foi feito). */
  semAjuda?: boolean;
  /** Recorte opcional do plano, ligado por uma caixa de marcação (ex.: as contas que a folha contabiliza). Só muda o que se vê; as regras ficam. */
  recorte?: { rotulo: string; contas: ReadonlySet<string> };
}

/** Seta de expandir/recolher (a mesma da MatrizContabil). */
function Seta({ aberta }: { aberta: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={cn("transition-transform", aberta && "rotate-90")}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

export function SeletorContas({ plano, regras, onChange, rotuloBusca = "Contas do plano (qualquer nível)", semAjuda = false, recorte }: Props) {
  const [busca, setBusca] = useState("");
  const [expandidos, setExpandidos] = useState<ReadonlySet<string>>(new Set());
  const [acordeaoAberto, setAcordeaoAberto] = useState(false);
  const [soRecorte, setSoRecorte] = useState(false);
  const acaoDe = useMemo(() => new Map(regras.map((r) => [r.ctared, r.acao])), [regras]);
  const porCtared = useMemo(() => new Map((plano ?? []).map((c) => [c.ctared, c])), [plano]);

  // O plano que a árvore e a busca enxergam: inteiro, ou só o recorte (com as sintéticas acima dele).
  const base = useMemo(() => {
    if (!plano) return [];
    return recorte && soRecorte ? planoComAncestrais(plano, recorte.contas) : plano;
  }, [plano, recorte, soRecorte]);
  const temFilhos = useMemo(() => contasComFilhos(base), [base]);
  const tudoExpandido = temFilhos.size > 0 && [...temFilhos].every((k) => expandidos.has(k));

  const q = normalizar(busca.trim());
  const lista = useMemo(() => {
    if (q) return base.filter((c) => normalizar(`${c.clacta} ${c.descta} ${c.ctared}`).includes(q)).slice(0, LIMITE_BUSCA);
    return contasVisiveis(base, expandidos);
  }, [base, q, expandidos]);
  const resultadosBusca = q ? base.filter((c) => normalizar(`${c.clacta} ${c.descta} ${c.ctared}`).includes(q)).length : 0;

  const alternar = (c: ContaDoPlano, acao: "incluir" | "excluir") => onChange(alternarRegra(regras, { codemp: c.codemp || CODEMP, ctared: c.ctared }, acao));
  function alternarExpandir(chave: string) {
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(chave)) proximo.add(chave);
      return proximo;
    });
  }

  const incluidas = regras.filter((r) => r.acao === "incluir").length;
  const excluidas = regras.length - incluidas;
  // Regras na ordem do plano (classificação); as de conta fora do plano no fim.
  const regrasOrdenadas = useMemo(
    () => [...regras].sort((a, b) => (porCtared.get(a.ctared)?.clacta ?? "￿").localeCompare(porCtared.get(b.ctared)?.clacta ?? "￿") || a.ctared - b.ctared),
    [regras, porCtared]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
          {rotuloBusca}
          <input className={CAMPO} placeholder="Buscar por classificação, nome ou número reduzido…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        {recorte && (
          <CaixaMarcacaoFiltro marcado={soRecorte} onChange={setSoRecorte}>
            {recorte.rotulo}
          </CaixaMarcacaoFiltro>
        )}
      </div>

      <div className="rounded-md border border-border">
        {!q && temFilhos.size > 0 && (
          <div className="border-b border-border px-3 py-1.5">
            <button
              type="button"
              onClick={() => setExpandidos(tudoExpandido ? new Set() : new Set(temFilhos))}
              className="text-[12px] text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tudoExpandido ? "Recolher tudo" : "Expandir tudo"}
            </button>
          </div>
        )}
        <div className="max-h-72 overflow-auto">
          {!plano && <p className="px-3 py-4 text-sm text-muted">Carregando o plano de contas…</p>}
          {plano && lista.length === 0 && <p className="px-3 py-4 text-sm text-muted">Nenhuma conta encontrada.</p>}
          {lista.map((c) => {
            const chave = chaveDaConta(c);
            const acao = acaoDe.get(c.ctared);
            const podeExpandir = !q && temFilhos.has(chave);
            return (
              <div
                key={chave}
                className={cn(
                  "flex items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5 text-[13px] last:border-b-0",
                  acao === "incluir" && "bg-primary/5",
                  acao === "excluir" && "bg-destructive/5"
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5" style={{ paddingLeft: q ? 0 : Math.max(0, ((c.nivcta ?? 1) - 1) * 14) }}>
                  {podeExpandir ? (
                    <button
                      type="button"
                      onClick={() => alternarExpandir(chave)}
                      aria-label={expandidos.has(chave) ? "Recolher" : "Expandir"}
                      className="flex h-4 w-4 flex-none items-center justify-center text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Seta aberta={expandidos.has(chave)} />
                    </button>
                  ) : (
                    !q && <span className="w-4 flex-none" />
                  )}
                  <span className="min-w-0 flex-1 truncate" title={`${c.clacta} · ${c.descta}`}>
                    <span className="font-mono text-xs text-muted">{c.clacta}</span> {c.descta} <span className="text-xs text-muted">({c.ctared})</span>{" "}
                    <span className="rounded bg-surface-2 px-1 text-[10px] text-muted">{c.anasin === "A" ? "analítica" : "sintética"}</span>
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-pressed={acao === "incluir"} className={cn(CHIP, acao === "incluir" && "border-primary bg-primary/10 text-primary")} onClick={() => alternar(c, "incluir")}>
                    Incluir
                  </button>
                  <button type="button" aria-pressed={acao === "excluir"} className={cn(CHIP, acao === "excluir" && "border-destructive bg-destructive/10 text-destructive")} onClick={() => alternar(c, "excluir")}>
                    Excluir
                  </button>
                </span>
              </div>
            );
          })}
          {q && resultadosBusca > LIMITE_BUSCA && <p className="px-3 py-2 text-xs text-muted">Mostrando {LIMITE_BUSCA} de {resultadosBusca}: refine a busca.</p>}
        </div>
      </div>

      {/* Acordeão das contas que entram no cálculo: fechado mostra só a contagem; aberto, a borda fecha em volta da lista. */}
      {regras.length > 0 && (
        <div className={cn("rounded-md border", acordeaoAberto ? "border-primary" : "border-border")}>
          <button
            type="button"
            onClick={() => setAcordeaoAberto((a) => !a)}
            aria-expanded={acordeaoAberto}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-muted">
              <Seta aberta={acordeaoAberto} />
            </span>
            <span className="font-medium">Contas no cálculo</span>
            <span className="text-xs text-muted">
              {regras.length} regra{regras.length === 1 ? "" : "s"} · {incluidas} incluída{incluidas === 1 ? "" : "s"} · {excluidas} excluída{excluidas === 1 ? "" : "s"}
            </span>
          </button>
          {acordeaoAberto && (
            <div className="max-h-64 overflow-auto border-t border-border">
              {regrasOrdenadas.map((r) => {
                const c = porCtared.get(r.ctared);
                return (
                  <div key={r.ctared} className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5 text-[13px] last:border-b-0">
                    <span className="min-w-0 flex-1 truncate" title={c ? `${c.clacta} · ${c.descta}` : undefined}>
                      <span className={cn("mr-2 rounded px-1.5 py-0.5 text-[10.5px] font-medium", r.acao === "incluir" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
                        {r.acao === "incluir" ? "Incluída" : "Excluída"}
                      </span>
                      {c ? (
                        <>
                          <span className="font-mono text-xs text-muted">{c.clacta}</span> {c.descta}{" "}
                        </>
                      ) : (
                        <span className="text-muted">(fora do plano) </span>
                      )}
                      <span className="text-xs text-muted">({r.ctared})</span>
                    </span>
                    <button type="button" className={CHIP} onClick={() => onChange(regras.filter((x) => x.ctared !== r.ctared))}>
                      Remover
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {!semAjuda && <p className="text-[11px] text-muted">Incluir uma conta sintética soma todas as analíticas abaixo dela. Excluir tira a conta e tudo abaixo dela do que foi incluído.</p>}
    </div>
  );
}
