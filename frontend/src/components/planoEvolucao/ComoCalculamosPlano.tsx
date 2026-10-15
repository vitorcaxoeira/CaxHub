import { ReactNode } from "react";
import { brl2, matrizDoRegulamento, pctNum } from "../../lib/planoEvolucao";
import { Cartao } from "../eficiencia/comum";

const Cod = ({ children }: { children: ReactNode }) => <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">{children}</code>;

// As regras do regulamento v3.1 e, principalmente, COMO o CaxHub mede cada coisa. Texto próprio (não copia o documento): o que muda é o que o sistema faz.
export function ComoCalculamosPlano() {
  const matriz = matrizDoRegulamento(100);
  const defs: [string, ReactNode][] = [
    [
      "Os 5 requisitos",
      <>
        Cada ciclo (6 meses) avalia 5 requisitos de 1% cada. Os <b>4 individuais</b> (certificações, avaliação de clientes, case técnico e eficiência individual) são
        <b> indivisíveis</b>: cumprir três dos quatro dá 0%, não 3%. O <b>global</b> (eficiência da área) é coletivo e opcional: soma 1% quando a área atinge a meta e, se não atingir, não gera
        penalidade nem quebra a sequência.
      </>,
    ],
    [
      "Portão de entrada",
      <>
        Antes de pontuar, o consultor precisa ter contrato ativo no ciclo inteiro, completar os 6 meses e tirar <b>80% ou mais</b> na Avaliação de Competências. Reprovar no portão equivale a descumprir o ciclo.
      </>,
    ],
    [
      "Valor Hora do ciclo",
      <>
        <Cod>Valor Hora Base × (1 + pontuação + reforçador)</Cod>, sempre sobre a base contratada, nunca sobre o ciclo anterior (sem juro sobre juro). Pontuação é 4% ou 5%. O{" "}
        <b>reforçador</b> soma 0,5 ponto percentual por ciclo consecutivo já cumprido (0 no 1º, 4,5 no 10º). O valor é reconstruído a cada ciclo e <b>pode cair</b> quando a área não atinge a meta global.
      </>,
    ],
    [
      "Descumprir e efetivar",
      <>
        Falhar em qualquer requisito individual ou no portão zera a pontuação e o reforçador, volta à base vigente e recomeça a contagem. Ao cumprir <b>10 ciclos consecutivos</b>, o valor do 10º ciclo vira a nova base
        (efetivação, irreversível) e o plano recomeça sobre ela.
      </>,
    ],
    [
      "Eficiência pelo ITEM da proposta",
      <>
        A eficiência olha o <b>item da proposta</b>, não a atividade atribuída ao consultor. O orçado é a hora vendida do item e o executado é tudo que foi apontado nele. Cada hora apontada no ciclo, em ordem de data, é
        classificada como <b>dentro</b> ou <b>acima</b> do orçado do item (contando o que o item já tinha executado antes do ciclo). O estouro cai em quem apontou depois de o item passar do vendido.
      </>,
    ],
    [
      "Eficiência individual e global",
      <>
        <Cod>horas dentro do orçado ÷ horas executadas</Cod>. A <b>individual</b> usa só as horas do consultor nos itens da área; a <b>global</b> soma todos os consultores nos itens da área (por padrão, itens de Consultoria
        ERP e HCM). Tem teto de 100%. Diferença consciente do texto do regulamento (Σ orçado ÷ Σ executado das tarefas encerradas): o item do Senior não tem data de encerramento, então essa conta não existe. A meta é
        escrita nesta escala.
      </>,
    ],
    [
      "Amostra mínima: \"sem base\"",
      <>
        Quem executou menos horas que a amostra mínima do ciclo (padrão 10 h) fica <b>sem base</b> naquele indicador: não aprova nem reprova. Indicador sem base não entra na nota da eficiência individual.
      </>,
    ],
    [
      "Apontamento online",
      <>
        Parte das horas do ciclo apontadas <b>ao vivo</b>, pelo Start/Stop. Sessão criada mais de 5 minutos depois de começar, ou nascida de uma solicitação de apontamento aprovada, conta como retroativa. Na definição{" "}
        <b>A</b> só o Start/Stop ao vivo é online; na <b>B</b>, o lançamento direto no Senior registrado no mesmo dia também. A escolha vale por ciclo.
      </>,
    ],
    [
      "O que o gestor lança",
      <>
        Certificações, avaliação de clientes, case técnico, nota de competências e os indicadores manuais (retrabalho, qualidade técnica, aderência a processos) dependem de evidência e são lançados pelo gestor na
        apuração. A prévia mostra esses requisitos como <b>pendentes</b> e projeta o ciclo assumindo que serão cumpridos.
      </>,
    ],
    [
      "Quem vê o quê",
      <>
        O <b>administrador</b> vê tudo, inclusive o Valor Hora Base e o valor projetado em R$. O <b>gestor</b> vê só o time dele e <b>sem valores em R$</b> (o valor hora é dado sensível, como a auditoria dele). O{" "}
        <b>consultor</b> vê só o próprio andamento, sem colegas.
      </>,
    ],
    [
      "Parâmetros travados",
      <>
        Meta, indicadores, pesos, área e calendário valem para o ciclo inteiro: ao publicar, ficam travados, como manda o regulamento. Qualquer mudança vale a partir do ciclo seguinte.
      </>,
    ],
  ];

  return (
    <div className="space-y-5">
      <Cartao titulo="Como calculamos" nota="Regulamento v3.1 · vigência 01/01/2027">
        <dl className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(150px,220px)_1fr]">
          {defs.map(([termo, texto]) => (
            <div key={termo} className="contents">
              <dt className="font-semibold text-foreground">{termo}</dt>
              <dd className="text-sm text-muted">{texto}</dd>
            </div>
          ))}
        </dl>
      </Cartao>

      <Cartao titulo="Matriz de evolução" nota="Exemplo com Valor Hora Base de R$ 100,00 (item 7.3 do regulamento)">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-right font-mono text-[10.5px] uppercase tracking-wider text-muted">
                <th className="px-2.5 py-2 text-left font-medium">Ciclo</th>
                <th className="px-2.5 py-2 font-medium">Reforçador</th>
                <th className="px-2.5 py-2 font-medium">Com global</th>
                <th className="px-2.5 py-2 font-medium">Valor hora</th>
                <th className="px-2.5 py-2 font-medium">Sem global</th>
                <th className="px-2.5 py-2 font-medium">Valor hora</th>
              </tr>
            </thead>
            <tbody>
              {matriz.map((l) => (
                <tr key={l.ciclo} className="border-t border-border/60 text-right font-mono tabular-nums">
                  <td className="px-2.5 py-1.5 text-left font-sans text-foreground">{l.ciclo}º{l.ciclo === 10 ? " (efetivação)" : ""}</td>
                  <td className="px-2.5 py-1.5 text-muted">+{l.reforcador.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}</td>
                  <td className="px-2.5 py-1.5">{pctNum(l.comGlobal.pct)}</td>
                  <td className="px-2.5 py-1.5 font-semibold text-foreground">{brl2(l.comGlobal.valor)}</td>
                  <td className="px-2.5 py-1.5">{pctNum(l.semGlobal.pct)}</td>
                  <td className="px-2.5 py-1.5 font-semibold text-foreground">{brl2(l.semGlobal.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12.5px] text-muted">
          As duas colunas não são trajetórias fixas: são os dois valores possíveis de cada ciclo. O mesmo consultor passa de uma para a outra conforme a área atinja ou não a meta coletiva.
        </p>
      </Cartao>

      <Cartao titulo="O que ainda não temos">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li><b className="text-foreground">Apuração com registro:</b> nesta fase o CaxHub só faz a <b>prévia ao vivo</b>. Lançar certificações, case e competências, fechar o ciclo com memória de cálculo, devolutiva e contestação é a próxima etapa.</li>
          <li><b className="text-foreground">Cumprimento de cronogramas:</b> desativado. A data prevista de fim está preenchida em menos de 1% das atividades, então não há base para medir.</li>
          <li><b className="text-foreground">Encerramento de tarefa:</b> o item do Senior não tem data de encerramento. Por isso a eficiência é medida hora a hora no ciclo e não "por tarefa encerrada".</li>
          <li><b className="text-foreground">Avaliação de Clientes por formulário:</b> o CaxHub não envia o formulário. O gestor lança o resultado na apuração.</li>
        </ul>
      </Cartao>
    </div>
  );
}
