import { useState } from "react";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface CardValorHoraProps {
  valorHora: number | null;
  ganhoAteAgora: number | null;
  projecaoGanho: number | null;
}

// Valor-hora vem pronto do Senior (ContratoConsultor) — NÃO é editável aqui, diferente do
// dashboard de referência (psoffice-dashboard), onde o consultor digitava sua própria
// tarifa. O botão de "olho" sobrevive só pela privacidade de tela (evita expor tarifa em
// compartilhamento/print), estado puramente local — não persiste em lugar nenhum.
export function CardValorHora({ valorHora, ganhoAteAgora, projecaoGanho }: CardValorHoraProps) {
  const [visivel, setVisivel] = useState(false);

  if (valorHora == null) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Valor-hora</p>
        <p className="mt-3 text-sm text-muted">Sem contrato de valor-hora cadastrado no Senior.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Valor-hora · Projeção de ganhos</p>
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          className="rounded p-1 text-muted transition hover:bg-surface-2 hover:text-foreground"
          title={visivel ? "Ocultar valores" : "Mostrar valores"}
        >
          {visivel ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {visivel ? (
        <div className="mt-3 grid grid-cols-3 gap-4">
          <div>
            <p className="text-[11px] text-muted">Valor/hora</p>
            <p className="font-mono text-lg font-semibold text-foreground">{moeda.format(valorHora)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Ganho até agora</p>
            <p className="font-mono text-lg font-semibold text-primary">{moeda.format(ganhoAteAgora ?? 0)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Projeção do período</p>
            <p className="font-mono text-lg font-semibold text-foreground">{moeda.format(projecaoGanho ?? 0)}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Valores ocultos — clique no ícone pra mostrar.</p>
      )}
    </section>
  );
}
