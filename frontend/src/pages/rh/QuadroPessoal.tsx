import { Aviso, GradeKpis, Kpi, PaginaRh, Painel, Tabela } from "../../components/rh/blocos";
import { BarrasH, Colunas, GradeDePaineis, Rosca } from "../../components/rh/graficos";
import { fmtData, fmtDec, fmtInt, fmtPessoas } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

interface Grupo {
  rotulo: string;
  qtd: number;
}

interface Quadro extends RespostaBase {
  referencia: string;
  kpis: {
    headcount: number;
    headcountInicioPeriodo: number;
    afastados: number;
    admitidosNoPeriodo: number;
    desligadosNoPeriodo: number;
    tempoMedioCasaAnos: number | null;
    idadeMedia: number | null;
  };
  extremos: { maisNovo: { nome: string | null; admissao: string } | null; maisAntigo: { nome: string | null; admissao: string } | null } | null;
  porTipo: Grupo[];
  porSexo: Grupo[];
  porEstadoCivil: Grupo[];
  porEscolaridade: Grupo[];
  porSituacao: Grupo[];
  porFaixaEtaria: Grupo[];
  porTempoDeCasa: Grupo[];
  porCentroCusto: Grupo[];
  porCargo: Grupo[];
  porLocal: Grupo[];
  porPosto: Grupo[];
  evolucao: { mes: string; rotulo: string; headcount: number; admissoes: number; desligamentos: number }[];
  aniversariosDeEmpresa: { nome: string; anos: number; admissao: string }[] | { quantidade: number };
}

const itens = (g: Grupo[]) => g.map((x) => ({ rotulo: x.rotulo, valor: x.qtd, texto: fmtInt(x.qtd) }));

