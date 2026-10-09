import { Aviso, GradeKpis, Kpi, PaginaRh, Painel, Tabela } from "../../components/rh/blocos";
import { BarrasH, Colunas, GradeDePaineis, Rosca } from "../../components/rh/graficos";
import { fmtData, fmtInt, fmtMoeda, fmtMoedaCompacta, fmtPct } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

interface Grupo {
  rotulo: string;
  qtd: number;
  proventos: number | null;
  descontos?: number | null;
}

interface Rescisoes extends RespostaBase {
  kpis: {
    rescisoes: number;
    proventos: number | null;
    descontos: number | null;
    liquido: number | null;
    saldoFgts: number | null;
    custoMedioPorRescisao: number | null;
    tempoMedioDeCasaDias: number | null;
    desligamentosPrecoces: number;
    desligamentosPrecocesPct: number | null;
  };
  causas: { rotulo: string; qtd: number; proventos: number | null }[];
  iniciativa: { rotulo: string; qtd: number; proventos: number | null }[];
  eventos: { rotulo: string; qtd: number; valor: number }[];
  evolucao: { rotulo: string; qtd: number; proventos: number | null; descontos: number | null; saldoFgts: number | null }[];
  porCentroCusto: Grupo[];
  porCargo: Grupo[];
  porPosto: Grupo[];
  lista: { nome: string | null; admissao: string; demissao: string; causa: string | null; proventos: number; descontos: number; saldoFgts: number }[] | null;
}

const grupoBarras = (g: Grupo[]) => g.map((x) => ({ rotulo: x.rotulo, valor: x.qtd, texto: `${fmtInt(x.qtd)}${x.proventos != null ? ` · ${fmtMoedaCompacta(x.proventos)}` : ""}` }));

