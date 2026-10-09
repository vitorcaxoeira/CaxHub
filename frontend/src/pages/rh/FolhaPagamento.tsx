import { Aviso, GradeKpis, Kpi, PaginaRh, Painel, Tabela } from "../../components/rh/blocos";
import { BarrasH, Colunas, GradeDePaineis, Ponte } from "../../components/rh/graficos";
import { fmtInt, fmtMoeda, fmtMoedaCompacta } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

interface Folha extends RespostaBase {
  periodo: { de: string; ate: string };
  ultimoFechamento: {
    competencia: string;
    rotulo: string;
    colaboradores: number;
    bruto: number;
    descontos: number;
    liquido: number;
    custoMedio: number | null;
    variacaoMesAnterior: number | null;
    variacaoAnoAnterior: number | null;
  } | null;
  totaisDoPeriodo: { bruto: number; descontos: number; liquido: number; outros: number; decimoTerceiroEEspeciais: number };
  evolucao: {
    comp: string;
    rotulo: string;
    bruto: number | null;
    descontos: number | null;
    liquido: number | null;
    colaboradores: number;
    custoMedio: number | null;
    brutoAnoAnterior: number | null;
    variacaoAnoAnterior: number | null;
  }[];
  porTipoDeEvento: { rotulo: string; valor: number }[];
  topEventos: { evento: string; tipo: string; valor: number; colaboradores: number }[];
  ponte: {
    de: string;
    para: string;
    brutoAnterior: number;
    entradas: number | null;
    saidas: number | null;
    permanece: number | null;
    brutoAtual: number;
    colabEntraram: number;
    colabSairam: number;
  } | null;
  porCentroCusto: { rotulo: string; qtd: number; bruto: number | null; descontos: number | null }[];
}