export function QuadroPessoal() {
  const { dados: d, carregando, erro } = useRh<Quadro>("quadro");
  const k = d?.kpis;
  const variacaoQuadro = k && k.headcountInicioPeriodo ? Math.round(((k.headcount / k.headcountInicioPeriodo) - 1) * 1000) / 10 : null;
  const aniversarios = d?.aniversariosDeEmpresa;

  return (
    <PaginaRh
      titulo="Quadro de Pessoal"
      pergunta="Quantas pessoas temos hoje, quem são, há quanto tempo estão aqui e como o quadro mudou no período?"
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && k && (
        <>
          <GradeKpis colunas={6}>
            <Kpi
              rotulo="Headcount"
              valor={fmtInt(k.headcount)}
              variacao={variacaoQuadro}
              bomQuando="subir"
              vsRotulo="no período"
              sub={`${fmtInt(k.headcountInicioPeriodo)} no início`}
              ajuda={`Quem estava admitido em ${fmtData(d.referencia)} e não tinha sido desligado até essa data. Afastado (férias, licença, auxílio) conta como ativo.`}
            />
            <Kpi rotulo="Admitidos no período" valor={fmtInt(k.admitidosNoPeriodo)} tom="bom" />
            <Kpi rotulo="Desligados no período" valor={fmtInt(k.desligadosNoPeriodo)} tom={k.desligadosNoPeriodo > k.admitidosNoPeriodo ? "ruim" : "neutro"} />
            <Kpi rotulo="Afastados hoje" valor={fmtInt(k.afastados)} sub="férias, licenças e auxílios" />
            <Kpi rotulo="Tempo médio de casa" valor={k.tempoMedioCasaAnos == null ? "—" : `${fmtDec(k.tempoMedioCasaAnos)} anos`} />
            <Kpi rotulo="Idade média" valor={k.idadeMedia == null ? "—" : `${fmtDec(k.idadeMedia)} anos`} sub="só quem tem nascimento no cadastro" />
          </GradeKpis>

          <Painel
            titulo="Evolução do quadro"
            descricao="Headcount ao fim de cada mês, com as entradas e saídas do mês."
            ajuda="Headcount no último dia de cada mês (o mês corrente fecha na data final do filtro). Admissão pela data de admissão e desligamento pela data de afastamento da situação Demitido."
          >
            <Colunas
              pontos={d.evolucao.map((e) => ({ rotulo: e.rotulo, valores: [e.admissoes, e.desligamentos, e.headcount] }))}
              series={[
                { nome: "Admissões", cor: "primary" },
                { nome: "Desligamentos", cor: "destructive" },
                { nome: "Headcount", cor: "foreground", tipo: "linha", eixoDireito: true, formato: fmtInt },
              ]}
              formatoDireito={fmtInt}
            />
          </Painel>

          <GradeDePaineis>
            <Painel titulo="Tipo de colaborador">
              <Rosca itens={d.porTipo.map((g) => ({ rotulo: g.rotulo, valor: g.qtd }))} centro={{ valor: fmtInt(k.headcount), rotulo: "pessoas" }} />
            </Painel>
            <Painel titulo="Gênero">
              <Rosca itens={d.porSexo.map((g) => ({ rotulo: g.rotulo, valor: g.qtd }))} centro={{ valor: fmtInt(k.headcount), rotulo: "pessoas" }} />
            </Painel>
            <Painel titulo="Tempo de casa" descricao="Quanto tempo de empresa o quadro atual tem.">
              <BarrasH itens={itens(d.porTempoDeCasa)} />
            </Painel>
            <Painel titulo="Faixa etária">
              <BarrasH itens={itens(d.porFaixaEtaria)} />
            </Painel>
            <Painel titulo="Escolaridade" descricao="Grau de instrução do cadastro.">
              <BarrasH itens={itens(d.porEscolaridade)} />
            </Painel>
            <Painel titulo="Situação hoje" descricao="Situação do colaborador no cadastro do HCM.">
              <BarrasH itens={itens(d.porSituacao)} />
            </Painel>
          </GradeDePaineis>

          <GradeDePaineis>
            <Painel titulo="Por centro de custo">
              <BarrasH itens={itens(d.porCentroCusto)} limite={12} />
            </Painel>
            <Painel titulo="Por cargo">
              <BarrasH itens={itens(d.porCargo)} limite={12} />
            </Painel>
            <Painel titulo="Por local de trabalho">
              <BarrasH itens={itens(d.porLocal)} limite={12} />
            </Painel>
            <Painel titulo="Por posto de trabalho">
              <BarrasH itens={itens(d.porPosto)} limite={12} />
            </Painel>
          </GradeDePaineis>

          <GradeDePaineis>
            <Painel titulo="Extremos de tempo de casa" descricao="Quem chegou por último e quem está há mais tempo.">
              {d.extremos ? (
                <Tabela
                  colunas={[
                    { titulo: "", render: (l: { r: string }) => <span className="text-muted">{l.r}</span> },
                    { titulo: "Colaborador", render: (l: { n: string | null }) => l.n ?? "—" },
                    { titulo: "Admissão", render: (l: { a: string }) => fmtData(l.a), alinhar: "dir" },
                  ]}
                  linhas={[
                    ...(d.extremos.maisAntigo ? [{ r: "Mais antigo", n: d.extremos.maisAntigo.nome, a: d.extremos.maisAntigo.admissao }] : []),
                    ...(d.extremos.maisNovo ? [{ r: "Mais novo", n: d.extremos.maisNovo.nome, a: d.extremos.maisNovo.admissao }] : []),
                  ]}
                />
              ) : (
                <Aviso tom="info">Nomes e datas individuais ficam com o papel RH.</Aviso>
              )}
            </Painel>
            <Painel titulo="Aniversários de empresa no mês" descricao="Quem completa mais um ano de casa no mês da data final.">
              {Array.isArray(aniversarios) ? (
                <Tabela
                  colunas={[
                    { titulo: "Colaborador", render: (l) => l.nome },
                    { titulo: "Anos de casa", render: (l) => fmtInt(l.anos), alinhar: "dir" },
                    { titulo: "Admissão", render: (l) => fmtData(l.admissao), alinhar: "dir" },
                  ]}
                  linhas={aniversarios}
                  vazio="Ninguém completa ano de casa neste mês."
                />
              ) : (
                <p className="text-sm text-muted">{aniversarios ? `${fmtPessoas(aniversarios.quantidade)} completam ano de casa neste mês.` : "—"}</p>
              )}
            </Painel>
          </GradeDePaineis>
          <p className="text-[11.5px] text-muted">Recortes de cadastro (centro de custo, cargo, local) usam o cadastro atual do colaborador.</p>
        </>
      )}
    </PaginaRh>
  );
}
