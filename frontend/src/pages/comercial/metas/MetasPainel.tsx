import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Indicador } from "../../../components/eficiencia/comum";
import { Aviso, BarraAtingimento, botaoSecundario, Cabecalho, Cartao, mensagemDe, SeletorAno, tomDoAtingimento, useAnosMetas, Vazio, campoAuto } from "../../../components/metasComercial/comum";
import { IndicadorMesAMes, MesAMes } from "../../../components/metasComercial/MesAMes";
import { NotasFaturadasModal } from "../../../components/metasComercial/NotasFaturadasModal";
import { PedidosLicencasModal } from "../../../components/metasComercial/PedidosLicencasModal";
import { QuadroMetas, VisaoQuadro } from "../../../components/metasComercial/QuadroMetas";
import { Skeleton } from "../../../components/ui/Skeleton";
import { TabDef, Tabs } from "../../../components/ui/Tabs";
import { useToast } from "../../../components/ui/Toast";
import { MESES_LONGOS, Painel, PERIODOS_FIXOS, ehDoSenior, fmtCurto, fmtPct, fmtResumo, quandoFoto, rotuloOrigem, rotuloPeriodo, serieDe } from "../../../lib/metasComercial";

const PERIODO_VALIDO = /^(ano|s[12]|t[1-4]|(mes|ate)-([1-9]|1[0-2]))$/;

// "Quadro de metas" é o padrão (formato da planilha da gerente comercial); "Indicadores" mantém os cartões de KPI de antes.
const ABAS: TabDef[] = [
  { key: "quadro", label: "Quadro de metas" },
  { key: "indicadores", label: "Indicadores" },
];

// Comercial › Gestão de Metas › Painel: meta × realizado da empresa e de cada pessoa, no ano ou num recorte (semestre, trimestre, mês,
// acumulado). Só admin e gestor do Comercial (RequireGestorOuAdmin depexe=2 em App.tsx; exigirAdminOuGestorComercial no backend).
export function MetasPainel() {
  const { anos, ano, escolherAno, recarregarAnos, erro: erroAnos } = useAnosMetas();
  const [params, setParams] = useSearchParams();
  const periodo = PERIODO_VALIDO.test(params.get("periodo") ?? "") ? (params.get("periodo") as string) : "ano";
  const aba = params.get("aba") === "indicadores" ? "indicadores" : "quadro";
  const { mostrar } = useToast();
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [foco, setFoco] = useState<number | null>(null);
  const [visao, setVisao] = useState<VisaoQuadro>("empresa");
  const [notasDoMes, setNotasDoMes] = useState<number | null>(null);
  const [pedidosDoMes, setPedidosDoMes] = useState<number | null>(null);
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
        setVisao((atual) => (atual === "empresa" || data.pessoas.some((p) => p.participanteId === atual) ? atual : "empresa"));
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

  const mudarAba = useCallback(
    (key: string) =>
      setParams((p) => {
        const n = new URLSearchParams(p);
        if (key === "quadro") n.delete("aba");
        else n.set("aba", key);
        return n;
      }),
    [setParams]
  );

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

  // Mês a mês do Quadro: na visão de uma pessoa, os meses DELA (sem os links de notas/pedidos, que listam a empresa toda).
  const pessoaVisao = painel && visao !== "empresa" ? painel.pessoas.find((p) => p.participanteId === visao) ?? null : null;
  const mesAMesQuadro: { indicador: IndicadorMesAMes; titulo?: string; comLinks: boolean } | null = useMemo(() => {
    if (!painel || foco == null) return null;
    if (!pessoaVisao) return indicadorFoco ? { indicador: indicadorFoco, comLinks: true } : null;
    const i = pessoaVisao.indicadores.find((x) => x.indicadorId === foco) ?? pessoaVisao.indicadores[0];
    if (!i) return null;
    return {
      titulo: `Mês a mês — ${i.rotulo} · ${pessoaVisao.naoAtribuido ? "Não atribuído" : pessoaVisao.nome}`,
      comLinks: false,
      indicador: {
        nome: i.rotulo,
        unidade: i.unidade,
        acumulacao: i.acumulacao,
        origem: painel.indicadores.find((x) => x.indicadorId === i.indicadorId)?.origem ?? "MANUAL",
        metaAnual: null,
        metaDasPessoas: null,
        consolidado: i.consolidado,
        mensal: i.mensal,
        serie: serieDe(i.mensal, i.acumulacao),
      },
    };
  }, [painel, foco, pessoaVisao, indicadorFoco]);

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
            <select id="metas-periodo" value={periodo} onChange={(e) => mudarPeriodo(e.target.value)} className={campoAuto}>
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

          <Tabs tabs={ABAS} activeKey={aba} onChange={mudarAba} />

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
              ) : aba === "quadro" ? (
                <>
                  <QuadroMetas painel={painel} visao={visao} onVisao={setVisao} foco={foco} onFoco={setFoco} />
                  {mesAMesQuadro && (
                    <MesAMes
                      painel={painel}
                      indicador={mesAMesQuadro.indicador}
                      titulo={mesAMesQuadro.titulo}
                      comLinks={mesAMesQuadro.comLinks}
                      onNotas={setNotasDoMes}
                      onPedidos={setPedidosDoMes}
                    />
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-md border border-transparent sm:col-span-2 xl:col-span-1 [&>*]:h-full [&>*]:w-full">
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
                        <div key={i.indicadorId} className={`rounded-md border [&>*]:h-full [&>*]:w-full ${foco === i.indicadorId ? "border-primary" : "border-transparent"}`}>
                          <Indicador
                            rotulo={i.nome}
                            valor={fmtResumo(i.unidade, c.realizado)}
                            sub={
                              sem
                                ? "Sem meta da empresa"
                                : `${fmtPct(c.atingimento)} de ${fmtCurto(i.unidade, c.meta)} · ${c.saldo >= 0 ? "falta" : "superou"} ${fmtCurto(i.unidade, Math.abs(c.saldo))}`
                            }
                            tom={c.atingimento != null && c.atingimento >= 1 ? "ok" : undefined}
                            medidor={c.atingimento ?? 0}
                            dica={i.origem === "CARTEIRA_SENIOR" ? `${rotuloOrigem(i.origem)}: foto de ${quandoFoto(painel.ultimaFotoCarteira)}` : i.acumulacao === "SALDO" ? "Posição: vale o último mês lançado" : ehDoSenior(i.origem) ? rotuloOrigem(i.origem) : undefined}
                            onClick={() => setFoco(i.indicadorId)}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {indicadorFoco && <MesAMes painel={painel} indicador={indicadorFoco} onNotas={setNotasDoMes} onPedidos={setPedidosDoMes} />}

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
      {notasDoMes != null && ano != null && <NotasFaturadasModal ano={ano} mes={notasDoMes} onClose={() => setNotasDoMes(null)} />}
      {pedidosDoMes != null && ano != null && <PedidosLicencasModal ano={ano} mes={pedidosDoMes} onClose={() => setPedidosDoMes(null)} />}
    </div>
  );
}
