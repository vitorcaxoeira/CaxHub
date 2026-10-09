import { Aviso, GradeKpis, Kpi, PaginaRh, Painel, Tabela } from "../../components/rh/blocos";
import { BarrasH, Colunas, GradeDePaineis } from "../../components/rh/graficos";
import { fmtHoras, fmtInt, fmtPct, fmtPessoas } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

interface GrupoAus {
  rotulo: string;
  qtd: number;
  horasAusencia: number | null;
  indice: number | null;
}

interface Absenteismo extends RespostaBase {
  kpis: {
    indice: number | null;
    horasPrevistas: number;
    horasTrabalhadas: number;
    horasAusencia: number;
    faltasNaoJustificadas: number;
    faltasJustificadas: number;
    atestados: number;
    horasDeAtraso: number;
    horasDeSaidaAntecipada: number;
    colaboradores: number;
  };
  evolucao: { rotulo: string; horasPrevistas: number; horasTrabalhadas: number; horasAusencia: number; indice: number | null }[];
  porSituacao: { rotulo: string; classe: number; horas: number; ocorrencias: number }[];
  porDiaDaSemana: { rotulo: string; horasAusencia: number; indice: number | null }[];
  porTipoDeColaborador: { rotulo: string; colaboradores: number; horasAusencia: number; indice: number | null }[];
  porCentroCusto: GrupoAus[];
  porCargo: GrupoAus[];
  afastamentos: { rotulo: string; qtd: number; diasMedios: number | null; emCurso: number }[];
  ranking: { nome: string | null; horasAusencia: number; dias: number; indice: number | null }[] | null;
}

// Semáforo de referência (não é meta do cliente): índice de absenteísmo até ~3% é considerado saudável.
function tomIndice(v: number | null) {
  if (v == null) return "neutro" as const;
  return v <= 3 ? ("bom" as const) : v <= 5 ? ("atencao" as const) : ("ruim" as const);
}

const barrasGrupo = (g: GrupoAus[]) =>
  g.map((x) => ({ rotulo: x.rotulo, valor: x.indice, texto: x.indice == null ? `${fmtPessoas(x.qtd)}` : `${fmtPct(x.indice)} · ${fmtHoras(x.horasAusencia)}`, detalhe: `${fmtPessoas(x.qtd)}`, cor: (x.indice ?? 0) > 5 ? ("destructive" as const) : ("primary" as const) }));

