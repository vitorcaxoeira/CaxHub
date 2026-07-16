import { useState } from "react";

export interface PontoProjecao {
  janela: string;
  previsto: number;
  saldoAcumulado: number;
}

interface CurvaProjetadaChartProps {
  pontos: PontoProjecao[];
  limiar: number;
  onSalvarLimiar: (valor: number) => Promise<void>;
  formatarValor: (valor: number) => string;
}

// Soma acumulada só de ENTRADAS previstas partindo de zero — não existe saldo
// de caixa real no sistema (Contas a Pagar é dado de exemplo, contas correntes
// não têm campo de saldo), então isso não é um saldo bancário projetado.
export function CurvaProjetadaChart({ pontos, limiar, onSalvarLimiar, formatarValor }: CurvaProjetadaChartProps) {
  const [valorInput, setValorInput] = useState(String(limiar));
  const [salvando, setSalvando] = useState(false);

  const scaleMax = Math.max(1, ...pontos.map((p) => p.saldoAcumulado), limiar);
  const primeiroAbaixoIdx = limiar > 0 ? pontos.findIndex((p) => p.saldoAcumulado < limiar) : -1;

  async function handleSalvar() {
    const valor = Number(valorInput.replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) return;
    setSalvando(true);
    try {
      await onSalvarLimiar(valor);
    } finally {
      setSalvando(false);
    }
  }

  const pontosLinha = pontos
    .map((p, i) => {
      const x = pontos.length > 1 ? (i / (pontos.length - 1)) * 100 : 50;
      const y = 100 - (p.saldoAcumulado / scaleMax) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">Curva de caixa projetada</p>
      <p className="mb-4 text-[11px] text-muted">
        Soma acumulada de recebimentos previstos, partindo de zero — não considera saldo inicial nem contas a pagar.
      </p>

      {pontos.length === 0 ? (
        <p className="text-sm text-muted">Sem dados para os filtros atuais.</p>
      ) : (
        <div className="relative h-40">
          {limiar > 0 && (
            <div
              className="absolute inset-x-0 border-t border-dashed border-destructive/60"
              style={{ bottom: `${Math.min(100, (limiar / scaleMax) * 100)}%` }}
            >
              <span className="absolute right-0 -top-3 text-[9px] text-destructive">limiar mínimo</span>
            </div>
          )}

          {primeiroAbaixoIdx >= 0 && (
            <div
              className="absolute inset-y-0 bg-destructive/10"
              style={{
                left: `${(primeiroAbaixoIdx / pontos.length) * 100}%`,
                right: 0,
              }}
            />
          )}

          <div className="absolute inset-0 flex items-end gap-1.5">
            {pontos.map((p) => (
              <div key={p.janela} className="flex h-full min-w-[10px] flex-1 items-end justify-center">
                <div
                  title={`${p.janela} — previsto: ${formatarValor(p.previsto)} · acumulado: ${formatarValor(p.saldoAcumulado)}`}
                  className="w-[65%] rounded-t-[2px] bg-primary/40"
                  style={{ height: `${Math.max(2, (p.previsto / scaleMax) * 100)}%` }}
                />
              </div>
            ))}
          </div>

          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
            <polyline points={pontosLinha} fill="none" stroke="var(--primary)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      )}

      <div className="mt-2 flex justify-between text-[10px] text-muted">
        <span>{pontos[0]?.janela}</span>
        <span>{pontos[pontos.length - 1]?.janela}</span>
      </div>

      {primeiroAbaixoIdx >= 0 && (
        <p className="mt-3 text-[11px] text-destructive">
          A partir de {pontos[primeiroAbaixoIdx].janela}, o acumulado previsto fica abaixo do limiar configurado.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <span className="text-[11.5px] text-muted">Limiar mínimo de caixa:</span>
        <input
          type="text"
          inputMode="decimal"
          value={valorInput}
          onChange={(e) => setValorInput(e.target.value)}
          className="w-32 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          onClick={handleSalvar}
          disabled={salvando}
          className="rounded-md border border-border bg-surface px-3 py-1 text-[11.5px] font-medium text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </section>
  );
}
