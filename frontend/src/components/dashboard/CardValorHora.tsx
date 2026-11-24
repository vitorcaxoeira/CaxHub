import { useState } from "react";
import { cn } from "../../lib/cn";
import { formatHorasCompacto } from "../../lib/cronograma";
import { BotaoVisibilidade } from "./BotaoVisibilidade";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Descontos da Gestão de Descontos que saem da nota nas competências do período (vem de /dashboard/meu-resumo). */
export interface DescontosDoPeriodo {
  total: number;
  parcial: boolean;
}

/** Contrato de valor fixo (vem de /dashboard/meu-resumo): total = valorMensal × meses + deslocamento. */
export interface ContratoFixoDoPeriodo {
  qtd: number;
  valorMensal: number;
  meses: number;
  deslocamento: number;
  total: number;
}

/** Férias remuneradas cujo mês de pagamento cai no período (vem de /dashboard/meu-resumo): somam ao LÍQUIDO da nota, não ao ganho/projeção. */
export interface FeriasDoPeriodo {
  /** Todas as férias pagas nas competências do período. */
  total: number;
  /** Só as de competência já iniciada (entram no líquido do "ganho até agora"). */
  ateAgora: number;
  itens: { gozoId: number; inicio: string; fim: string; competencia: string; valor: number; competenciaIniciada: boolean }[];
}

const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const mesAno = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const quantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

interface CardValorHoraProps {
  valorHora: number | null;
  ganhoAteAgora: number | null;
  projecaoGanho: number | null;
  // Contrato de valor fixo (codmot 12): vira uma KPI depois da projeção, com os descontos deduzidos e as férias somadas. Ausente/null = contrato por hora.
  contratoFixo?: ContratoFixoDoPeriodo | null;
  // Deslocamento do período: já está somado em ganhoAteAgora/projecaoGanho; aparece à parte só
  // pra o consultor ver quanto do total vem dele (metade do valor-hora).
  deslocamentoValor: number | null;
  deslocamentoMinutos: number;
  // Descontos da competência (Gestão de Descontos): aparecem sob o ganho e a projeção, com o líquido. `onVerDescontos` abre o detalhe.
  descontos?: DescontosDoPeriodo;
  rotuloPeriodoDescontos?: string;
  onVerDescontos?: () => void;
  // Férias remuneradas pagas nas competências do período: uma linha "Férias" sob o ganho, a projeção e o valor fixo, somada ao líquido (como os descontos, ao contrário).
  ferias?: FeriasDoPeriodo;
}

// Bruto + férias − descontos, sem passar de zero: a nota que não cobre o desconto desconta só o disponível (o resto segue para o mês seguinte).
const liquidoDe = (bruto: number, desconto: number, ferias = 0) => Math.max(0, Math.round((bruto + ferias - desconto) * 100) / 100);

/** As férias que entram na nota, com os itens que explicam de onde vêm (datas e mês da nota). */
interface FeriasNaLinha {
  valor: number;
  itens: FeriasDoPeriodo["itens"];
}

const tituloDasFerias = (itens: FeriasDoPeriodo["itens"]) =>
  "Férias remuneradas somadas à nota: " + itens.map((f) => `${dataBr(f.inicio)} a ${dataBr(f.fim)} (nota de ${mesAno(f.competencia)})`).join("; ");

/** Linhas sob um valor bruto: descontos (−), férias (+) e o líquido da nota. */
function LinhasDeLiquido({
  bruto,
  descontos,
  ferias,
  rotuloDescontos,
  onVer,
}: {
  bruto: number;
  descontos?: DescontosDoPeriodo;
  ferias?: FeriasNaLinha;
  rotuloDescontos: string;
  onVer?: () => void;
}) {
  const valorFerias = ferias?.valor ?? 0;
  const totalDescontos = descontos?.total ?? 0;
  const cobre = totalDescontos <= bruto + valorFerias + 0.005;
  return (
    <div className="mt-1 space-y-0.5 text-[11.5px]">
      {descontos && (
        <p className="text-muted">
          {rotuloDescontos}:{" "}
          <button
            type="button"
            onClick={onVer}
            className="font-mono font-semibold tabular-nums text-destructive underline decoration-dotted underline-offset-2 hover:decoration-solid"
            title="Ver os descontos deduzidos"
          >
            −{moeda.format(descontos.total)}
          </button>
        </p>
      )}
      {ferias && valorFerias > 0 && (
        <p className="text-muted" title={tituloDasFerias(ferias.itens)}>
          Férias na nota: <span className="font-mono font-semibold tabular-nums text-success">+{moeda.format(valorFerias)}</span>
        </p>
      )}
      <p className="text-muted">
        Líquido: <span className="font-mono text-lg font-semibold tabular-nums text-primary">{moeda.format(liquidoDe(bruto, totalDescontos, valorFerias))}</span>
      </p>
      {descontos && (!cobre || descontos.parcial) && (
        <p className="text-warning" title="A nota não cobre todos os descontos: o que sobrar segue para a competência seguinte.">
          desconto parcial
        </p>
      )}
    </div>
  );
}

