import { Aviso, GradeKpis, Kpi, PaginaRh, Painel, Tabela } from "../../components/rh/blocos";
import { BarrasH, Colunas, GradeDePaineis } from "../../components/rh/graficos";
import { fmtData, fmtInt, fmtMoeda, fmtPct } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

interface GrupoMediana {
  rotulo: string;
  qtd: number;
  mediana: number | null;
  media?: number | null;
}

interface Reajustes extends RespostaBase {
  kpis: {
    alteracoes: number;
    aumentos: number;
    reducoes: number;
    medianaAumento: number | null;
    mediaAumento: number | null;
    maiorAumento: number | null;
  };
  porMotivo: GrupoMediana[];
  evolucao: { rotulo: string; aumentos: number; mediana: number | null; media: number | null }[];
  distribuicao: { rotulo: string; qtd: number }[];
  porCentroCusto: GrupoMediana[];
  porCargo: GrupoMediana[];
  tempoSemAumento: { rotulo: string; qtd: number }[];
  maioresAumentos: { nome: string | null; data: string; motivo: string | null; percentual: number; salario: number }[] | null;
}

const porGrupo = (g: GrupoMediana[]) => g.map((x) => ({ rotulo: x.rotulo, valor: x.mediana, texto: x.mediana == null ? `${fmtInt(x.qtd)} aumentos` : `${fmtPct(x.mediana)} · ${fmtInt(x.qtd)}` }));

export function Reajustes() {
  const { dados: d, carregando, erro } = useRh<Reajustes>("reajustes");
  const k = d?.kpis;

  return (
    <PaginaRh
      titulo="Reajustes Salariais"
      pergunta="Quanto, por que e para quem os salários subiram, e quem está há muito tempo sem reajuste?"
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && k && (
        <>
          <Aviso tom="info">
            O percentual compara cada alteração com a anterior do mesmo colaborador. A admissão (primeira linha do histórico) não conta como reajuste,
            e a mediana evita que um caso isolado (ex.: mudança de carga horária) distorça o resultado.
          </Aviso>

          <GradeKpis colunas={5}>
            <Kpi
              rotulo="Reajuste mediano"
              valor={k.medianaAumento == null ? "—" : fmtPct(k.medianaAumento)}
              restrito={k.medianaAumento == null && k.aumentos > 0 && !d.acesso.individual}
              sub={`${fmtInt(k.aumentos)} aumentos no período`}
              ajuda="Mediana dos aumentos (percentual > 0). Metade dos aumentos foi menor, metade maior."
            />
            <Kpi rotulo="Reajuste médio" valor={k.mediaAumento == null ? "—" : fmtPct(k.mediaAumento)} restrito={k.mediaAumento == null && k.aumentos > 0 && !d.acesso.individual} sub="média simples dos aumentos" />
            <Kpi rotulo="Alterações salariais" valor={fmtInt(k.alteracoes)} sub={k.reducoes ? `${fmtInt(k.reducoes)} reduções` : "nenhuma redução"} tom={k.reducoes ? "atencao" : "neutro"} />
            <Kpi rotulo="Maior aumento" valor={k.maiorAumento == null ? "—" : fmtPct(k.maiorAumento)} restrito={k.maiorAumento == null && !d.acesso.individual} sub="só o papel RH vê quem" />
            <Kpi rotulo="Sem aumento há mais de 1 ano" valor={fmtInt(d.tempoSemAumento.filter((t) => ["1 a 2 anos", "Mais de 2 anos", "Nunca reajustado"].includes(t.rotulo)).reduce((s, t) => s + t.qtd, 0))} tom="atencao" sub="empregados ativos" />
          </GradeKpis>

          <Painel titulo="Evolução dos reajustes" descricao="Quantidade de aumentos por mês e o percentual mediano." ajuda="Mês da data da alteração. A linha é a mediana dos aumentos do mês (some quando há menos de 3, para não expor uma pessoa).">
            <Colunas
              pontos={d.evolucao.map((e) => ({ rotulo: e.rotulo, valores: [e.aumentos, e.mediana] }))}
              series={[
                { nome: "Aumentos", cor: "primary" },
                { nome: "Mediana (%)", cor: "warning", tipo: "linha", eixoDireito: true },
              ]}
              formatoDireito={(v) => fmtPct(v, 0)}
            />
          </Painel>

          <GradeDePaineis>
            <Painel titulo="Por motivo" descricao="Reajuste mediano por motivo da alteração (dissídio, mérito, promoção...).">
              <BarrasH itens={porGrupo(d.porMotivo)} />
            </Painel>
            <Painel titulo="Distribuição dos percentuais" descricao="Quantas alterações caíram em cada faixa.">
              <BarrasH itens={d.distribuicao.map((x) => ({ rotulo: x.rotulo, valor: x.qtd, texto: fmtInt(x.qtd) }))} />
            </Painel>
            <Painel titulo="Por centro de custo">
              <BarrasH itens={porGrupo(d.porCentroCusto)} limite={10} />
            </Painel>
            <Painel titulo="Por cargo">
              <BarrasH itens={porGrupo(d.porCargo)} limite={10} />
            </Painel>
          </GradeDePaineis>

          <GradeDePaineis>
            <Painel titulo="Tempo desde o último aumento" descricao="Empregados ativos: fila natural de revisão salarial." ajuda="Dias entre a data final do filtro e o último aumento (salário maior que o anterior). Quem nunca teve aumento fica à parte.">
              <BarrasH itens={d.tempoSemAumento.map((x) => ({ rotulo: x.rotulo, valor: x.qtd, texto: fmtInt(x.qtd), cor: x.rotulo.includes("Mais de 2") || x.rotulo.includes("Nunca") ? "warning" : "primary" }))} />
            </Painel>
            {d.maioresAumentos && (
              <Painel titulo="Maiores aumentos do período" descricao="Lista nominal, só para o papel RH.">
                <Tabela
                  colunas={[
                    { titulo: "Colaborador", render: (l) => l.nome },
                    { titulo: "Data", render: (l) => fmtData(l.data), alinhar: "dir" },
                    { titulo: "Motivo", render: (l) => l.motivo ?? "—" },
                    { titulo: "Aumento", render: (l) => fmtPct(l.percentual), alinhar: "dir" },
                    { titulo: "Salário", render: (l) => fmtMoeda(l.salario), alinhar: "dir" },
                  ]}
                  linhas={d.maioresAumentos}
                />
              </Painel>
            )}
          </GradeDePaineis>
        </>
      )}
    </PaginaRh>
  );
}