export function Rescisoes() {
  const { dados: d, carregando, erro } = useRh<Rescisoes>("rescisoes");
  const k = d?.kpis;
  const restrito = !!d && !d.acesso.individual && k != null && k.rescisoes > 0 && k.proventos == null;

  return (
    <PaginaRh
      titulo="Rescisões"
      pergunta="Quanto custam as rescisões, por que as pessoas saem e quem sai cedo demais?"
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && k && (
        <>
          <Aviso tom="info">
            Contam as pessoas com cálculo de rescisão no Senior (empregados). Terceiros e parceiros que saem não têm cálculo e aparecem só no Turnover.
          </Aviso>
          {restrito && <Aviso tom="alerta">Poucas rescisões no recorte: os valores só aparecem para o papel RH.</Aviso>}

          <GradeKpis colunas={5}>
            <Kpi rotulo="Rescisões" valor={fmtInt(k.rescisoes)} sub={k.tempoMedioDeCasaDias != null ? `${fmtInt(Math.round(k.tempoMedioDeCasaDias / 30.4))} meses de casa em média` : undefined} />
            <Kpi rotulo="Proventos" valor={fmtMoeda(k.proventos)} restrito={restrito} ajuda="Total de proventos do cálculo de rescisão (verbas rescisórias, férias, 13º, aviso)." />
            <Kpi rotulo="Descontos" valor={fmtMoeda(k.descontos)} restrito={restrito} />
            <Kpi rotulo="Saldo de FGTS" valor={fmtMoeda(k.saldoFgts)} restrito={restrito} ajuda="Saldo de FGTS informado no cálculo de rescisão (R042RCM)." />
            <Kpi
              rotulo="Custo médio por rescisão"
              valor={fmtMoeda(k.custoMedioPorRescisao)}
              restrito={restrito}
              sub="proventos ÷ rescisões"
            />
          </GradeKpis>

          <GradeKpis colunas={3}>
            <Kpi
              rotulo="Saída precoce (menos de 90 dias)"
              valor={k.desligamentosPrecocesPct == null ? "—" : fmtPct(k.desligamentosPrecocesPct)}
              tom={(k.desligamentosPrecocesPct ?? 0) >= 20 ? "ruim" : (k.desligamentosPrecocesPct ?? 0) >= 10 ? "atencao" : "bom"}
              sub={`${fmtInt(k.desligamentosPrecoces)} de ${fmtInt(k.rescisoes)}`}
              ajuda="Desligamento com menos de 90 dias de casa: sinal de seleção ou integração falha. Acima de 20% é alerta."
            />
          </GradeKpis>

          <GradeDePaineis>
            <Painel titulo="Principais causas" descricao="Causa de demissão do cálculo de rescisão.">
              <Rosca itens={d.causas.map((c) => ({ rotulo: c.rotulo, valor: c.qtd }))} centro={{ valor: fmtInt(k.rescisoes), rotulo: "rescisões" }} />
            </Painel>
            <Painel titulo="Quem decidiu a saída" descricao="Iniciativa da empresa, do colaborador, fim de contrato ou acordo.">
              <Rosca itens={d.iniciativa.map((c) => ({ rotulo: c.rotulo, valor: c.qtd }))} centro={{ valor: fmtInt(k.rescisoes), rotulo: "rescisões" }} />
            </Painel>
          </GradeDePaineis>

          <Painel titulo="Evolução mensal" descricao="Quantidade de rescisões e proventos pagos por mês." ajuda="Mês da data de demissão. Proventos e descontos do cálculo de rescisão (R042RCM).">
            <Colunas
              pontos={d.evolucao.map((e) => ({ rotulo: e.rotulo, valores: [e.qtd, e.proventos] }))}
              series={[
                { nome: "Rescisões", cor: "primary" },
                { nome: "Proventos", cor: "warning", tipo: "linha", eixoDireito: true, formato: fmtMoedaCompacta },
              ]}
              formatoDireito={fmtMoedaCompacta}
            />
          </Painel>

          <GradeDePaineis>
            <Painel titulo="Tipos de evento" descricao="O que compõe as rescisões (saldo de salário, férias, aviso, FGTS, líquido).">
              <BarrasH itens={d.eventos.map((e) => ({ rotulo: e.rotulo, valor: Math.abs(e.valor), texto: fmtMoedaCompacta(e.valor), detalhe: `${fmtInt(e.qtd)} rescis${e.qtd === 1 ? "ão" : "ões"}` }))} limite={10} vazio="Sem eventos no recorte (ou restritos ao papel RH)." />
            </Painel>
            <Painel titulo="Por centro de custo">
              <BarrasH itens={grupoBarras(d.porCentroCusto)} limite={10} />
            </Painel>
            <Painel titulo="Por cargo">
              <BarrasH itens={grupoBarras(d.porCargo)} limite={10} />
            </Painel>
            <Painel titulo="Por posto de trabalho">
              <BarrasH itens={grupoBarras(d.porPosto)} limite={10} />
            </Painel>
          </GradeDePaineis>

          {d.lista && (
            <Painel titulo="Rescisões do período" descricao="Lista nominal, só para o papel RH.">
              <Tabela
                colunas={[
                  { titulo: "Colaborador", render: (l) => l.nome },
                  { titulo: "Admissão", render: (l) => fmtData(l.admissao), alinhar: "dir" },
                  { titulo: "Demissão", render: (l) => fmtData(l.demissao), alinhar: "dir" },
                  { titulo: "Causa", render: (l) => l.causa ?? "—" },
                  { titulo: "Proventos", render: (l) => fmtMoeda(l.proventos), alinhar: "dir" },
                  { titulo: "Descontos", render: (l) => fmtMoeda(l.descontos), alinhar: "dir" },
                  { titulo: "FGTS", render: (l) => fmtMoeda(l.saldoFgts), alinhar: "dir" },
                ]}
                linhas={d.lista}
              />
            </Painel>
          )}
        </>
      )}
    </PaginaRh>
  );
}
