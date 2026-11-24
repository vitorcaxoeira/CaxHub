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
        <Cod>executado − vendido</Cod>. Por padrão é lido <b>item a item</b>: soma só os itens acima do vendido, então um item estourado já conta mesmo que outro item da proposta tenha
        saldo. A opção <b>Estouro</b> da barra de filtros troca para <b>Pela proposta</b>: <Cod>max(0, executado − vendido)</Cod> do total, onde o saldo de um item compensa o estouro de outro.
        A troca vale para proposta, cliente, carteira, alertas, tendência e Financeiro; <b>não muda</b> as horas de cada item, a carga pendente nem a eficiência do consultor (essas são por
        alocação). A gaveta mostra os dois números.
      </>,
    ],
    [
      "Impacto financeiro",
      <>
        <Cod>estouro × valor-hora do item</Cod>. O valor-hora é o do próprio item na proposta; item sem valor-hora não entra (aparece em Qualidade dos dados). Estimativa de
        horas que não serão faturadas, salvo aditivo. Lendo o estouro <b>pela proposta</b>, o estouro global usa o valor-hora <b>médio</b> da proposta (ponderado pelas horas vendidas),
        já que o excedente não pertence a um item só.
      </>,
    ],
    [
      "Eficiência financeira",
      <>
        Aba <b>Financeiro</b>. Tudo em R$ ao <b>valor-hora de venda</b> do item: <Cod>valor vendido = horas vendidas × valor-hora</Cod>, <Cod>valor executado = horas executadas × valor-hora</Cod>,
        <Cod>valor estourado = impacto</Cod>, <Cod>valor dentro = executado − estourado</Cod>. <b>Eficiência financeira</b> = <Cod>valor dentro ÷ valor executado</Cod>: parecida com a de horas,
        mas pesada pelo valor-hora (estourar um item caro custa mais que um barato). <b>Receita por hora executada</b> = <Cod>valor dentro ÷ horas executadas</Cod>, comparada ao valor-hora
        médio vendido. <b>Não é faturamento</b> (a nota fiscal só se liga ao projeto, não à proposta) <b>nem custo</b> (poucos consultores têm valor-hora cadastrado). Todos os itens entram,
        inclusive os sem faturamento direto; o painel diz quanto do valor está neles. Respeita todos os filtros, os ignorados e o modo de estouro.
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
      "Apontamento fora do cálculo",
      <>
        O gestor do item (ou um administrador) pode tirar UM apontamento da conta, com motivo, e restaurar depois. Vale <b>só neste painel</b>: a RAT, o teto da Alocação,
        a Home do consultor, o relatório de produtividade e o Senior continuam contando a hora. Por isso o executado aqui pode ser menor que o das outras telas. A exclusão
        sai do executado do item, da tendência mensal e da eficiência/carga do consultor; a lista fica na aba Qualidade dos dados e tudo é auditado.
      </>,
    ],
    [
      "Proposta ignorada",
      <>
        O check <b>Ignorar</b> na lista da aba Propostas tira UMA proposta de todos os cálculos: resumo, alertas, pareto, faixas de consumo, clientes, equipe, carga e a tendência mensal.
        Vale para qualquer proposta, atípica ou não. A linha continua na lista (esmaecida) para dar para desmarcar, e uma faixa no topo lembra quantas estão ignoradas. É uma escolha
        <b> sua</b>, guardada neste navegador: não é compartilhada com outros gestores nem auditada. Não confundir com "Apontamento fora do cálculo", que é decisão do gestor, compartilhada e auditada.
      </>,
    ],
    [
      "Consultor ignorado",
      <>
        O check <b>Ignorar</b> na lista da aba Equipe e carga tira UM consultor dos <b>indicadores da equipe</b>: carga pendente, eficiência da equipe, consultores em sobrecarga,
        alocação a revisar, mapa de alocação e alertas de capacidade. As horas das propostas (vendido, executado, estouro, eficiência da proposta) <b>não mudam</b>: o que ele
        apontou continua no item. A linha dele fica na lista (esmaecida, com os números reais) para dar para desmarcar. Também é escolha <b>sua</b>, guardada neste navegador,
        sem compartilhar nem auditar.
      </>,
    ],
    [
      "Item e consultor ignorados numa proposta",
      <>
        Na gaveta da proposta, o check <b>Ignorar</b> em <b>Itens e consultores</b> tira um item da conta (vendido, executado, estouro e a equipe dele saem), e o da aba <b>Consultores</b> tira as horas
        que a pessoa apontou naquela proposta do executado dos itens. Vale em todo o painel (lista, carteira, clientes, equipe, tendência), mas só para <b>aquela</b> proposta: o mesmo consultor
        continua contando nas outras. A gaveta mostra os números sem ignorar para comparar. Consultor de fora do seu time entra somado, sem nome e sem check. Escolha <b>sua</b>, guardada neste navegador.
      </>,
    ],
    [
      "Proposta atípica",
      <>
        Consumo de {pctL(l.atipicaConsumo)} ou mais <b>e</b> {hh(l.atipicaAcimaMin)} ou mais acima do vendido. É só um aviso: aparece com a marca "atípica" na lista de propostas e na
        aba Qualidade dos dados, e não muda nenhuma conta. Para tirar uma proposta dos números, use "Ignorar" (item acima).
      </>,
    ],
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
          <li><b className="text-foreground">Custo e faturamento real por proposta:</b> não há custo-hora confiável dos consultores e a nota fiscal só se liga ao projeto, não à proposta. Por isso o Financeiro usa o valor de venda, sem margem.</li>
          <li><b className="text-foreground">Capacidade por consultor</b> com férias e ausências: usamos um valor único por consultor em projeto.</li>
        </ul>
      </Cartao>
    </div>
  );
}
