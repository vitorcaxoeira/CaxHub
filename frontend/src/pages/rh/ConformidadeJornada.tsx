import { Aviso, GradeKpis, Kpi, PaginaRh, Painel, Tabela } from "../../components/rh/blocos";
import { BarrasH, Colunas, GradeDePaineis } from "../../components/rh/graficos";
import type { CorSerie } from "../../components/rh/graficos";
import { fmtHoras, fmtInt, fmtPct, fmtPessoas } from "../../components/rh/formato";
import { RespostaBase, useRh } from "../../components/rh/useRh";

type ChaveEvento = "jornadaAcimaDoLimite" | "intrajornada" | "heEm12x36" | "interjornada" | "escala12x36NaoRespeitada" | "dsrTrabalhado";

interface Jornada extends RespostaBase {
  kpis: {
    diasAnalisados: number;
    colaboradoresAnalisados: number;
    horasEfetivamenteTrabalhadas: number;
    totalDeOcorrencias: number;
    colaboradoresComOcorrencia: number;
    diasComMarcacaoImpar: number;
    colaboradoresEmEscala12x36: number;
  };
  porEvento: { tipo: number; chave: ChaveEvento; rotulo: string; ocorrencias: number; colaboradores: number; pctDosDias: number | null }[];
  evolucao: ({ mes: string; rotulo: string } & Record<ChaveEvento, number>)[];
  porCentroCusto: { rotulo: string; qtd: number; ocorrencias: number | null }[];
  ranking: ({ nome: string | null; total: number } & Record<ChaveEvento, number>)[] | null;
}

const CORES: Record<ChaveEvento, CorSerie> = {
  jornadaAcimaDoLimite: "destructive",
  intrajornada: "warning",
  heEm12x36: "muted",
  interjornada: "primary",
  escala12x36NaoRespeitada: "foreground",
  dsrTrabalhado: "success",
};

const ABREV: Record<ChaveEvento, string> = {
  jornadaAcimaDoLimite: "Jornada",
  intrajornada: "Intraj.",
  heEm12x36: "HE 12x36",
  interjornada: "Interj.",
  escala12x36NaoRespeitada: "12x36",
  dsrTrabalhado: "DSR",
};

