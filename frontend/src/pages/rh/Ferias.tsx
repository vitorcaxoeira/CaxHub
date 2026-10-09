import { Aviso, GradeKpis, Kpi, PaginaRh, Painel, Tabela } from "../../components/rh/blocos";
import { BarrasH, Colunas, GradeDePaineis } from "../../components/rh/graficos";
import { fmtData, fmtDec, fmtInt, fmtMoeda, fmtPessoas } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

interface Ferias extends RespostaBase {
  referencia: string;
  kpis: {
    colaboradoresComFeriasVencidas: number;
    diasVencidos: number;
    periodosVencidos: number;
    aVencerEm60Dias: number;
    aVencerEm120Dias: number;
    saldoTotalDeDias: number;
    colaboradoresComSaldo: number;
    gozandoFerias: number;
    passivoEstimadoDaDobra: number | null;
  };
  faixas: { rotulo: string; colaboradores: number; periodos: number; dias: number }[];
  vencidasPorCentroCusto: { rotulo: string; qtd: number; dias: number | null }[];
  programadas: { rotulo: string; colaboradores: number; dias: number }[];
  lista: { nome: string | null; periodosVencidos: number; diasVencidos: number; limiteMaisAntigo: string; passivoEstimado: number }[] | null;
}

export function Ferias() {
  const { dados: d, carregando, erro } = useRh<Ferias>("ferias");
  const k = d?.kpis;

  return (
    <PaginaRh
      titulo="Férias"
      pergunta="Quem está com férias vencidas (risco de pagar em dobro), quem vence em breve e como a programação dos próximos meses está distribuída?"
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && k && (
        <>
          {k.colaboradoresComFeriasVencidas === 0 ? (
            <Aviso tom="info">Nenhum colaborador com férias vencidas na data de referência ({fmtData(d.referencia)}).</Aviso>
          ) : (
            <Aviso tom="alerta">
              {fmtInt(k.colaboradoresComFeriasVencidas)} colaborador(es) com {fmtDec(k.diasVencidos)} dias de férias vencidos: o limite de concessão já passou e a lei prevê pagamento em dobro.
            </Aviso>
          )}

          <GradeKpis colunas={5}>
            <Kpi
              rotulo="Com férias vencidas"
              valor={fmtInt(k.colaboradoresComFeriasVencidas)}
              tom={k.colaboradoresComFeriasVencidas > 0 ? "ruim" : "bom"}
              sub={`${fmtDec(k.diasVencidos)} dias em ${fmtInt(k.periodosVencidos)} períodos`}
              ajuda="Período aquisitivo completo, com saldo de dias, cujo limite de concessão já passou (CLT art. 137): risco de pagamento em dobro."
            />
            <Kpi rotulo="Vencem em até 60 dias" valor={fmtInt(k.aVencerEm60Dias)} tom={k.aVencerEm60Dias > 0 ? "atencao" : "neutro"} sub="programar já" />
            <Kpi rotulo="Vencem em até 120 dias" valor={fmtInt(k.aVencerEm120Dias)} sub="inclui os de 60 dias" />
            <Kpi rotulo="Saldo total de dias" valor={fmtDec(k.saldoTotalDeDias)} sub={`${fmtPessoas(k.colaboradoresComSaldo)} com saldo`} />
            <Kpi
              rotulo="Passivo estimado da dobra"
              valor={fmtMoeda(k.passivoEstimadoDaDobra)}
              restrito={k.passivoEstimadoDaDobra == null}
              sub="só o papel RH vê o valor"
              ajuda="Dias vencidos × salário diário × 4/3. Estimativa para priorizar; não é provisão contábil."
            />
          </GradeKpis>

          <GradeDePaineis>
            <Painel titulo="Situação dos períodos em aberto" descricao="Onde estão os dias de férias ainda não gozados." ajuda="Em aquisição: o período ainda não completou. No prazo: completo, com mais de 120 dias até o limite. A vencer: entre 0 e 120 dias do limite de concessão. Vencidas: o limite passou.">
              <BarrasH
                itens={d.faixas.map((f) => ({
                  rotulo: f.rotulo,
                  valor: f.dias,
                  texto: `${fmtDec(f.dias)} dias`,
                  detalhe: `${fmtPessoas(f.colaboradores)} · ${fmtInt(f.periodos)} períodos`,
                  cor: f.rotulo.startsWith("Vencidas") ? ("destructive" as const) : f.rotulo.startsWith("A vencer") ? ("warning" as const) : ("primary" as const),
                }))}
                formato={(v) => `${fmtDec(v)} dias`}
              />
            </Painel>
            <Painel titulo="Programação dos próximos meses" descricao={`Férias já marcadas a partir de ${fmtData(d.referencia)}. Gozando agora: ${fmtInt(k.gozandoFerias)}.`}>
              <Colunas
                pontos={d.programadas.map((p) => ({ rotulo: p.rotulo, valores: [p.colaboradores, p.dias] }))}
                series={[
                  { nome: "Pessoas", cor: "primary" },
                  { nome: "Dias", cor: "warning", tipo: "linha", eixoDireito: true },
                ]}
                formatoDireito={(v) => `${fmtDec(v, 0)}`}
                vazio="Nenhuma férias programada para os próximos meses."
              />
            </Painel>
          </GradeDePaineis>

          <GradeDePaineis>
            <Painel titulo="Vencidas por centro de custo">
              <BarrasH itens={d.vencidasPorCentroCusto.map((c) => ({ rotulo: c.rotulo, valor: c.dias ?? c.qtd, texto: c.dias == null ? `${fmtPessoas(c.qtd)}` : `${fmtDec(c.dias)} dias`, detalhe: `${fmtPessoas(c.qtd)}` }))} vazio="Nenhuma férias vencida." />
            </Painel>
            {d.lista && (
              <Painel titulo="Quem está com férias vencidas" descricao="Lista nominal, só para o papel RH.">
                <Tabela
                  colunas={[
                    { titulo: "Colaborador", render: (l) => l.nome },
                    { titulo: "Períodos", render: (l) => fmtInt(l.periodosVencidos), alinhar: "dir" },
                    { titulo: "Dias", render: (l) => fmtDec(l.diasVencidos), alinhar: "dir" },
                    { titulo: "Venceu em", render: (l) => fmtData(l.limiteMaisAntigo), alinhar: "dir" },
                    { titulo: "Passivo estimado", render: (l) => fmtMoeda(l.passivoEstimado), alinhar: "dir" },
                  ]}
                  linhas={d.lista}
                  vazio="Nenhuma férias vencida."
                />
              </Painel>
            )}
          </GradeDePaineis>
        </>
      )}
    </PaginaRh>
  );
}