export function Absenteismo() {
  const { dados: d, carregando, erro } = useRh<Absenteismo>("absenteismo");
  const k = d?.kpis;

  return (
    <PaginaRh
      titulo="Absenteísmo"
      pergunta="Quanto do tempo previsto de trabalho se perde com faltas e atestados, onde e em que dias?"
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && k && (
        <>
          <GradeKpis colunas={5}>
            <Kpi
              rotulo="Índice de absenteísmo"
              valor={fmtPct(k.indice, 2)}
              tom={tomIndice(k.indice)}
              sub={`${fmtHoras(k.horasAusencia)} de ausência`}
              ajuda="Horas de ausência (faltas, faltas justificadas e atestado) ÷ (horas trabalhadas + horas de ausência). Usa a classificação do próprio Senior para cada situação do ponto; férias, licença maternidade e demitidos ficam fora, como no relatório do Senior."
            />
            <Kpi rotulo="Horas previstas" valor={fmtHoras(k.horasPrevistas)} sub="trabalhadas + ausência" />
            <Kpi rotulo="Horas trabalhadas" valor={fmtHoras(k.horasTrabalhadas)} />
            <Kpi rotulo="Faltas não justificadas" valor={fmtHoras(k.faltasNaoJustificadas)} tom={k.faltasNaoJustificadas > 0 ? "atencao" : "neutro"} />
            <Kpi rotulo="Atestados" valor={fmtHoras(k.atestados)} sub={`+ ${fmtHoras(k.faltasJustificadas)} justificadas`} />
          </GradeKpis>

          <Painel
            titulo="Horas previstas × trabalhadas × índice"
            descricao="Por mês do período."
            ajuda="Mês da data de apuração do ponto. Previstas = trabalhadas + ausência; o índice é a ausência sobre as previstas."
          >
            <Colunas
              pontos={d.evolucao.map((e) => ({ rotulo: e.rotulo, valores: [e.horasPrevistas, e.horasTrabalhadas, e.indice] }))}
              series={[
                { nome: "Previstas", cor: "muted", formato: (v) => fmtHoras(v) },
                { nome: "Trabalhadas", cor: "primary", formato: (v) => fmtHoras(v) },
                { nome: "Índice", cor: "destructive", tipo: "linha", eixoDireito: true },
              ]}
              formato={(v) => fmtHoras(v)}
              formatoDireito={(v) => fmtPct(v, 1)}
            />
          </Painel>

          <GradeDePaineis>
            <Painel titulo="Onde estão as horas perdidas" descricao="Situações que somam no índice e, à parte, atrasos e saídas antecipadas.">
              <BarrasH
                itens={d.porSituacao.map((s) => ({
                  rotulo: s.rotulo,
                  valor: s.horas,
                  texto: fmtHoras(s.horas),
                  detalhe: s.classe === 1 ? `${fmtInt(s.ocorrencias)} ocorrências · fora do índice (pontualidade)` : `${fmtInt(s.ocorrencias)} ocorrências`,
                  cor: s.classe === 1 ? ("warning" as const) : ("destructive" as const),
                }))}
                formato={fmtHoras}
              />
            </Painel>
            <Painel titulo="Por dia da semana" descricao="Índice de absenteísmo em cada dia.">
              <BarrasH itens={d.porDiaDaSemana.map((x) => ({ rotulo: x.rotulo, valor: x.indice, texto: fmtPct(x.indice), detalhe: fmtHoras(x.horasAusencia) }))} maximo={Math.max(...d.porDiaDaSemana.map((x) => x.indice ?? 0), 5)} />
            </Painel>
            <Painel titulo="Por centro de custo" descricao="Índice e horas de ausência.">
              <BarrasH itens={barrasGrupo(d.porCentroCusto)} limite={10} maximo={Math.max(...d.porCentroCusto.map((x) => x.indice ?? 0), 5)} />
            </Painel>
            <Painel titulo="Por cargo">
              <BarrasH itens={barrasGrupo(d.porCargo)} limite={10} maximo={Math.max(...d.porCargo.map((x) => x.indice ?? 0), 5)} />
            </Painel>
          </GradeDePaineis>

          <GradeDePaineis>
            <Painel titulo="Por tipo de colaborador" descricao="Mostra por que o padrão desta tela é só empregados.">
              <Tabela
                colunas={[
                  { titulo: "Tipo", render: (l) => l.rotulo },
                  { titulo: "Pessoas", render: (l) => fmtInt(l.colaboradores), alinhar: "dir" },
                  { titulo: "Horas de ausência", render: (l) => fmtHoras(l.horasAusencia), alinhar: "dir" },
                  { titulo: "Índice", render: (l) => fmtPct(l.indice), alinhar: "dir" },
                ]}
                linhas={d.porTipoDeColaborador}
              />
              <p className="mt-2 text-[11.5px] text-muted">Selecione outro tipo de colaborador na barra de filtros para ver este recorte nas demais telas.</p>
            </Painel>
            <Painel titulo="Afastamentos do período" descricao="Registros de afastamento do HCM iniciados no período (sem o motivo médico, por LGPD).">
              <Tabela
                colunas={[
                  { titulo: "Situação", render: (l) => l.rotulo },
                  { titulo: "Registros", render: (l) => fmtInt(l.qtd), alinhar: "dir" },
                  { titulo: "Duração média", render: (l) => (l.diasMedios == null ? "—" : `${l.diasMedios.toLocaleString("pt-BR")} dias`), alinhar: "dir" },
                  { titulo: "Em curso", render: (l) => fmtInt(l.emCurso), alinhar: "dir" },
                ]}
                linhas={d.afastamentos}
              />
            </Painel>
          </GradeDePaineis>

          {d.ranking ? (
            <Painel titulo="Quem mais se ausentou" descricao="Lista nominal, só para o papel RH.">
              <Tabela
                colunas={[
                  { titulo: "Colaborador", render: (l) => l.nome },
                  { titulo: "Dias com ausência", render: (l) => fmtInt(l.dias), alinhar: "dir" },
                  { titulo: "Horas", render: (l) => fmtHoras(l.horasAusencia), alinhar: "dir" },
                  { titulo: "Índice", render: (l) => fmtPct(l.indice), alinhar: "dir" },
                ]}
                linhas={d.ranking}
                vazio="Ninguém com ausência no período."
              />
            </Painel>
          ) : (
            <Aviso tom="info">O ranking nominal de ausências fica com o papel RH.</Aviso>
          )}
        </>
      )}
    </PaginaRh>
  );
}
