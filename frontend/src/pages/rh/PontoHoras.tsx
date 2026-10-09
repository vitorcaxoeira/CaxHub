import { Aviso, GradeKpis, Kpi, PaginaRh, Painel, Tabela } from "../../components/rh/blocos";
import { BarrasH, Colunas, GradeDePaineis } from "../../components/rh/graficos";
import { fmtHoras, fmtInt, fmtPct, fmtPessoas } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

interface GrupoHe {
  rotulo: string;
  qtd: number;
  horasExtras: number | null;
  pctDasTrabalhadas: number | null;
}

interface Ponto extends RespostaBase {
  kpis: {
    horasExtrasPagas: number;
    creditoNoBanco: number;
    debitoNoBanco: number;
    totalDeExtras: number;
    pctDasHorasTrabalhadas: number | null;
    colaboradoresComExtras: number;
    colaboradoresNoPeriodo: number;
    saldoBancoTotal: number;
    saldoPositivo: number;
    saldoNegativo: number;
    colaboradoresComSaldoPositivo: number;
    colaboradoresComSaldoNegativo: number;
  };
  evolucao: { rotulo: string; horasExtrasPagas: number; creditoNoBanco: number; debitoNoBanco: number; pctDasHorasTrabalhadas: number | null }[];
  porSituacao: { rotulo: string; horas: number; ocorrencias: number }[];
  porDiaDaSemana: { rotulo: string; horas: number }[];
  porCentroCusto: GrupoHe[];
  porCargo: GrupoHe[];
  agingDoSaldoPositivo: { rotulo: string; horas: number; colaboradores: number }[];
  maioresSaldos: { nome: string | null; saldoHoras: number }[] | null;
}

const barrasGrupo = (g: GrupoHe[]) =>
  g.map((x) => ({ rotulo: x.rotulo, valor: x.horasExtras, texto: x.horasExtras == null ? `${fmtPessoas(x.qtd)}` : `${fmtHoras(x.horasExtras)} · ${fmtPct(x.pctDasTrabalhadas)}`, detalhe: `${fmtPessoas(x.qtd)}` }));

export function PontoHoras() {
  const { dados: d, carregando, erro } = useRh<Ponto>("ponto");
  const k = d?.kpis;
  const vencido = d?.agingDoSaldoPositivo.find((a) => a.rotulo.startsWith("Mais de 180"));

  return (
    <PaginaRh
      titulo="Horas Extras e Banco de Horas"
      pergunta="Quantas horas extras a operação gera, para onde elas vão (folha ou banco) e quanto do banco está envelhecendo?"
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && k && (
        <>
          {k.horasExtrasPagas === 0 && k.creditoNoBanco > 0 && (
            <Aviso tom="info">Neste recorte toda a hora extra vai para o banco de horas: não há horas extras pagas na folha.</Aviso>
          )}
          <GradeKpis colunas={5}>
            <Kpi
              rotulo="Horas extras do período"
              valor={fmtHoras(k.totalDeExtras)}
              sub={`${fmtPct(k.pctDasHorasTrabalhadas)} das horas trabalhadas`}
              ajuda="Horas extras pagas (situações 16, 66, 301 a 304) + crédito de banco de horas (901, 903, 911, 912), pela apuração do ponto."
            />
            <Kpi rotulo="Pagas na folha" valor={fmtHoras(k.horasExtrasPagas)} />
            <Kpi rotulo="Creditadas no banco" valor={fmtHoras(k.creditoNoBanco)} />
            <Kpi rotulo="Pessoas com hora extra" valor={fmtInt(k.colaboradoresComExtras)} sub={`de ${fmtInt(k.colaboradoresNoPeriodo)} no período`} />
            <Kpi
              rotulo="Saldo do banco"
              valor={fmtHoras(k.saldoBancoTotal)}
              tom={k.saldoBancoTotal < 0 ? "atencao" : "neutro"}
              sub={`${fmtHoras(k.saldoPositivo)} a favor · ${fmtHoras(k.saldoNegativo)} devedor`}
              ajuda="Σ sinal × (quantidade − parte já liquidada) dos lançamentos do banco, até a data final, de quem está ativo. Positivo = horas a favor do colaborador; negativo = colaborador devendo horas à empresa."
            />
          </GradeKpis>

          <Painel titulo="Evolução das horas extras" descricao="Horas por mês e o peso sobre as horas trabalhadas.">
            <Colunas
              pontos={d.evolucao.map((e) => ({ rotulo: e.rotulo, valores: [e.horasExtrasPagas, e.creditoNoBanco, e.pctDasHorasTrabalhadas] }))}
              series={[
                { nome: "Pagas na folha", cor: "primary", formato: fmtHoras },
                { nome: "Creditadas no banco", cor: "warning", formato: fmtHoras },
                { nome: "% das trabalhadas", cor: "foreground", tipo: "linha", eixoDireito: true },
              ]}
              empilhado
              formato={fmtHoras}
              formatoDireito={(v) => fmtPct(v, 1)}
            />
          </Painel>

          <GradeDePaineis>
            <Painel
              titulo="Banco de horas: idade do saldo positivo"
              descricao="O saldo a favor do colaborador, por idade do crédito."
              ajuda="Os débitos e compensações abatem primeiro os créditos mais antigos; o que sobra é o saldo positivo, separado pela idade do lançamento. Acima de 180 dias passa do prazo legal do acordo individual (CLT art. 59, § 5º): é risco de pagar como hora extra."
            >
              <BarrasH
                itens={d.agingDoSaldoPositivo.map((a) => ({ rotulo: a.rotulo, valor: a.horas, texto: fmtHoras(a.horas), detalhe: `${fmtPessoas(a.colaboradores)}`, cor: a.rotulo.startsWith("Mais de 180") ? ("destructive" as const) : ("primary" as const) }))}
                formato={fmtHoras}
              />
              {vencido && vencido.horas > 0 && <Aviso tom="alerta">{fmtHoras(vencido.horas)} de saldo com mais de 180 dias.</Aviso>}
            </Painel>
            <Painel titulo="Por tipo de lançamento" descricao="Situações do ponto que compõem as extras e o banco.">
              <BarrasH itens={d.porSituacao.map((s) => ({ rotulo: s.rotulo, valor: s.horas, texto: fmtHoras(s.horas), detalhe: `${fmtInt(s.ocorrencias)} ocorrências` }))} formato={fmtHoras} />
            </Painel>
            <Painel titulo="Por centro de custo" descricao="Horas extras e peso sobre as trabalhadas.">
              <BarrasH itens={barrasGrupo(d.porCentroCusto)} limite={10} formato={fmtHoras} />
            </Painel>
            <Painel titulo="Por cargo">
              <BarrasH itens={barrasGrupo(d.porCargo)} limite={10} formato={fmtHoras} />
            </Painel>
            <Painel titulo="Por dia da semana">
              <BarrasH itens={d.porDiaDaSemana.map((x) => ({ rotulo: x.rotulo, valor: x.horas, texto: fmtHoras(x.horas) }))} formato={fmtHoras} />
            </Painel>
            {d.maioresSaldos && (
              <Painel titulo="Maiores saldos de banco" descricao="Lista nominal, só para o papel RH.">
                <Tabela
                  colunas={[
                    { titulo: "Colaborador", render: (l) => l.nome },
                    { titulo: "Saldo", render: (l) => fmtHoras(l.saldoHoras), alinhar: "dir" },
                  ]}
                  linhas={d.maioresSaldos}
                />
              </Painel>
            )}
          </GradeDePaineis>
        </>
      )}
    </PaginaRh>
  );
}
