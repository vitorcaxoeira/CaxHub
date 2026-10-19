import { BarraAtingimento, Cartao, GraficoAcumulado, tomDoAtingimento } from "./comum";
import { Acumulacao, CelulaMes, Consolidado, MESES_LONGOS, Painel, Unidade, fmtPct, fmtResumo, fmtValor, quandoFoto } from "../../lib/metasComercial";

/** O que o "Mês a mês" precisa de um indicador (o da empresa, ou o de uma pessoa adaptado). */
export interface IndicadorMesAMes {
  nome: string;
  unidade: Unidade;
  acumulacao: Acumulacao;
  origem: string;
  metaAnual: number | null;
  metaDasPessoas: number | null;
  consolidado: Consolidado;
  mensal: CelulaMes[];
  serie: Array<{ mes: number; meta: number; realizado: number | null }>;
}

interface Props {
  painel: Painel & { ultimaFotoCarteira?: string | null; fontesCarteira?: Array<"FOTO" | "RECONSTRUIDA" | null> };
  indicador: IndicadorMesAMes;
  /** Título no lugar de "Mês a mês — <indicador>" (ex.: com o nome da pessoa). */
  titulo?: string;
  /** Links de notas (Faturamento) e pedidos (Licenças) no valor do mês. Desligado na visão por pessoa: a lista é da empresa. */
  comLinks?: boolean;
  onNotas: (mes: number) => void;
  onPedidos: (mes: number) => void;
}

// "Mês a mês — <indicador>" do painel de metas: tabela meta × realizado por mês e o gráfico acumulado. Usado pelas duas abas
// (Quadro de metas e Indicadores), com o mesmo visual.
export function MesAMes({ painel, indicador, titulo, comLinks = true, onNotas, onPedidos }: Props) {
  const nota =
    indicador.origem === "PEDIDOS_SENIOR"
      ? "Pedidos de venda pela data de emissão, itens com rateio na conta financeira 177 (valor = preço unitário × quantidade, cancelados fora); cada pessoa recebe os do seu representante e o resto vai para Não atribuído. Clique no valor do mês para ver os pedidos"
      : indicador.origem === "PROPOSTAS_SENIOR"
        ? "Horas das propostas aprovadas (situação 4, 7 ou 8) pelo mês de retorno, itens com faturamento normal ou antecipado; cada pessoa recebe as do seu representante do Senior e o resto vai para Não atribuído"
        : indicador.metaDasPessoas != null && indicador.metaAnual != null
          ? `Soma das metas individuais no período: ${fmtResumo(indicador.unidade, indicador.metaDasPessoas)} (meta da empresa: ${fmtResumo(indicador.unidade, indicador.consolidado.meta)})`
          : indicador.origem === "CARTEIRA_SENIOR"
            ? `Carteira de contratos do Senior (RVTR101, motivo 500), foto de ${quandoFoto(painel.ultimaFotoCarteira)}: cada mês guarda a última foto; os meses marcados "reconstruída" foram recalculados com o histórico de reajustes e upgrades (aproximação)`
            : indicador.acumulacao === "SALDO"
              ? "Posição da carteira: a meta é a posição-alvo e vale o último mês lançado"
              : undefined;
  const linkavel = comLinks && (indicador.origem === "FATURAMENTO_SENIOR" || indicador.origem === "PEDIDOS_SENIOR");

  return (
    <Cartao titulo={titulo ?? `Mês a mês — ${indicador.nome}`} nota={nota}>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="relative min-w-0 overflow-x-auto">
          <table className="w-full min-w-[440px] whitespace-nowrap text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="py-1.5 pr-3 font-medium">Mês</th>
                <th className="px-3 py-1.5 text-right font-medium">Meta</th>
                <th className="px-3 py-1.5 text-right font-medium">Realizado</th>
                <th className="px-3 py-1.5 text-right font-medium">%</th>
                <th className="w-24 py-1.5 pl-3 font-medium"><span className="sr-only">Progresso</span></th>
              </tr>
            </thead>
            <tbody>
              {indicador.mensal.map((m) => (
                <tr key={m.mes} className={`border-b border-border/60 ${painel.meses.includes(m.mes) ? "" : "text-muted"}`}>
                  <td className="py-1.5 pr-3">{MESES_LONGOS[m.mes - 1].slice(0, 3)}</td>
                  <td className="px-3 py-1.5 text-right">{fmtValor(indicador.unidade, m.meta)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {indicador.origem === "CARTEIRA_SENIOR" && painel.fontesCarteira?.[m.mes - 1] === "RECONSTRUIDA" && (
                      <span
                        className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] text-muted"
                        title="Mês anterior à primeira foto: carteira recalculada com o histórico de reajustes e upgrades do Senior (aproximação)"
                      >
                        reconstruída
                      </span>
                    )}
                    {linkavel && m.realizado != null ? (
                      <button
                        type="button"
                        onClick={() => (indicador.origem === "PEDIDOS_SENIOR" ? onPedidos(m.mes) : onNotas(m.mes))}
                        title={indicador.origem === "PEDIDOS_SENIOR" ? "Ver os pedidos de venda deste mês" : "Ver as notas faturadas deste mês"}
                        className="rounded tabular-nums text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {fmtValor(indicador.unidade, m.realizado)}
                      </button>
                    ) : (
                      fmtValor(indicador.unidade, m.realizado)
                    )}
                  </td>
                  <td className={`px-3 py-1.5 text-right ${tomDoAtingimento(m.atingimento)}`}>{fmtPct(m.atingimento, 0)}</td>
                  <td className="py-1.5 pl-3"><BarraAtingimento valor={m.atingimento} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <GraficoAcumulado
          pontos={indicador.serie}
          unidade={indicador.unidade}
          titulo={`${indicador.nome}: meta e realizado ao longo do ano`}
          legenda={indicador.acumulacao === "SALDO" ? ["Meta (posição-alvo)", "Realizado no mês"] : ["Meta acumulada", "Realizado acumulado"]}
        />
      </div>
    </Cartao>
  );
}
