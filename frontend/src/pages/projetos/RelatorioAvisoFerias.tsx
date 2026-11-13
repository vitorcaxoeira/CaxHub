import axios from "axios";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { OrientacaoRelatorio, RelatorioShell, TemaRelatorio, usePreferencia } from "../../components/relatorio/relatorioComum";
import { Spinner } from "../../components/ui/Spinner";
import { cn } from "../../lib/cn";
import { MESES, dataBr, moeda } from "../../lib/feriasCalendario";

const CHAVE_TEMA = "caxhub-aviso-ferias-tema";
const CHAVE_ORIENTACAO = "caxhub-aviso-ferias-orientacao";

export interface AvisoFerias {
  /** Férias remuneradas (com demonstrativo do valor) ou só marcadas no calendário (sem valor). */
  remunerado?: boolean;
  emitidoEm: string;
  emitidoPor: string | null;
  empresa: { codemp: number; nome: string | null };
  consultor: { codemp: number; codfor: number; nome: string; departamento: string | null };
  aquisitivo: { inicio: string; fim: string; diasDireito: number; saldoDepois: number } | null;
  gozo: { id: number; situacao: string; inicio: string; fim: string; diasCorridos: number; retorno: string; observacao: string | null; competenciaPagamento: string | null };
  calculo: {
    diasUteis: number | null;
    horasDia: number | null;
    mediaPct: number | null;
    valorHora: number | null;
    horasFerias: number | null;
    valorFerias: number | null;
    calculadoEm: string | null;
    meses: { ano: number; mes: number; minutos: number; pct: number }[];
    mesesReconstituidos: boolean;
  };
}

const num = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
const pct = (v: number) => `${num(v * 100, 2)}%`;
const horasDecimal = (minutos: number) => `${num(minutos / 60, 2)} h`;

// Aviso de férias do consultor (13/11/2026): documento imprimível aberto pelo botão "Aviso" da tela Férias, ao lado de "Editar". Traz as datas do gozo, o retorno ao
// trabalho, o DEMONSTRATIVO do cálculo do valor (dias úteis × horas/dia × média do % trabalhado × valor-hora) com os meses da média, o pagamento e o saldo que sobra, e
// o espaço das assinaturas. Página própria fora do AppShell (só a folha vai ao papel); tema e orientação na barra, "Imprimir" também salva em PDF.
export function RelatorioAvisoFerias() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [tema, escolherTema] = usePreferencia<TemaRelatorio>(CHAVE_TEMA, ["claro", "escuro"], "claro", params.get("tema"));
  const [orientacao, escolherOrientacao] = usePreferencia<OrientacaoRelatorio>(CHAVE_ORIENTACAO, ["retrato", "paisagem"], "retrato", params.get("orientacao"));
  const [dados, setDados] = useState<AvisoFerias | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    axios
      .get<AvisoFerias>(`/api/ferias/gozos/${id}/aviso`)
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Não foi possível carregar o aviso de férias.") : "Não foi possível carregar o aviso de férias."));
    return () => {
      cancelado = true;
    };
  }, [id]);

  return (
    <RelatorioShell titulo="Aviso de férias" tema={tema} onTema={escolherTema} orientacao={orientacao} onOrientacao={escolherOrientacao} podeImprimir={!!dados} larguraMax="max-w-3xl">
      {!dados && !erro && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted">
          <Spinner /> Carregando o aviso de férias…
        </div>
      )}
      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{erro}</p>}
      {dados && <Folha d={dados} />}
    </RelatorioShell>
  );
}

