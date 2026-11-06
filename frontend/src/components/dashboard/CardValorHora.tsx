import { useState } from "react";
import { formatHorasCompacto } from "../../lib/cronograma";
import { BotaoVisibilidade } from "./BotaoVisibilidade";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Descontos da Gestão de Descontos que saem da nota nas competências do período (vem de /dashboard/meu-resumo). */
export interface DescontosDoPeriodo {
  total: number;
  parcial: boolean;
}

interface CardValorHoraProps {
  valorHora: number | null;
  ganhoAteAgora: number | null;
  projecaoGanho: number | null;
  // Deslocamento do período: já está somado em ganhoAteAgora/projecaoGanho; aparece à parte só
  // pra o consultor ver quanto do total vem dele (metade do valor-hora).
  deslocamentoValor: number | null;
  deslocamentoMinutos: number;
  // Descontos da competência (Gestão de Descontos): aparecem sob o ganho e a projeção, com o líquido. `onVerDescontos` abre o detalhe.
  descontos?: DescontosDoPeriodo;
  rotuloPeriodoDescontos?: string;
  onVerDescontos?: () => void;
}

// Bruto − descontos, sem passar de zero: a nota que não cobre o desconto desconta só o disponível (o resto segue para o mês seguinte).
const liquidoDe = (bruto: number, desconto: number) => Math.max(0, Math.round((bruto - desconto) * 100) / 100);

function LinhasDeDesconto({
  bruto,
  descontos,
  rotulo,
  onVer,
}: {
  bruto: number;
  descontos: DescontosDoPeriodo;
  rotulo: string;
  onVer?: () => void;
}) {
  const cobre = descontos.total <= bruto + 0.005;
  return (
    <div className="mt-1 space-y-0.5 text-[11.5px]">
      <p className="text-muted">
        {rotulo}:{" "}
        <button
          type="button"
          onClick={onVer}
          className="font-mono font-semibold tabular-nums text-destructive underline decoration-dotted underline-offset-2 hover:decoration-solid"
          title="Ver os descontos deduzidos"
        >
          −{moeda.format(descontos.total)}
        </button>
      </p>
      <p className="text-muted">
        Líquido: <span className="font-mono font-semibold tabular-nums text-foreground">{moeda.format(liquidoDe(bruto, descontos.total))}</span>
      </p>
      {(!cobre || descontos.parcial) && (
        <p className="text-warning" title="A nota não cobre todos os descontos: o que sobrar segue para a competência seguinte.">
          desconto parcial
        </p>
      )}
    </div>
  );
}

// Valor-hora vem pronto do Senior (ContratoConsultor) — NÃO é editável aqui, diferente do
// dashboard de referência (psoffice-dashboard), onde o consultor digitava sua própria
// tarifa. O botão de "olho" sobrevive só pela privacidade de tela (evita expor tarifa em
// compartilhamento/print), estado puramente local — não persiste em lugar nenhum.
export function CardValorHora({
  valorHora,
  ganhoAteAgora,
  projecaoGanho,
  deslocamentoValor,
  deslocamentoMinutos,
  descontos,
  rotuloPeriodoDescontos = "Descontos do mês",
  onVerDescontos,
}: CardValorHoraProps) {
  const [visivel, setVisivel] = useState(false);
  const temDescontos = descontos != null && descontos.total > 0;

  if (valorHora == null) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Valor-hora</p>
        <p className="mt-3 text-sm text-muted">Sem contrato de valor-hora cadastrado no Senior.</p>
        {temDescontos && (
          <p className="mt-2 text-[12.5px] text-muted">
            {rotuloPeriodoDescontos}:{" "}
            <button type="button" onClick={onVerDescontos} className="font-mono font-semibold tabular-nums text-destructive underline decoration-dotted underline-offset-2">
              −{moeda.format(descontos.total)}
            </button>
          </p>
        )}
      </section>
    );
  }

  const ganho = ganhoAteAgora ?? 0;
  const projecao = projecaoGanho ?? 0;
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Valor-hora · Projeção de ganhos</p>
        <BotaoVisibilidade visivel={visivel} onAlternar={() => setVisivel((v) => !v)} />
      </div>
      {visivel ? (
        <div className="mt-3 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <div>
            <p className="text-[11px] text-muted">Valor/hora</p>
            <p className="font-mono text-lg font-semibold text-foreground">{moeda.format(valorHora)}</p>
          </div>
          <div title="Horas de deslocamento pagas a 50% do valor-hora. Já estão incluídas no ganho e na projeção.">
            <p className="text-[11px] text-muted">Deslocamento (50%)</p>
            <p className="font-mono text-lg font-semibold text-foreground">{moeda.format(deslocamentoValor ?? 0)}</p>
            <p className="font-mono text-[11px] text-muted">{formatHorasCompacto(deslocamentoMinutos)} h</p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Ganho até agora</p>
            <p className="font-mono text-lg font-semibold text-primary">{moeda.format(ganho)}</p>
            {temDescontos && <LinhasDeDesconto bruto={ganho} descontos={descontos} rotulo={rotuloPeriodoDescontos} onVer={onVerDescontos} />}
          </div>
          <div>
            <p className="text-[11px] text-muted">Projeção do período</p>
            <p className="font-mono text-lg font-semibold text-foreground">{moeda.format(projecao)}</p>
            {temDescontos && <LinhasDeDesconto bruto={projecao} descontos={descontos} rotulo={rotuloPeriodoDescontos} onVer={onVerDescontos} />}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Valores ocultos — clique no ícone pra mostrar.</p>
      )}
    </section>
  );
}
