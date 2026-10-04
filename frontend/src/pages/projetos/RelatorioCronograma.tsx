import axios from "axios";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CabecalhoGantt, LEGENDA_GANTT, LinhaGantt } from "../../components/cronograma/GanttImpressao";
import { KpisCronograma } from "../../components/cronograma/KpisCronograma";
import { IconeStatusAtividade } from "../../components/cronograma/LinhaNo";
import {
  OrientacaoRelatorio,
  RelatorioShell,
  Segmentado,
  TemaRelatorio,
  baixarPdfDoServidor,
  usePreferencia,
} from "../../components/relatorio/relatorioComum";
import { Spinner } from "../../components/ui/Spinner";
import { NoCronogramaCompleto, PropostaCronograma, montarNosCronograma } from "../../hooks/useCronograma";
import {
  achatarArvore,
  agregarHoras,
  agregarOrcado,
  derivarStatus,
  formatHorasCompacto,
  formatarDataBr,
  formatarDataCurta,
  larguraHorasProposta,
  periodosEfetivos,
  somarOrcamentos,
} from "../../lib/cronograma";
import { EscalaPedida, montarEscalaGantt } from "../../lib/gantt";

// Relatório impresso do Cronograma de uma proposta (botão "Imprimir" da tela do Cronograma). Mesmo
// modelo do relatório do 5S: página própria fora do AppShell, aberta em aba nova, tema e orientação
// escolhidos na barra, "Imprimir" e "Baixar PDF" (Chromium do servidor). Três conteúdos: tabela,
// Gantt, ou os dois lado a lado. Busca os dados sozinho — não depende do estado da tela de origem.

export type ConteudoRelatorio = "tabela" | "gantt" | "ambos";
export type NivelRelatorio = "resumido" | "detalhado";

const CHAVE = "caxhub-cronograma-relatorio";
const ROTULOS_CONTEUDO: Record<ConteudoRelatorio, string> = { tabela: "Tabela", gantt: "Gantt", ambos: "Tabela + Gantt" };
const ROTULOS_ESCALA: Record<EscalaPedida, string> = { auto: "Auto", semana: "Semana", mes: "Mês" };
const dataHoraFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function hojeLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DadosCronograma {
  proposta: PropostaCronograma;
  nos: NoCronogramaCompleto[];
}