/**
 * KPI do contrato de VALOR FIXO (codmot 12), logo depois da projeção: o total do período (valor-hora × quantidade fixa × meses, mais o deslocamento) e, quando há
 * descontos da Gestão de Descontos, o desconto e o líquido. Exportada para o teste de renderização.
 */
export function KpiValorFixo({
  contratoFixo,
  valorHora,
  descontos,
  ferias,
  rotuloPeriodoDescontos,
  onVerDescontos,
}: {
  contratoFixo: ContratoFixoDoPeriodo;
  valorHora: number;
  /** Só quando há descontos a deduzir. */
  descontos?: DescontosDoPeriodo;
  /** Só quando há férias pagas na competência do período. */
  ferias?: FeriasNaLinha;
  rotuloPeriodoDescontos: string;
  onVerDescontos?: () => void;
}) {
  return (
    <div
      className="col-span-2 xl:col-span-1"
      title="Contrato de valor fixo: a nota do mês é o valor-hora × a quantidade fixa do contrato, mais o deslocamento lançado (pago a 50% do valor-hora)."
    >
      <p className="text-[11px] text-muted">Valor fixo do contrato</p>
      <p className="font-mono text-lg font-semibold text-foreground">{moeda.format(contratoFixo.total)}</p>
      <p className="font-mono text-[11px] text-muted">
        {moeda.format(valorHora)}/h × {quantidade.format(contratoFixo.qtd)} h
        {contratoFixo.meses > 1 && ` × ${contratoFixo.meses} meses`}
        {contratoFixo.deslocamento > 0 && ` + deslocamento ${moeda.format(contratoFixo.deslocamento)}`}
      </p>
      {(descontos || ferias) && <LinhasDeLiquido bruto={contratoFixo.total} descontos={descontos} ferias={ferias} rotuloDescontos={rotuloPeriodoDescontos} onVer={onVerDescontos} />}
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
  contratoFixo,
  deslocamentoValor,
  deslocamentoMinutos,
  descontos,
  rotuloPeriodoDescontos = "Descontos do mês",
  onVerDescontos,
  ferias,
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
  // Férias da competência: no ganho só as de mês já iniciado; na projeção e no valor fixo, todas do período.
  const feriasGanho: FeriasNaLinha | undefined = ferias && ferias.ateAgora > 0 ? { valor: ferias.ateAgora, itens: ferias.itens.filter((f) => f.competenciaIniciada) } : undefined;
  const feriasPeriodo: FeriasNaLinha | undefined = ferias && ferias.total > 0 ? { valor: ferias.total, itens: ferias.itens } : undefined;
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Valor-hora · Projeção de ganhos</p>
        <BotaoVisibilidade visivel={visivel} onAlternar={() => setVisivel((v) => !v)} />
      </div>
      {visivel ? (
        <div className={cn("mt-3 grid grid-cols-2 gap-4", contratoFixo ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
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
            <p className="font-mono text-lg font-semibold text-foreground">{moeda.format(ganho)}</p>
            {(temDescontos || feriasGanho) && <LinhasDeLiquido bruto={ganho} descontos={temDescontos ? descontos : undefined} ferias={feriasGanho} rotuloDescontos={rotuloPeriodoDescontos} onVer={onVerDescontos} />}
          </div>
          <div>
            <p className="text-[11px] text-muted">Projeção do período</p>
            <p className="font-mono text-lg font-semibold text-foreground">{moeda.format(projecao)}</p>
            {(temDescontos || feriasPeriodo) && <LinhasDeLiquido bruto={projecao} descontos={temDescontos ? descontos : undefined} ferias={feriasPeriodo} rotuloDescontos={rotuloPeriodoDescontos} onVer={onVerDescontos} />}
          </div>
          {contratoFixo && (
            <KpiValorFixo
              contratoFixo={contratoFixo}
              valorHora={valorHora}
              descontos={temDescontos ? descontos : undefined}
              ferias={feriasPeriodo}
              rotuloPeriodoDescontos={rotuloPeriodoDescontos}
              onVerDescontos={onVerDescontos}
            />
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Valores ocultos — clique no ícone pra mostrar.</p>
      )}
    </section>
  );
}
