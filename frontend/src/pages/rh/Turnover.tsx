import { GradeKpis, Kpi, PaginaRh, Painel } from "../../components/rh/blocos";
import { BarrasH, Colunas, GradeDePaineis, MatrizCalor, Rosca } from "../../components/rh/graficos";
import { fmtDec, fmtInt, fmtPct } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

interface Turnover extends RespostaBase {
  periodo: { meses: number };
  kpis: {
    turnover: number | null;
    turnoverMensalMedio: number | null;
    taxaDesligamento: number | null;
    taxaDesligamentoVoluntario: number | null;
    taxaDesligamentoPelaEmpresa: number | null;
    headcountInicio: number;
    headcountFim: number;
    headcountMedio: number;
    admissoes: number;
    desligamentos: number;
    retencao90: { retencao: number | null; base: number };
    retencao180: { retencao: number | null; base: number };
    retencao365: { retencao: number | null; base: number };
  };
  meses: {
    rotulo: string;
    headcountInicio: number;
    headcountFim: number;
    admissoes: number;
    desligamentos: number;
    desligamentosVoluntarios: number;
    desligamentosPelaEmpresa: number;
    turnover: number | null;
  }[];
  coortes: { rotulo: string; admitidos: number; retencao90: number | null; retencao180: number | null; retencao365: number | null }[];
  desligamentosPorTempoDeCasa: { rotulo: string; qtd: number }[];
  desligamentosPorCausa: { rotulo: string; qtd: number }[];
  desligamentosPorIniciativa: { rotulo: string; qtd: number }[];
  desligamentosPorCentroCusto: { rotulo: string; qtd: number }[];
}

// Referências de mercado para a cor do KPI: não são metas do cliente (as metas moram em Administração >
// Metas), só um semáforo para quem abre a tela sem contexto. Turnover anual até ~20% é comum em serviços.
function tomTurnover(v: number | null) {
  if (v == null) return "neutro" as const;
  return v <= 20 ? ("bom" as const) : v <= 35 ? ("atencao" as const) : ("ruim" as const);
}
function tomRetencao(v: number | null) {
  if (v == null) return "neutro" as const;
  return v >= 90 ? ("bom" as const) : v >= 75 ? ("atencao" as const) : ("ruim" as const);
}