export function RelatorioCronograma() {
  const { codemp, codpro } = useParams<{ codemp: string; codpro: string }>();
  const [params] = useSearchParams();
  const [conteudo, escolherConteudo] = usePreferencia<ConteudoRelatorio>(`${CHAVE}-conteudo`, ["tabela", "gantt", "ambos"], "ambos", params.get("conteudo"));
  const [nivel, escolherNivel] = usePreferencia<NivelRelatorio>(`${CHAVE}-nivel`, ["resumido", "detalhado"], "detalhado", params.get("nivel"));
  const [escalaPedida, escolherEscala] = usePreferencia<EscalaPedida>(`${CHAVE}-escala`, ["auto", "semana", "mes"], "auto", params.get("escala"));
  const [tema, escolherTema] = usePreferencia<TemaRelatorio>(`${CHAVE}-tema`, ["claro", "escuro"], "claro", params.get("tema"));
  // Cronograma é largo (tabela + barras): paisagem é o padrão.
  const [orientacao, escolherOrientacao] = usePreferencia<OrientacaoRelatorio>(`${CHAVE}-orientacao`, ["retrato", "paisagem"], "paisagem", params.get("orientacao"));

  const [dados, setDados] = useState<DadosCronograma | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [emitidoEm] = useState(() => dataHoraFormatter.format(new Date()));
  const hoje = useMemo(() => hojeLocalIso(), []);
  const [baixando, setBaixando] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get(`/api/alocacao/propostas/${codemp}/${codpro}/cronograma`)
      .then(({ data }) => setDados({ proposta: data.proposta, nos: montarNosCronograma(data) }))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar o cronograma"))
      .finally(() => setLoading(false));
  }, [codemp, codpro]);

  useEffect(() => {
    if (dados) document.title = `Cronograma ${codpro} — ${dados.proposta.cliente}`;
  }, [dados, codpro]);

  // Sinal pro Chromium do servidor (PDF): só gera depois de "pronto" e desiste com "erro". Aqui não há
  // fotos nem busca em etapas — pronto é "dados carregados".
  useEffect(() => {
    const w = window as unknown as { __relatorioPronto?: boolean; __relatorioErro?: string };
    if (erro) w.__relatorioErro = erro;
    else w.__relatorioPronto = !loading && !!dados;
  }, [erro, loading, dados]);

  const calc = useMemo(() => {
    if (!dados) return null;
    const { nos } = dados;
    const agregados = agregarHoras(nos);
    const totais = somarOrcamentos(
      nos.filter((n) => n.tipo === "item"),
      agregados
    );
    const linhasTodas = achatarArvore(nos);
    return {
      agregados,
      orcado: agregarOrcado(nos),
      status: derivarStatus(nos),
      periodos: periodosEfetivos(nos),
      totais,
      larguraHoras: larguraHorasProposta(totais),
      linhas: nivel === "resumido" ? linhasTodas.filter((n) => n.tipo !== "atividade") : linhasTodas,
    };
  }, [dados, nivel]);

  const mostraTabela = conteudo === "tabela";
  const mostraGantt = conteudo !== "tabela";

  // Escala do Gantt: do menor início ao maior fim entre as linhas impressas.
  const escala = useMemo(() => {
    if (!calc || !mostraGantt) return null;
    let menor: string | null = null;
    let maior: string | null = null;
    for (const n of calc.linhas) {
      const p = calc.periodos.get(n.id);
      for (const d of [p?.inicio, p?.fim]) {
        if (!d) continue;
        if (menor == null || d < menor) menor = d;
        if (maior == null || d > maior) maior = d;
      }
    }
    return montarEscalaGantt(menor, maior, escalaPedida);
  }, [calc, mostraGantt, escalaPedida]);

  // Observação: na tabela vira coluna; nos modos com Gantt a linha fica estreita, então a observação
  // vira nota numerada ao pé da página.
  const notas = useMemo(() => {
    if (!calc || mostraTabela) return [];
    return calc.linhas.filter((n) => n.observacao).map((n, i) => ({ numero: i + 1, no: n }));
  }, [calc, mostraTabela]);
  const numeroDaNota = useMemo(() => new Map(notas.map((n) => [n.no.id, n.numero])), [notas]);

  async function baixarPdf() {
    setBaixando(true);
    setErroPdf(null);
    try {
      await baixarPdfDoServidor(
        `/api/alocacao/propostas/${codemp}/${codpro}/cronograma/pdf`,
        { conteudo, nivel, escala: escalaPedida, tema, orientacao },
        `cronograma-${codpro}-${conteudo}-${nivel}.pdf`
      );
    } catch (err) {
      setErroPdf((err as Error).message);
    } finally {
      setBaixando(false);
    }
  }

  const semLinhas = !!calc && calc.linhas.length === 0;
  const semDatas = mostraGantt && !!calc && !escala;
  // Larguras de colunas por conteúdo — "Estrutura" fica sem largura e ocupa o que sobra.
  const colunas: { chave: string; largura?: string }[] = mostraTabela
    ? [
        { chave: "estrutura" },
        { chave: "inicio", largura: "62px" },
        { chave: "fim", largura: "62px" },
        { chave: "orcado", largura: "50px" },
        { chave: "realizado", largura: "50px" },
        { chave: "alocado", largura: "50px" },
        { chave: "resp", largura: "140px" },
      ]
    : conteudo === "ambos"
      ? [{ chave: "estrutura" }, { chave: "resp", largura: "132px" }, { chave: "inicio", largura: "62px" }, { chave: "fim", largura: "62px" }, { chave: "gantt", largura: "40%" }]
      : [{ chave: "estrutura" }, { chave: "inicio", largura: "62px" }, { chave: "fim", largura: "62px" }, { chave: "gantt", largura: "62%" }];
  const tem = (chave: string) => colunas.some((c) => c.chave === chave);
  // Na tabela o responsável é a última coluna (depois de Alocado); com Gantt segue logo após a Estrutura.
  const respAntes = tem("resp") && !mostraTabela;

  const cabecalho = "px-1.5 py-1 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted";

  return (
    <RelatorioShell
      titulo="Relatório · Cronograma"
      tema={tema}
      onTema={escolherTema}
      orientacao={orientacao}
      onOrientacao={escolherOrientacao}
      controlesExtras={
        <>
          <Segmentado rotulo="Conteúdo" opcoes={["tabela", "gantt", "ambos"] as const} valor={conteudo} onChange={escolherConteudo} rotulos={ROTULOS_CONTEUDO} />
          <Segmentado rotulo="Nível de detalhe" opcoes={["resumido", "detalhado"] as const} valor={nivel} onChange={escolherNivel} />
          {mostraGantt && <Segmentado rotulo="Escala do Gantt" opcoes={["auto", "semana", "mes"] as const} valor={escalaPedida} onChange={escolherEscala} rotulos={ROTULOS_ESCALA} />}
        </>
      }
      podeBaixar={!!calc && !semLinhas}
      podeImprimir={!!calc && !semLinhas}
      baixandoPdf={baixando}
      onBaixarPdf={baixarPdf}
      erroPdf={erroPdf}
      larguraMax={orientacao === "paisagem" ? "max-w-[1047px] print:max-w-none" : "max-w-[718px] print:max-w-none"}
    >
      {loading && (
        <div className="flex items-center justify-center py-10 print:hidden">
          <Spinner />
        </div>
      )}
      {!loading && erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">{erro}</p>}
      {semLinhas && <p className="rounded-md border border-border bg-surface p-4 text-sm text-muted print:hidden">Esta proposta ainda não tem estrutura no Cronograma.</p>}

      {dados && calc && !semLinhas && (
        <div className="space-y-4">
          <header className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-foreground pb-3">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
                Cronograma · {nivel === "detalhado" ? "Detalhado" : "Resumido"} · {ROTULOS_CONTEUDO[conteudo]}
              </p>
              <h2 className="font-display text-2xl font-bold">{dados.proposta.cliente}</h2>
              <p className="text-sm text-muted">
                Proposta {dados.proposta.codpro} · Projeto {dados.proposta.numprj} · {dados.proposta.sitproLabel}
              </p>
            </div>
            <p className="text-[11px] text-muted">Emitido em {emitidoEm}</p>
          </header>

          <KpisCronograma totais={calc.totais} larguraHoras={calc.larguraHoras} />

          {semDatas && (
            <p className="rounded-md border border-border bg-surface p-3 text-sm text-muted">
              Nenhuma data definida no Cronograma — o Gantt precisa de início e fim nas atividades, pastas ou itens.
            </p>
          )}

          {mostraGantt && escala && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-muted">
              {LEGENDA_GANTT.map((l) => (
                <span key={l.rotulo} className="inline-flex items-center gap-1.5">
                  <span className={`inline-block h-2.5 w-4 rounded-[1px] ${l.classe}`} />
                  {l.rotulo}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-4 rounded-[1px] bg-foreground/70" />
                Pasta / item (resumo)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-4 rounded-[1px] bg-foreground/70"
                  style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--background) 0 2px, transparent 2px 4px)" }}
                />
                Período calculado pelas atividades
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 border-l-2 border-destructive/70" />
                Hoje
              </span>
            </div>
          )}

          <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
            <colgroup>
              {colunas.map((c) => (
                <col key={c.chave} style={c.largura ? { width: c.largura } : undefined} />
              ))}
            </colgroup>
            <thead className="[display:table-header-group]">
              <tr className="border-b-2 border-foreground text-left align-bottom">
                <th className={cabecalho}>Estrutura</th>
                {respAntes && <th className={cabecalho}>Responsável</th>}
                <th className={`${cabecalho} text-center`}>Início</th>
                <th className={`${cabecalho} text-center`}>Fim</th>
                {tem("orcado") && (
                  <>
                    <th className={`${cabecalho} text-right`}>Orçado</th>
                    <th className={`${cabecalho} text-right`}>Realiz.</th>
                    <th className={`${cabecalho} text-right`}>Alocado</th>
                  </>
                )}
                {!respAntes && tem("resp") && <th className={cabecalho}>Responsável</th>}
                {tem("gantt") && <th className="p-0 pb-0.5">{escala ? <CabecalhoGantt escala={escala} /> : null}</th>}
              </tr>
            </thead>
            <tbody>
              {calc.linhas.map((no) => {
                const periodo = calc.periodos.get(no.id);
                const statusEfetivo = calc.status.get(no.id) ?? "nao_iniciada";
                const agregado = calc.agregados.get(no.id);
                const orcado = calc.orcado.get(no.id) ?? 0;
                const atrasada = no.tipo === "atividade" && !!periodo?.fim && periodo.fim < hoje && statusEfetivo !== "concluida";
                const ehItem = no.tipo === "item";
                const ehRaiz = no.tipo === "pasta" && no.seqite == null;
                const resp = no.tipo === "atividade" ? no.responsavelNome : null;
                const nota = numeroDaNota.get(no.id);
                const dataCell = (valor: string | null | undefined, derivado: boolean) => (
                  <td
                    className={`px-1.5 py-[3px] text-center font-mono tabular-nums ${derivado ? "italic text-muted/80" : ""}`}
                    title={valor ? `${formatarDataBr(valor)}${derivado ? " (calculado pelas atividades abaixo)" : ""}` : undefined}
                  >
                    {formatarDataCurta(valor)}
                  </td>
                );
                return (
                  <tr
                    key={no.id}
                    className={`break-inside-avoid border-b border-border/70 ${ehItem ? "bg-surface-2 font-semibold" : ehRaiz ? "bg-surface-2/60 font-semibold" : no.tipo === "pasta" ? "font-medium" : ""}`}
                  >
                    <td className="px-1.5 py-[3px]">
                      <div className="flex items-start gap-1.5" style={{ paddingLeft: no.profundidade * 12 }}>
                        {no.tipo === "atividade" && (
                          <span className="mt-[1px] flex-none">
                            <IconeStatusAtividade status={statusEfetivo} />
                          </span>
                        )}
                        {ehItem && no.seqite != null && <span className="flex-none font-mono text-[10px] text-muted">{String(no.seqite).padStart(2, "0")}</span>}
                        <span className="min-w-0 break-words">
                          {no.nome}
                          {/* Departamento do item logo depois da descrição, sem coluna fixa. */}
                          {ehItem && no.depexeLabel && (
                            <span className="ml-1.5 inline-block rounded border border-border px-1 align-middle font-mono text-[9px] font-medium uppercase tracking-wide text-muted">
                              {no.depexeLabel}
                            </span>
                          )}
                          {nota != null && <sup className="ml-0.5 font-mono text-[8.5px] text-primary">[{nota}]</sup>}
                        </span>
                      </div>
                    </td>
                    {respAntes && <td className="px-1.5 py-[3px] font-normal text-muted">{resp}</td>}
                    {dataCell(periodo?.inicio, periodo?.inicioDerivado ?? false)}
                    {dataCell(periodo?.fim, periodo?.fimDerivado ?? false)}
                    {tem("orcado") && (
                      <>
                        <td className="px-1.5 py-[3px] text-right font-mono tabular-nums text-muted">
                          {ehItem || (no.tipo === "pasta" && orcado > 0) ? formatHorasCompacto(orcado, calc.larguraHoras) : ""}
                        </td>
                        <td
                          className={`px-1.5 py-[3px] text-right font-mono tabular-nums ${(agregado?.horasRealizadas ?? 0) > (agregado?.horasPrevistas ?? 0) ? "text-warning" : "text-primary"}`}
                        >
                          {formatHorasCompacto(agregado?.horasRealizadas ?? 0, calc.larguraHoras)}
                        </td>
                        <td className="px-1.5 py-[3px] text-right font-mono tabular-nums text-muted">{formatHorasCompacto(agregado?.horasPrevistas ?? 0, calc.larguraHoras)}</td>
                      </>
                    )}
                    {!respAntes && tem("resp") && <td className="px-1.5 py-[3px] font-normal text-muted">{resp}</td>}
                    {tem("gantt") && (
                      <td className="p-0 align-middle">
                        {escala && (
                          <LinhaGantt
                            escala={escala}
                            inicio={periodo?.inicio ?? null}
                            fim={periodo?.fim ?? null}
                            derivado={!!periodo && (periodo.inicioDerivado || periodo.fimDerivado)}
                            tipo={no.tipo}
                            status={statusEfetivo}
                            atrasada={atrasada}
                            hoje={hoje >= escala.inicio && hoje <= escala.fim ? hoje : null}
                            titulo={`${no.nome}${periodo?.inicio ? ` · ${formatarDataBr(periodo.inicio)}` : ""}${periodo?.fim ? ` a ${formatarDataBr(periodo.fim)}` : ""}`}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {notas.length > 0 && (
            <section className="break-inside-avoid">
              <h3 className="mb-1 border-b border-border pb-1 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Observações</h3>
              <ol className="space-y-1 text-[11px]">
                {notas.map(({ numero, no }) => (
                  <Fragment key={no.id}>
                    <li className="flex gap-2 break-inside-avoid">
                      <span className="w-6 flex-none text-right font-mono text-[10px] text-primary">[{numero}]</span>
                      <span>
                        <span className="font-medium">{no.nome}</span>
                        <span className="text-muted"> — </span>
                        <span className="whitespace-pre-wrap">{no.observacao}</span>
                      </span>
                    </li>
                  </Fragment>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </RelatorioShell>
  );
}