export function Folha({ d }: { d: AvisoFerias }) {
  const c = d.calculo;
  const cancelado = d.gozo.situacao === "cancelada";
  const pagamento = d.gozo.competenciaPagamento ? `${MESES[Number(d.gozo.competenciaPagamento.slice(5, 7)) - 1]}/${d.gozo.competenciaPagamento.slice(0, 4)}` : null;
  const valorCompleto = c.diasUteis != null && c.horasDia != null && c.mediaPct != null;
  const remunerado = d.remunerado !== false;
  return (
    <article className="rounded-lg border border-border bg-surface p-8 text-[13px] leading-relaxed text-foreground print:rounded-none print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="font-display text-lg font-bold">{d.empresa.nome ?? `Empresa ${d.empresa.codemp}`}</p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Aviso de férias</p>
        </div>
        <p className="text-right text-[12px] text-muted">
          Emitido em {dataBr(d.emitidoEm)}
          {d.emitidoPor && (
            <>
              <br />
              por {d.emitidoPor}
            </>
          )}
        </p>
      </header>

      {cancelado && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-center font-semibold uppercase tracking-wide text-destructive">Férias canceladas: este aviso não vale mais</p>}

      <section className="mt-5">
        <p className="text-[15px]">
          Comunicamos que o consultor <strong>{d.consultor.nome}</strong>
          {d.consultor.departamento && <span className="text-muted"> ({d.consultor.departamento})</span>} gozará férias no período abaixo.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 print:grid-cols-2">
          <Item rotulo="Período de gozo" valor={`${dataBr(d.gozo.inicio)} a ${dataBr(d.gozo.fim)}`} destaque />
          <Item rotulo="Dias corridos" valor={String(d.gozo.diasCorridos)} />
          <Item rotulo="Retorno ao trabalho" valor={dataBr(d.gozo.retorno)} destaque />
          {remunerado ? (
            <Item rotulo="Pagamento" valor={pagamento ? `Na nota referente ao mês ${pagamento}` : "Mês de pagamento não informado"} />
          ) : (
            <Item rotulo="Remuneração" valor="Férias não remuneradas" />
          )}
          {d.aquisitivo && <Item rotulo="Período aquisitivo" valor={`${dataBr(d.aquisitivo.inicio)} a ${dataBr(d.aquisitivo.fim)}`} />}
          {d.aquisitivo && <Item rotulo="Direito no período" valor={`${d.aquisitivo.diasDireito} dias corridos`} />}
        </dl>
      </section>

      {!remunerado && (
        <section className="mt-6 rounded-md border border-border px-4 py-3">
          <p className="font-semibold">Férias não remuneradas</p>
          <p className="mt-1 text-muted">Conforme o contrato do consultor, este período de férias não é remunerado: não há valor a pagar. O período de gozo equivale a {c.diasUteis ?? "—"} dia(s) útil(eis).</p>
        </section>
      )}

      {remunerado && (
      <section className="mt-6">
        <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Demonstrativo do cálculo</h2>
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            <Linha rotulo="Dias úteis do período de gozo" detalhe="segunda a sexta, sem feriados nacionais" valor={c.diasUteis != null ? String(c.diasUteis) : "—"} />
            <Linha rotulo="Horas por dia útil" valor={c.horasDia != null ? `${num(c.horasDia)} h` : "—"} />
            <Linha rotulo="Média do % trabalhado" detalhe="média simples dos meses abaixo" valor={c.mediaPct != null ? pct(c.mediaPct) : "—"} />
            <Linha
              rotulo="Horas de férias"
              detalhe={valorCompleto ? `${c.diasUteis} × ${num(c.horasDia as number)} h × ${pct(c.mediaPct as number)}` : undefined}
              valor={c.horasFerias != null ? `${num(c.horasFerias)} h` : "—"}
            />
            <Linha rotulo="Valor-hora" valor={c.valorHora != null ? moeda(c.valorHora) : "—"} />
            <Linha rotulo="Valor das férias" detalhe={c.horasFerias != null && c.valorHora != null ? `${num(c.horasFerias)} h × ${moeda(c.valorHora)}` : undefined} valor={c.valorFerias != null ? moeda(c.valorFerias) : "—"} total />
          </tbody>
        </table>

        {c.meses.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-[12px] text-muted">Meses considerados na média do % trabalhado (horas apontadas ÷ horas do mês):</p>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                  <th className="py-1 pr-3">Mês</th>
                  <th className="py-1 pr-3 text-right">Horas trabalhadas</th>
                  <th className="py-1 text-right">% trabalhado</th>
                </tr>
              </thead>
              <tbody>
                {c.meses.map((m) => (
                  <tr key={`${m.ano}-${m.mes}`} className="border-b border-border/50">
                    <td className="py-1 pr-3 font-mono">
                      {String(m.mes).padStart(2, "0")}/{m.ano}
                    </td>
                    <td className="py-1 pr-3 text-right font-mono">{horasDecimal(m.minutos)}</td>
                    <td className="py-1 text-right font-mono">{pct(m.pct)}</td>
                  </tr>
                ))}
                {c.mediaPct != null && (
                  <tr className="font-semibold">
                    <td className="py-1 pr-3" colSpan={2}>
                      Média
                    </td>
                    <td className="py-1 text-right font-mono">{pct(c.mediaPct)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {c.mesesReconstituidos && <p className="mt-1 text-[11px] text-muted">Tabela refeita com as horas de hoje; a média acima é a gravada no lançamento das férias.</p>}
          </div>
        )}
        {c.meses.length === 0 && <p className="mt-3 text-[12px] text-muted">Sem histórico de horas nos meses anteriores: média considerada de 100%.</p>}
      </section>
      )}

      {d.aquisitivo && (
        <p className="mt-5 text-[12.5px]">
          Saldo do período aquisitivo após estas férias: <strong>{d.aquisitivo.saldoDepois} dia(s)</strong>.
        </p>
      )}
      {d.gozo.observacao && (
        <p className="mt-2 text-[12.5px]">
          <span className="text-muted">Observação:</span> {d.gozo.observacao}
        </p>
      )}

      <footer className="mt-12 grid grid-cols-2 gap-10 text-center text-[12px]">
        <div>
          <div className="border-t border-foreground pt-1">Gestor / Administração</div>
        </div>
        <div>
          <div className="border-t border-foreground pt-1">{d.consultor.nome}</div>
        </div>
      </footer>
      <p className="mt-8 text-center text-[10.5px] text-muted">
        Demonstrativo gerado pelo CaxHub{c.calculadoEm ? `; cálculo gravado em ${dataBr(c.calculadoEm.slice(0, 10))}` : ""}.
      </p>
    </article>
  );
}

function Item({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1">
      <dt className="text-muted">{rotulo}</dt>
      <dd className={cn("text-right", destaque && "font-semibold")}>{valor}</dd>
    </div>
  );
}

function Linha({ rotulo, detalhe, valor, total }: { rotulo: string; detalhe?: string; valor: string; total?: boolean }) {
  return (
    <tr className={cn("border-b border-border/50", total && "border-t-2 border-t-foreground font-bold")}>
      <td className="py-1.5 pr-3">
        {rotulo}
        {detalhe && <span className="block text-[11px] font-normal text-muted">{detalhe}</span>}
      </td>
      <td className={cn("py-1.5 text-right font-mono", total && "text-[15px]")}>{valor}</td>
    </tr>
  );
}