export function FolhaPagamento() {
  const { dados: d, carregando, erro } = useRh<Folha>("folha");
  const u = d?.ultimoFechamento;

  return (
    <PaginaRh
      titulo="Folha de Pagamento"
      pergunta="Quanto a folha custa por competência, o que mudou em relação ao mês e ao ano anteriores e de onde veio a variação?"
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && (
        <>
          {!u && <Aviso tom="alerta">Nenhum cálculo de folha concluído no período.</Aviso>}
          {u && (
            <GradeKpis colunas={5}>
              <Kpi
                rotulo={`Folha bruta de ${u.rotulo}`}
                valor={fmtMoeda(u.bruto)}
                variacao={u.variacaoMesAnterior}
                vsRotulo="vs mês anterior"
                sub={`${u.variacaoAnoAnterior == null ? "sem ano anterior" : `${u.variacaoAnoAnterior > 0 ? "+" : ""}${u.variacaoAnoAnterior}% vs ano anterior`}`}
                ajuda="Proventos (tipo 1) + vantagens (tipo 2) do cálculo mensal da última competência fechada no período."
              />
              <Kpi rotulo="Descontos" valor={fmtMoeda(u.descontos)} ajuda="Eventos de desconto (tipo 3): INSS, IRRF, adiantamentos, etc." />
              <Kpi rotulo="Folha líquida" valor={fmtMoeda(u.liquido)} ajuda="Bruto menos descontos. Não inclui encargos patronais." />
              <Kpi rotulo="Colaboradores na folha" valor={fmtInt(u.colaboradores)} sub="com provento na competência" />
              <Kpi rotulo="Custo médio por colaborador" valor={fmtMoeda(u.custoMedio)} sub="bruto ÷ colaboradores" />
            </GradeKpis>
          )}

          <Painel
            titulo="Evolução da folha"
            descricao="Folha bruta de cada competência, comparada com o mesmo mês do ano anterior."
            ajuda="Soma dos cálculos mensais concluídos ou parciais (cancelados e simulados ficam de fora). 13º salário, PLR e adiantamentos não entram aqui para não distorcer a comparação mês a mês; aparecem nos totais do período."
          >
            <Colunas
              pontos={d.evolucao.map((e) => ({ rotulo: e.rotulo, valores: [e.brutoAnoAnterior, e.bruto, e.variacaoAnoAnterior] }))}
              series={[
                { nome: "Mesmo mês do ano anterior", cor: "muted", formato: fmtMoedaCompacta },
                { nome: "Bruto", cor: "primary", formato: fmtMoedaCompacta },
                { nome: "Variação vs ano anterior", cor: "warning", tipo: "linha", eixoDireito: true },
              ]}
              formato={fmtMoedaCompacta}
              formatoDireito={(v) => `${v.toFixed(0)}%`}
            />
          </Painel>

          <GradeDePaineis>
            <Painel
              titulo={d.ponte ? `De onde veio a variação (${d.ponte.de} → ${d.ponte.para})` : "De onde veio a variação"}
              descricao="Quem entrou, quem saiu e quem ficou (reajuste, horas extras, variáveis)."
              ajuda="Bruto da competência anterior + folha de quem entrou − folha de quem saiu + variação de quem estava nas duas = bruto atual. A soma fecha exatamente."
            >
              {d.ponte && d.ponte.entradas != null && d.ponte.saidas != null && d.ponte.permanece != null ? (
                <Ponte
                  inicio={{ rotulo: d.ponte.de, valor: d.ponte.brutoAnterior }}
                  passos={[
                    { rotulo: `Entradas (${d.ponte.colabEntraram})`, valor: d.ponte.entradas },
                    { rotulo: `Saídas (${d.ponte.colabSairam})`, valor: -d.ponte.saidas },
                    { rotulo: "Quem ficou", valor: d.ponte.permanece },
                  ]}
                  fim={{ rotulo: d.ponte.para, valor: d.ponte.brutoAtual }}
                  formato={fmtMoedaCompacta}
                />
              ) : d.ponte ? (
                <p className="text-sm text-muted">
                  Houve entrada ou saída de poucas pessoas na competência; o detalhe por grupo fica com o papel RH. Variação líquida:{" "}
                  <strong className="text-foreground">{fmtMoeda(d.ponte.brutoAtual - d.ponte.brutoAnterior)}</strong>.
                </p>
              ) : (
                <p className="text-sm text-muted">São necessárias duas competências consecutivas no período.</p>
              )}
            </Painel>
            <Painel titulo="Tipos de evento" descricao="Valor do período por natureza do evento.">
              <BarrasH itens={d.porTipoDeEvento.map((t) => ({ rotulo: t.rotulo, valor: t.valor, texto: fmtMoedaCompacta(t.valor) }))} />
            </Painel>
          </GradeDePaineis>

          <GradeDePaineis>
            <Painel titulo="Maiores eventos" descricao="Proventos e descontos que mais pesam no período.">
              <Tabela
                colunas={[
                  { titulo: "Evento", render: (l) => l.evento },
                  { titulo: "Tipo", render: (l) => <span className="text-muted">{l.tipo}</span> },
                  { titulo: "Pessoas", render: (l) => fmtInt(l.colaboradores), alinhar: "dir" },
                  { titulo: "Valor", render: (l) => fmtMoeda(l.valor), alinhar: "dir" },
                ]}
                linhas={d.topEventos}
              />
            </Painel>
            <Painel titulo={`Por centro de custo${u ? ` (${u.rotulo})` : ""}`} descricao="Folha bruta da última competência e custo médio por pessoa.">
              <Tabela
                colunas={[
                  { titulo: "Centro de custo", render: (l) => l.rotulo },
                  { titulo: "Pessoas", render: (l) => fmtInt(l.qtd), alinhar: "dir" },
                  { titulo: "Bruto", render: (l) => fmtMoeda(l.bruto), alinhar: "dir" },
                  { titulo: "Médio", render: (l) => (l.bruto != null && l.qtd ? fmtMoeda(l.bruto / l.qtd) : "—"), alinhar: "dir" },
                ]}
                linhas={d.porCentroCusto}
              />
            </Painel>
          </GradeDePaineis>

          <Painel titulo="Totais do período" descricao="Todos os tipos de cálculo, inclusive 13º, PLR e adiantamentos.">
            <GradeKpis colunas={5}>
              <Kpi rotulo="Bruto" valor={fmtMoeda(d.totaisDoPeriodo.bruto)} />
              <Kpi rotulo="Descontos" valor={fmtMoeda(d.totaisDoPeriodo.descontos)} />
              <Kpi rotulo="Líquido" valor={fmtMoeda(d.totaisDoPeriodo.liquido)} />
              <Kpi rotulo="13º e especiais" valor={fmtMoeda(d.totaisDoPeriodo.decimoTerceiroEEspeciais)} />
              <Kpi rotulo="Bases e encargos informativos" valor={fmtMoeda(d.totaisDoPeriodo.outros)} sub="não são pagos ao colaborador" />
            </GradeKpis>
          </Painel>
        </>
      )}
    </PaginaRh>
  );
}
