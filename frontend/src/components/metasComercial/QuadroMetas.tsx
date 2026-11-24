import { BarraAtingimento, tomDoAtingimento } from "./comum";
import { Acumulacao, Consolidado, Painel, Unidade, colunasQuadro, desafioGeral, fmtPct, fmtValor, rotuloOrigem } from "../../lib/metasComercial";

/** "empresa" ou o id do participante. */
export type VisaoQuadro = "empresa" | number;

export interface LinhaQuadroDados {
  indicadorId: number;
  rotulo: string;
  unidade: Unidade;
  acumulacao: Acumulacao;
  origem: string;
  semMeta: boolean;
  consolidado: Consolidado;
}

interface Props {
  painel: Painel;
  visao: VisaoQuadro;
  onVisao: (v: VisaoQuadro) => void;
  /** Indicador da linha selecionada (abre o mês a mês embaixo). */
  foco: number | null;
  onFoco: (indicadorId: number) => void;
}

const TH = "whitespace-nowrap bg-surface-2 px-3 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted";
const TD = "whitespace-nowrap px-3 py-2.5 tabular-nums";

/** Linhas do quadro na visão escolhida: indicadores da empresa, ou os da pessoa (com o rótulo dela). */
export function linhasDoQuadro(painel: Painel, visao: VisaoQuadro): { linhas: LinhaQuadroDados[]; geral: number | null } {
  if (visao === "empresa") {
    return {
      geral: painel.atingimentoGeral,
      linhas: painel.indicadores.map((i) => ({
        indicadorId: i.indicadorId,
        rotulo: i.nome,
        unidade: i.unidade,
        acumulacao: i.acumulacao,
        origem: i.origem,
        semMeta: i.metaAnual == null && i.consolidado.meta === 0,
        consolidado: i.consolidado,
      })),
    };
  }
  const p = painel.pessoas.find((x) => x.participanteId === visao);
  if (!p) return { linhas: [], geral: null };
  const origemDe = (id: number) => painel.indicadores.find((i) => i.indicadorId === id)?.origem ?? "MANUAL";
  return {
    geral: p.atingimentoGeral,
    linhas: p.indicadores.map((i) => ({
      indicadorId: i.indicadorId,
      rotulo: i.rotulo,
      unidade: i.unidade,
      acumulacao: i.acumulacao,
      origem: origemDe(i.indicadorId),
      semMeta: i.consolidado.meta === 0,
      consolidado: i.consolidado,
    })),
  };
}

// Quadro de metas no formato da planilha da gerente comercial (Meta · Realizado · % · Falta · % que falta, com REALIZADO GERAL e
// DESAFIO GERAL em destaque), na linguagem visual do CaxHub: cabeçalho mono sobre surface-2 e barra por linha (como Transferências
// do CaxHub_Dash). Clicar numa linha seleciona o indicador para o mês a mês logo abaixo.
export function QuadroMetas({ painel, visao, onVisao, foco, onFoco }: Props) {
  const { linhas, geral } = linhasDoQuadro(painel, visao);
  const comMeta = linhas.filter((l) => l.consolidado.atingimento != null).length;
  const desafio = desafioGeral(geral);
  const pessoas = painel.pessoas.filter((p) => p.indicadores.length > 0);
  const opcoes: Array<{ valor: VisaoQuadro; rotulo: string }> = [
    { valor: "empresa", rotulo: "Empresa" },
    ...pessoas.map((p) => ({ valor: p.participanteId as VisaoQuadro, rotulo: p.naoAtribuido ? "Não atribuído" : p.nome.split(" ")[0] })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Visão do quadro">
        <span className="mr-1 text-[12.5px] text-muted">Visão</span>
        {opcoes.map((o) => {
          const ativa = o.valor === visao;
          return (
            <button
              key={String(o.valor)}
              type="button"
              onClick={() => onVisao(o.valor)}
              aria-pressed={ativa}
              title={o.valor === "empresa" ? "Indicadores da empresa" : pessoas.find((p) => p.participanteId === o.valor)?.nome}
              className={`rounded-md border px-3 py-1 text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                ativa ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              {o.rotulo}
            </button>
          );
        })}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 min-[1400px]:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="grid grid-cols-2 gap-3 min-[1400px]:order-2 min-[1400px]:grid-cols-1">
          <div className="flex flex-col justify-center rounded-lg border border-border bg-surface p-4 text-center">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Realizado geral</span>
            <span className="mt-1 font-display text-4xl font-bold tabular-nums text-warning sm:max-[1399px]:text-5xl">{fmtPct(geral, 2)}</span>
            <span className="mt-1 text-[11.5px] text-muted">média de {comMeta} indicador{comMeta === 1 ? "" : "es"} com meta</span>
          </div>
          <div className="flex flex-col justify-center rounded-lg border border-border bg-surface p-4 text-center">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Desafio geral</span>
            <span className="mt-1 font-display text-4xl font-bold tabular-nums text-destructive sm:max-[1399px]:text-5xl">{fmtPct(desafio, 2)}</span>
            <span className="mt-1 text-[11.5px] text-muted">quanto falta, em média</span>
          </div>
        </div>

        <div className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-surface min-[1400px]:order-1">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className={TH}>Indicador</th>
                  <th className={`${TH} text-right`}>Meta</th>
                  <th className={`${TH} text-right`}>Realizado</th>
                  <th className={`${TH} text-right`}>%</th>
                  <th className={`${TH} w-20`}><span className="sr-only">Progresso</span></th>
                  <th className={`${TH} text-right`}>Falta</th>
                  <th className={`${TH} text-right`}>% que falta</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const c = l.consolidado;
                  const q = colunasQuadro(c);
                  const selecionada = foco === l.indicadorId;
                  return (
                    <tr
                      key={l.indicadorId}
                      onClick={() => onFoco(l.indicadorId)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onFoco(l.indicadorId))}
                      tabIndex={0}
                      aria-selected={selecionada}
                      title={`${rotuloOrigem(l.origem)} · clique para ver o mês a mês`}
                      className={`cursor-pointer border-t border-border/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        selecionada ? "bg-primary/10" : "hover:bg-surface-2"
                      }`}
                    >
                      <td className={`${TD} font-medium text-foreground`}>
                        {selecionada && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary align-middle" aria-hidden />}
                        {l.rotulo}
                      </td>
                      <td className={`${TD} text-right text-muted`}>{l.semMeta ? "—" : fmtValor(l.unidade, c.meta)}</td>
                      <td className={`${TD} text-right font-semibold text-foreground`}>{fmtValor(l.unidade, c.realizado)}</td>
                      <td className={`${TD} text-right ${tomDoAtingimento(c.atingimento)}`}>{fmtPct(c.atingimento, 2)}</td>
                      <td className="px-3 py-2.5"><BarraAtingimento valor={c.atingimento} className="w-20" /></td>
                      <td className={`${TD} text-right`}>
                        {q.superou != null ? (
                          <span className="text-success">superou {fmtValor(l.unidade, q.superou)}</span>
                        ) : (
                          <span className="text-foreground">{fmtValor(l.unidade, q.falta)}</span>
                        )}
                      </td>
                      <td className={`${TD} text-right ${q.pctFalta != null && q.pctFalta > 0 ? "text-destructive" : "text-muted"}`}>{fmtPct(q.pctFalta, 2)}</td>
                    </tr>
                  );
                })}
                {linhas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted">Nenhum indicador nesta visão.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
