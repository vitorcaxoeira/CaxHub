import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { normalizar } from "../../lib/normalizarBusca";
import { alternarRegra, type ContaDoPlano, type RegraConta } from "../../lib/rentabilidade";

// Seletor de contas do plano contábil por REGRAS (incluir / excluir, em qualquer nível): uma conta sintética vale por todas as analíticas abaixo dela, e excluir
// tira a conta e tudo abaixo do que foi incluído. Usado nos Indicadores de Rentabilidade e nas Contas da folha do Custo-hora real (extraído em 19/11/2026,
// era interno da tela de indicadores). A semântica é a do servidor: domain/rentabilidade/indicadores.ts (`contasSelecionadas`).

const CAMPO = "w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP = "rounded border border-border bg-surface-2/60 px-1.5 py-0.5 text-[11.5px] text-foreground transition hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Empresa do plano quando a conta não a informa (a Soeltech só tem a 1). */
const CODEMP = 1;

interface Props {
  plano: ContaDoPlano[] | null;
  regras: RegraConta[];
  onChange: (r: RegraConta[]) => void;
  /** Rótulo do campo de busca. */
  rotuloBusca?: string;
  /** Esconde o texto de ajuda do rodapé (telas que preferem só mensagens do que foi feito). */
  semAjuda?: boolean;
}

export function SeletorContas({ plano, regras, onChange, rotuloBusca = "Contas do plano (qualquer nível)", semAjuda = false }: Props) {
  const [busca, setBusca] = useState("");
  const acaoDe = useMemo(() => new Map(regras.map((r) => [r.ctared, r.acao])), [regras]);
  const porCtared = useMemo(() => new Map((plano ?? []).map((c) => [c.ctared, c])), [plano]);

  const lista = useMemo(() => {
    if (!plano) return [];
    const q = normalizar(busca.trim());
    const base = q ? plano.filter((c) => normalizar(`${c.clacta} ${c.descta} ${c.ctared}`).includes(q)) : plano;
    return base.slice(0, 120);
  }, [plano, busca]);

  const alternar = (c: ContaDoPlano, acao: "incluir" | "excluir") => onChange(alternarRegra(regras, { codemp: c.codemp || CODEMP, ctared: c.ctared }, acao));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {rotuloBusca}
            <input className={CAMPO} placeholder="Buscar por classificação, nome ou número reduzido…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
        </div>
        <span className="pb-2 text-xs text-muted">
          {regras.length} regra{regras.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="max-h-64 overflow-auto rounded-md border border-border">
        {!plano && <p className="px-3 py-4 text-sm text-muted">Carregando o plano de contas…</p>}
        {plano && lista.length === 0 && <p className="px-3 py-4 text-sm text-muted">Nenhuma conta encontrada.</p>}
        {lista.map((c) => {
          const acao = acaoDe.get(c.ctared);
          return (
            <div key={`${c.codemp}-${c.ctared}`} className={cn("flex items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5 text-[13px] last:border-b-0", acao === "incluir" && "bg-primary/5", acao === "excluir" && "bg-destructive/5")}>
              <span className="min-w-0 flex-1 truncate" style={{ paddingLeft: busca ? 0 : Math.max(0, ((c.nivcta ?? 1) - 1) * 12) }} title={`${c.clacta} · ${c.descta}`}>
                <span className="font-mono text-xs text-muted">{c.clacta}</span> {c.descta} <span className="text-xs text-muted">({c.ctared})</span>{" "}
                <span className="rounded bg-surface-2 px-1 text-[10px] text-muted">{c.anasin === "A" ? "analítica" : "sintética"}</span>
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
        {plano && !busca && plano.length > 120 && <p className="px-3 py-2 text-xs text-muted">Mostrando as primeiras 120 contas: use a busca para achar as demais.</p>}
      </div>
      {regras.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Regras escolhidas">
          {regras.map((r) => {
            const c = porCtared.get(r.ctared);
            return (
              <button key={r.ctared} type="button" className={cn(CHIP, r.acao === "excluir" && "border-destructive/50 text-destructive")} title="Remover esta regra" onClick={() => onChange(regras.filter((x) => x.ctared !== r.ctared))}>
                {r.acao === "incluir" ? "+" : "−"} {r.ctared}
                {c ? ` ${c.descta.slice(0, 28)}` : " (fora do plano)"} ×
              </button>
            );
          })}
        </div>
      )}
      {!semAjuda && <p className="text-[11px] text-muted">Incluir uma conta sintética soma todas as analíticas abaixo dela. Excluir tira a conta e tudo abaixo dela do que foi incluído.</p>}
    </div>
  );
}
