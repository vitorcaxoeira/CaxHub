import { ReactNode } from "react";
import { Limiares, ROTULO_ITEM, ROTULO_PROPOSTA, hh } from "../../lib/eficiencia";
import { Cartao, Chip } from "./comum";

const Cod = ({ children }: { children: ReactNode }) => <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">{children}</code>;

export function ComoCalculamos({ limiares: l, capacidade }: { limiares: Limiares; capacidade: number }) {
  const pctL = (x: number) => `${Math.round(x * 100)}%`;
  const defs: [string, ReactNode][] = [
    ["Vendido", "Horas do item na proposta (soma dos itens; o total do cabeçalho da proposta não é usado)."],
    [
      "Executado",
      <>
        Tudo que foi apontado no item (por proposta e item), mais as sessões já encerradas e ainda não confirmadas. Fora: RAT cancelada, apontamento removido no Senior e
        apontamento com duração zero ou negativa. É a <b>soma do item</b>, mesmo sem vínculo com uma alocação.
      </>,
    ],
    [
      "Consumo",
      <>
        <Cod>executado ÷ vendido</Cod>, do item ou da proposta.
      </>,
    ],
    [
      "Eficiência",
      <>
        <Cod>horas executadas dentro do vendido ÷ horas executadas</Cod>, item a item. 100% = nenhuma hora passou do vendido. Exemplo: 120 h num item de 100 h = 83%. Um item
        folgado não compensa o item estourado. Verde a partir de {pctL(l.eficienciaOk)}, âmbar a partir de {pctL(l.eficienciaAtencao)}, vermelho abaixo.
      </>,
    ],
    [
      "Estouro",
      <>
        <Cod>executado − vendido</Cod> nos itens acima do vendido.
      </>,
    ],
    [
      "Impacto financeiro",
      <>
        <Cod>estouro × valor-hora do item</Cod>. O valor-hora é o do próprio item na proposta; item sem valor-hora não entra (aparece em Qualidade dos dados). Estimativa de
        horas que não serão faturadas, salvo aditivo.
      </>,
    ],
    ["Saldo a executar", <><Cod>vendido − executado</Cod> nos itens que ainda têm saldo.</>],
    [
      "Situação do item",
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Chip tom="off">{ROTULO_ITEM.off}</Chip> sem horas · <Chip tom="ok">{ROTULO_ITEM.ok}</Chip> até {pctL(l.pertoDoLimite)} ·{" "}
        <Chip tom="warn">{ROTULO_ITEM.warn}</Chip> {pctL(l.pertoDoLimite)} a 100% · <Chip tom="bad">{ROTULO_ITEM.bad}</Chip> acima de 100%
      </span>,
    ],
    [
      "Situação da proposta",
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Chip tom="bad">{ROTULO_PROPOSTA.bad}</Chip> {hh(l.estouroMinimoMin)} ou mais acima do vendido · <Chip tom="warn">{ROTULO_PROPOSTA.warn}</Chip> item perto do limite ou estouro menor que{" "}
        {hh(l.estouroMinimoMin)} · <Chip tom="ok">{ROTULO_PROPOSTA.ok}</Chip> · <Chip tom="off">{ROTULO_PROPOSTA.off}</Chip>
      </span>,
    ],
    ["Estouro crítico", `Proposta com ${hh(l.criticoMin)} ou mais acima do vendido, ou consumo de ${pctL(l.criticoConsumo)} ou mais.`],
    [
      "Eficiência do consultor",
      <>
        <Cod>executado dentro da alocação ÷ executado</Cod>, nos itens em que ele está alocado. A alocação considerada é o teto (planejado + horas excedentes autorizadas).
        O executado dele é o mesmo da regra de teto da Alocação.
      </>,
    ],
    ["Carga pendente", <>Por consultor e item: o menor valor entre <Cod>alocado − executado do consultor</Cod> e <Cod>vendido − executado do item</Cod>.</>],
    ["Alocação a revisar", "O que sobra da alocação quando o item já não tem saldo: o consultor continua alocado num item que consumiu o vendido."],
    [
      "Meses de carteira",
      <>
        <Cod>carga pendente ÷ capacidade mensal</Cod>. Capacidade atual: <b>{capacidade} h/mês</b> por consultor em projeto (ajustável em Parâmetros; o padrão é {l.capacidadePadraoHorasMes} h).
        Até {l.mesesAtencao} mês ok, até {l.mesesSobrecarga} atenção, acima disso sobrecarga.
      </>,
    ],
    ["Sem consultor alocado", <>Executado do item menos a soma do executado dos consultores alocados nele. Apontamento sem vínculo com alocação, ou de quem não está alocado no item.</>],
    ["Horas executadas por mês", "Cada apontamento é classificado como dentro ou acima do vendido pelo acumulado do item até aquele apontamento (em ordem de data). Mostra quando o estouro aconteceu."],
  ];

  return (
    <div className="space-y-5">
      <Cartao titulo="Indicadores e fórmulas">
        <dl className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(150px,220px)_1fr]">
          {defs.map(([termo, texto]) => (
            <div key={termo} className="contents">
              <dt className="font-semibold text-foreground">{termo}</dt>
              <dd className="text-sm text-muted">{texto}</dd>
            </div>
          ))}
        </dl>
      </Cartao>
      <Cartao titulo="O que ainda não temos">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li><b className="text-foreground">Avanço físico (%) por item:</b> o cadastro existe na estrutura do cronograma, mas não está preenchido. Sem ele não dá para projetar o estouro antes de acontecer.</li>
          <li><b className="text-foreground">Data prevista de fim por item:</b> quase nenhuma proposta tem. Hoje só há o prazo no cabeçalho.</li>
          <li><b className="text-foreground">Capacidade por consultor</b> com férias e ausências: usamos um valor único por consultor em projeto.</li>
          <li><b className="text-foreground">Plano de ação</b> (dono, prazo e status por alerta) e <b className="text-foreground">exclusão de apontamento do cálculo</b>, com motivo e histórico: próxima fase.</li>
        </ul>
      </Cartao>
    </div>
  );
}
