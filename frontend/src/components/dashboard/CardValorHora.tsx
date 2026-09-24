import { useState } from "react";
import { BotaoVisibilidade } from "./BotaoVisibilidade";

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
        <BotaoVisibilidade visivel={visivel} onAlternar={() => setVisivel((v) => !v)} />
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
