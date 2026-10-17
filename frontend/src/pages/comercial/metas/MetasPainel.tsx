import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Indicador } from "../../../components/eficiencia/comum";
import { Aviso, BarraAtingimento, botaoSecundario, Cabecalho, Cartao, GraficoAcumulado, mensagemDe, SeletorAno, tomDoAtingimento, useAnosMetas, Vazio, campo } from "../../../components/metasComercial/comum";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { MESES_LONGOS, Painel, PERIODOS_FIXOS, fmtPct, fmtResumo, fmtValor, rotuloPeriodo } from "../../../lib/metasComercial";

const PERIODO_VALIDO = /^(ano|s[12]|t[1-4]|(mes|ate)-([1-9]|1[0-2]))$/;

// Comercial › Gestão de Metas › Painel: meta × realizado da empresa e de cada pessoa, no ano ou num recorte (semestre, trimestre, mês,
// acumulado). Só admin e gestor do Comercial (RequireGestorOuAdmin depexe=2 em App.tsx; exigirAdminOuGestorComercial no backend).
export function MetasPainel() {
  const { anos, ano, escolherAno, recarregarAnos, erro: erroAnos } = useAnosMetas();
  const [params, setParams] = useSearchParams();
  const periodo = PERIODO_VALIDO.test(params.get("periodo") ?? "") ? (params.get("periodo") as string) : "ano";
  const { mostrar } = useToast();
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [foco, setFoco] = useState<number | null>(null);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    if (ano == null) return;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    axios
      .get<Painel>(`/api/metas-comercial/anos/${ano}/painel`, { params: { periodo } })
      .then(({ data }) => {
        if (cancelado) return;
        setPainel(data);
        setFoco((atual) => (atual != null && data.indicadores.some((i) => i.indicadorId === atual) ? atual : data.indicadores[0]?.indicadorId ?? null));
      })
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível carregar o painel de metas.")))
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [ano, periodo]);

  const mudarPeriodo = (valor: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (valor === "ano") n.delete("periodo");
      else n.set("periodo", valor);
      return n;
    });

  async function exportar() {
    if (ano == null || exportando) return;
    setExportando(true);
    try {
      const { data } = await axios.get<Blob>(`/api/metas-comercial/anos/${ano}/painel.csv`, { params: { periodo }, responseType: "blob" });
      const href = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = href;
      a.download = `metas-comercial-${ano}-${periodo}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível exportar o CSV."), "destructive");
    } finally {
      setExportando(false);
    }
  }

  const indicadorFoco = useMemo(() => painel?.indicadores.find((i) => i.indicadorId === foco) ?? null, [painel, foco]);
  const comMeta = painel?.indicadores.filter((i) => i.consolidado.atingimento != null).length ?? 0;
  const mesAtual = new Date().getMonth() + 1;

  return (
    <div>
      <Cabecalho titulo="Painel de metas" descricao="Meta × realizado da empresa e de cada pessoa do time comercial, no ano ou num recorte do ano. Faturamento vem direto das notas fiscais do Senior.">
        {anos && <SeletorAno anos={anos} ano={ano} onEscolher={escolherAno} onCriado={recarregarAnos} />}
        <button type="button" onClick={exportar} disabled={ano == null || exportando} className={botaoSecundario}>
          {exportando ? "Exportando…" : "Exportar CSV"}
        </button>
      </Cabecalho>

      {(erroAnos || erro) && <Aviso>{erroAnos ?? erro}</Aviso>}
      {anos && anos.length === 0 && (
        <Vazio>
          Ainda não há metas cadastradas. Use <strong>Novo ano</strong> para começar e depois preencha as metas em{" "}
          <Link to="/comercial/metas/planejamento" className="font-medium text-primary hover:underline">Metas do ano</Link>.
        </Vazio>
      )}

      {ano != null && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <label htmlFor="metas-periodo" className="text-[12.5px] text-muted">Período</label>
            <select id="metas-periodo" value={periodo} onChange={(e) => mudarPeriodo(e.target.value)} className={`${campo} w-auto`}>
              {PERIODOS_FIXOS.map((p) => (
                <option key={p.valor} value={p.valor}>{p.rotulo}</option>
              ))}
              {ano === new Date().getFullYear() && <option value={`ate-${mesAtual}`}>{rotuloPeriodo(`ate-${mesAtual}`)}</option>}
              <optgroup label="Mês">
                {MESES_LONGOS.map((m, i) => (
                  <option key={m} value={`mes-${i + 1}`}>{m}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {carregando && !painel && (
            <div className="space-y-4" aria-busy="true">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}

          {painel && (
            <div className={`space-y-5 ${carregando ? "opacity-60" : ""}`}>
              {painel.indicadores.length === 0 ? (
                <Vazio>
                  Nenhuma meta da empresa em {ano}. Cadastre em{" "}
                  <Link to={`/comercial/metas/planejamento?ano=${ano}`} className="font-medium text-primary hover:underline">Metas do ano</Link>.
                </Vazio>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-border bg-surface p-4 sm:col-span-2 xl:col-span-1">
                      <Indicador
                        rotulo={`Atingimento geral · ${rotuloPeriodo(periodo)}`}
                        valor={fmtPct(painel.atingimentoGeral)}
                        sub={`Média de ${comMeta} indicador${comMeta === 1 ? "" : "es"} com meta`}
                        tom={painel.atingimentoGeral != null && painel.atingimentoGeral >= 1 ? "ok" : undefined}
                        medidor={painel.atingimentoGeral ?? 0}
                      />
                    </div>
                    {painel.indicadores.map((i) => {
                      const c = i.consolidado;
                      const sem = i.metaAnual == null && c.meta === 0;
                      return (
                        <div key={i.indicadorId} className={`rounded-lg border bg-surface p-4 ${foco === i.indicadorId ? "border-primary" : "border-border"}`}>
                          <Indicador
                            rotulo={i.nome}
                            valor={fmtResumo(i.unidade, c.realizado)}
                            sub={
                              sem
                                ? "Sem meta da empresa"
                                : `${fmtPct(c.atingimento)} de ${fmtResumo(i.unidade, c.meta)} · ${c.saldo >= 0 ? "falta" : "superou"} ${fmtResumo(i.unidade, Math.abs(c.saldo))}`
                            }
                            tom={c.atingimento != null && c.atingimento >= 1 ? "ok" : undefined}
                            medidor={c.atingimento ?? 0}
                            dica={i.acumulacao === "SALDO" ? "Posição: vale o último mês lançado" : i.origem === "FATURAMENTO_SENIOR" ? "Vem das notas fiscais do Senior" : undefined}
                            onClick={() => setFoco(i.indicadorId)}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {indicadorFoco && (
                    <Cartao
                      titulo={`Mês a mês — ${indicadorFoco.nome}`}
                      nota={
                        indicadorFoco.metaDasPessoas != null && indicadorFoco.metaAnual != null
                          ? `Soma das metas individuais no período: ${fmtResumo(indicadorFoco.unidade, indicadorFoco.metaDasPessoas)} (meta da empresa: ${fmtResumo(indicadorFoco.unidade, indicadorFoco.consolidado.meta)})`
                          : indicadorFoco.acumulacao === "SALDO"
                            ? "Posição da carteira: a meta é a posição-alvo e vale o último mês lançado"
                            : undefined
                      }
                    >
                      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
                        <div className="min-w-0 overflow-x-auto">
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
                              {indicadorFoco.mensal.map((m) => (
                                <tr key={m.mes} className={`border-b border-border/60 ${painel.meses.includes(m.mes) ? "" : "text-muted"}`}>
                                  <td className="py-1.5 pr-3">{MESES_LONGOS[m.mes - 1].slice(0, 3)}</td>
                                  <td className="px-3 py-1.5 text-right">{fmtValor(indicadorFoco.unidade, m.meta)}</td>
                                  <td className="px-3 py-1.5 text-right">{fmtValor(indicadorFoco.unidade, m.realizado)}</td>
                                  <td className={`px-3 py-1.5 text-right ${tomDoAtingimento(m.atingimento)}`}>{fmtPct(m.atingimento, 0)}</td>
                                  <td className="py-1.5 pl-3"><BarraAtingimento valor={m.atingimento} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <GraficoAcumulado
                          pontos={indicadorFoco.serie}
                          unidade={indicadorFoco.unidade}
                          titulo={`${indicadorFoco.nome}: meta e realizado ao longo do ano`}
                          legenda={indicadorFoco.acumulacao === "SALDO" ? ["Meta (posição-alvo)", "Realizado no mês"] : ["Meta acumulada", "Realizado acumulado"]}
                        />
                      </div>
                    </Cartao>
                  )}

                  <div>
                    <h2 className="mb-3 font-display text-[15px] font-semibold text-foreground">Por pessoa · {rotuloPeriodo(periodo)}</h2>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                      {painel.pessoas
                        .filter((p) => p.indicadores.length > 0)
                        .map((p) => (
                          <Cartao
                            key={p.participanteId}
                            titulo={p.nome}
                            nota={p.naoAtribuido ? "Ajustes sem dono (somam na empresa)" : p.funcao ?? undefined}
                            acao={!p.naoAtribuido ? <span className={`font-mono text-sm font-semibold tabular-nums ${tomDoAtingimento(p.atingimentoGeral)}`}>{fmtPct(p.atingimentoGeral, 0)}</span> : undefined}
                          >
                            <ul className="space-y-3">
                              {p.indicadores.map((i) => (
                                <li key={i.indicadorId}>
                                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                                    <span className="min-w-0 truncate text-foreground" title={i.rotulo}>{i.rotulo}</span>
                                    <span className={`shrink-0 font-mono tabular-nums ${tomDoAtingimento(i.consolidado.atingimento)}`}>{fmtPct(i.consolidado.atingimento, 0)}</span>
                                  </div>
                                  <BarraAtingimento valor={i.consolidado.atingimento} className="my-1" />
                                  <div className="text-[12px] tabular-nums text-muted">
                                    {fmtResumo(i.unidade, i.consolidado.realizado)}
                                    {i.consolidado.meta > 0 && ` de ${fmtResumo(i.unidade, i.consolidado.meta)}`}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </Cartao>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