export function ConformidadeJornada() {
  const { dados: d, carregando, erro } = useRh<Jornada>("jornada");
  const k = d?.kpis;
  const semEscala12x36 = k != null && k.colaboradoresEmEscala12x36 === 0;

  return (
    <PaginaRh
      titulo="Conformidade de Jornada"
      pergunta="Onde a jornada foge do que a CLT e a convenção esperam: excesso, intervalo, descanso entre jornadas e dias seguidos sem folga?"
      resposta={d}
      carregando={carregando}
      erro={erro}
    >
      {d && k && (
        <>
          <Aviso tom="info">
            Calculado dia a dia a partir das marcações do relógio de ponto. As marcações do dia são pareadas na ordem (entrada, saída, entrada…), porque a direção
            gravada pelo relógio não é confiável nesta base.
          </Aviso>

          <GradeKpis colunas={5}>
            <Kpi
              rotulo="Ocorrências"
              valor={fmtInt(k.totalDeOcorrencias)}
              tom={k.totalDeOcorrencias > 0 ? "atencao" : "bom"}
              sub={`em ${fmtInt(k.diasAnalisados)} dias com marcação`}
              ajuda="Soma dos eventos de conformidade (1 a 6) no período. Um mesmo dia pode ter mais de um evento."
            />
            <Kpi rotulo="Pessoas com ocorrência" valor={fmtInt(k.colaboradoresComOcorrencia)} sub={`de ${fmtInt(k.colaboradoresAnalisados)} analisadas`} />
            <Kpi rotulo="Horas efetivamente trabalhadas" valor={fmtHoras(k.horasEfetivamenteTrabalhadas)} ajuda="Soma dos intervalos entre as marcações pareadas (evento 7 da regra original)." />
            <Kpi rotulo="Dias com marcação ímpar" valor={fmtInt(k.diasComMarcacaoImpar)} tom={k.diasComMarcacaoImpar > 0 ? "atencao" : "bom"} sub="esqueceu de bater uma ponta" />
            <Kpi rotulo="Pessoas em escala 12x36" valor={fmtInt(k.colaboradoresEmEscala12x36)} sub={semEscala12x36 ? "eventos 3 e 5 não se aplicam" : undefined} />
          </GradeKpis>

          <Painel titulo="Ocorrências por evento" descricao="Quantos dias do período cada regra foi quebrada.">
            <BarrasH
              itens={d.porEvento.map((e) => ({
                rotulo: e.rotulo,
                valor: e.ocorrencias,
                texto: fmtInt(e.ocorrencias),
                detalhe: `${fmtPessoas(e.colaboradores)} · ${fmtPct(e.pctDosDias)} dos dias`,
                cor: CORES[e.chave],
              }))}
              maximo={Math.max(...d.porEvento.map((e) => e.ocorrencias), 1)}
            />
          </Painel>

          <Painel titulo="Evolução mensal" descricao="Ocorrências por mês e por evento.">
            <Colunas
              pontos={d.evolucao.map((e) => ({
                rotulo: e.rotulo,
                valores: d.porEvento.map((ev) => e[ev.chave]),
              }))}
              series={d.porEvento.map((ev) => ({ nome: ABREV[ev.chave], cor: CORES[ev.chave] }))}
              empilhado
              vazio="Nenhuma ocorrência no período."
            />
          </Painel>

          <GradeDePaineis>
            <Painel titulo="Por centro de custo" descricao="Ocorrências e pessoas envolvidas.">
              <BarrasH itens={d.porCentroCusto.map((c) => ({ rotulo: c.rotulo, valor: c.ocorrencias ?? c.qtd, texto: c.ocorrencias == null ? `${fmtPessoas(c.qtd)}` : fmtInt(c.ocorrencias), detalhe: `${fmtPessoas(c.qtd)}` }))} limite={10} />
            </Painel>
            {d.ranking ? (
              <Painel titulo="Quem mais acumulou ocorrências" descricao="Lista nominal, só para o papel RH.">
                <Tabela
                  colunas={[
                    { titulo: "Colaborador", render: (l) => l.nome },
                    ...(["jornadaAcimaDoLimite", "intrajornada", "interjornada", "dsrTrabalhado"] as ChaveEvento[]).map((c) => ({ titulo: ABREV[c], render: (l: NonNullable<Jornada["ranking"]>[number]) => fmtInt(l[c]), alinhar: "dir" as const })),
                    { titulo: "Total", render: (l: NonNullable<Jornada["ranking"]>[number]) => <strong>{fmtInt(l.total)}</strong>, alinhar: "dir" as const },
                  ]}
                  linhas={d.ranking}
                  vazio="Nenhuma ocorrência no período."
                />
              </Painel>
            ) : (
              <Aviso tom="info">O ranking nominal fica com o papel RH.</Aviso>
            )}
          </GradeDePaineis>

          <Painel titulo="Regras aplicadas" descricao="Os 7 eventos da regra LSP do BI antigo, recalculados sem depender de tabela de usuário.">
            <ol className="list-decimal space-y-1.5 pl-5 text-[12.5px] text-foreground/80">
              <li><strong>Jornada acima do limite:</strong> mais de 10h trabalhadas no dia ou mais de 2h extras.</li>
              <li><strong>Intrajornada:</strong> mais de 6h trabalhadas com o maior intervalo do dia abaixo de 1h (ou sem intervalo). Soma os dias que o próprio Senior já aponta.</li>
              <li><strong>Hora extra em escala 12x36:</strong> dia em escala 12x36 com horas extras. {semEscala12x36 ? "Nenhum colaborador está em 12x36 nesta base." : ""}</li>
              <li><strong>Interjornada:</strong> menos de 11h entre o último registro de um dia e o primeiro do seguinte. Soma os dias que o Senior já aponta.</li>
              <li><strong>Escala 12x36 não respeitada:</strong> dia trabalhado em escala 12x36 logo depois de outro dia trabalhado.</li>
              <li><strong>DSR trabalhado:</strong> 7º dia seguido (ou mais) com marcação, sem folga.</li>
              <li><strong>Horas efetivamente trabalhadas:</strong> não é infração; é o total que aparece no cartão.</li>
            </ol>
          </Painel>
        </>
      )}
    </PaginaRh>
  );
}