export function Turnover() {
  const { dados: d, carregando, erro } = useRh<Turnover>("turnover");
  const k = d?.kpis;

  return (
    <PaginaRh
      titulo="Turnover"
      pergunta="Quanto o quadro gira, quem fica depois de contratado e em que momento as pessoas saem?"
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && k && (
        <>
          <GradeKpis colunas={5}>
            <Kpi
              rotulo="Turnover do período"
              valor={fmtPct(k.turnover, 1)}
              tom={tomTurnover(k.turnover)}
              sub={k.turnoverMensalMedio != null ? `${fmtPct(k.turnoverMensalMedio, 1)} ao mês em média` : undefined}
              ajuda={`((admissões + desligamentos) ÷ 2) ÷ headcount médio. Janela de ${d.periodo.meses} meses: não é anualizado, então períodos de tamanhos diferentes não se comparam diretamente.`}
            />
            <Kpi
              rotulo="Taxa de desligamento"
              valor={fmtPct(k.taxaDesligamento, 1)}
              sub={`${fmtPct(k.taxaDesligamentoVoluntario, 1)} voluntário · ${fmtPct(k.taxaDesligamentoPelaEmpresa, 1)} pela empresa`}
              ajuda="Desligamentos ÷ headcount médio. Voluntário = pedido de demissão e abandono; pela empresa = dispensa."
            />
            <Kpi rotulo="Headcount" valor={`${fmtInt(k.headcountInicio)} → ${fmtInt(k.headcountFim)}`} sub={`médio ${fmtDec(k.headcountMedio)}`} />
            <Kpi rotulo="Admissões" valor={fmtInt(k.admissoes)} tom="bom" />
            <Kpi rotulo="Desligamentos" valor={fmtInt(k.desligamentos)} tom={k.desligamentos > k.admissoes ? "ruim" : "neutro"} />
          </GradeKpis>

          <GradeKpis colunas={3}>
            <Kpi
              rotulo="Retenção aos 90 dias"
              valor={fmtPct(k.retencao90.retencao)}
              tom={tomRetencao(k.retencao90.retencao)}
              sub={`${fmtInt(k.retencao90.base)} admitidos observados`}
              ajuda="Dos admitidos nos últimos 24 meses, quantos ainda estavam ativos 90 dias depois. Só entram as admissões que já completaram os 90 dias."
            />
            <Kpi rotulo="Retenção aos 6 meses" valor={fmtPct(k.retencao180.retencao)} tom={tomRetencao(k.retencao180.retencao)} sub={`${fmtInt(k.retencao180.base)} admitidos observados`} />
            <Kpi rotulo="Retenção aos 12 meses" valor={fmtPct(k.retencao365.retencao)} tom={tomRetencao(k.retencao365.retencao)} sub={`${fmtInt(k.retencao365.base)} admitidos observados`} />
          </GradeKpis>

          <Painel titulo="Admissões × desligamentos" descricao="Entradas e saídas por mês, com o turnover do mês." ajuda="Turnover do mês = ((admissões + desligamentos) ÷ 2) ÷ headcount médio do mês (média entre o início e o fim).">
            <Colunas
              pontos={d.meses.map((m) => ({ rotulo: m.rotulo, valores: [m.admissoes, m.desligamentos, m.turnover] }))}
              series={[
                { nome: "Admissões", cor: "primary" },
                { nome: "Desligamentos", cor: "destructive" },
                { nome: "Turnover do mês", cor: "warning", tipo: "linha", eixoDireito: true },
              ]}
              formatoDireito={(v) => fmtPct(v, 1)}
            />
          </Painel>

          <Painel
            titulo="Retenção por coorte de admissão"
            descricao="De cada mês de admissão, quantos continuavam ativos depois de 90 dias, 6 e 12 meses."
            ajuda="Cada linha é uma leva de admitidos. O traço (—) indica que a coorte ainda não completou aquele horizonte: não inventamos uma taxa para o futuro. Isto substitui a 'retenção' calculada como saldo de entradas e saídas, que pode dar valor negativo ou acima de 100%."
          >
            <MatrizCalor
              colunas={["90 dias", "6 meses", "12 meses"]}
              linhas={d.coortes.map((c) => ({ rotulo: c.rotulo, detalhe: `${fmtInt(c.admitidos)} adm.`, celulas: [c.retencao90, c.retencao180, c.retencao365] }))}
              vazio="Sem admissões nos últimos 24 meses."
            />
          </Painel>

          <GradeDePaineis>
            <Painel titulo="Em que momento as pessoas saem" descricao="Desligamentos do período por tempo de casa." ajuda="Tempo entre a admissão e a data do desligamento. Concentração em 'menos de 90 dias' aponta para seleção ou integração.">
              <BarrasH itens={d.desligamentosPorTempoDeCasa.map((x) => ({ rotulo: x.rotulo, valor: x.qtd, texto: fmtInt(x.qtd), cor: x.rotulo.startsWith("Menos de 90") ? "destructive" : "primary" }))} />
            </Painel>
            <Painel titulo="Quem decidiu a saída">
              <Rosca itens={d.desligamentosPorIniciativa.map((x) => ({ rotulo: x.rotulo, valor: x.qtd }))} centro={{ valor: fmtInt(k.desligamentos), rotulo: "desligamentos" }} />
            </Painel>
            <Painel titulo="Causas de desligamento">
              <BarrasH itens={d.desligamentosPorCausa.map((x) => ({ rotulo: x.rotulo, valor: x.qtd, texto: fmtInt(x.qtd) }))} />
            </Painel>
            <Painel titulo="Desligamentos por centro de custo">
              <BarrasH itens={d.desligamentosPorCentroCusto.map((x) => ({ rotulo: x.rotulo, valor: x.qtd, texto: fmtInt(x.qtd) }))} limite={10} />
            </Painel>
          </GradeDePaineis>
        </>
      )}
    </PaginaRh>
  );
}
