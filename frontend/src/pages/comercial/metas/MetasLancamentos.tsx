import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Aviso, BarraAtingimento, botaoPrimario, botaoSecundario, Cabecalho, Cartao, campo, mensagemDe, SeletorAno, tomDoAtingimento, useAnosMetas, Vazio } from "../../../components/metasComercial/comum";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { ConfigAno, Indicador, Lancamento, LancamentosResposta, MESES_CURTOS, MESES_LONGOS, ehDoSenior, fmtPct, fmtValor, lerNumero, numParaCampo, quandoFoto, rotuloOrigem } from "../../../lib/metasComercial";

interface Edicao {
  meta?: string;
  realizado?: string;
  observacao?: string;
}

const chave = (pid: number, iid: number) => `${pid}:${iid}`;

// Comercial › Gestão de Metas › Lançamentos: a rotina do mês. Meta e realizado de cada pessoa por indicador, salvos de uma vez.
// Faturamento e Mensalidade (carteira de contratos) vêm do Senior e aparecem só para leitura. Campo vazio apaga o valor.
export function MetasLancamentos() {
  const { anos, ano, escolherAno, recarregarAnos, erro: erroAnos } = useAnosMetas();
  const [params, setParams] = useSearchParams();
  const { mostrar } = useToast();
  const hoje = new Date();
  const mesPadrao = ano === hoje.getFullYear() ? hoje.getMonth() + 1 : ano != null && ano < hoje.getFullYear() ? 12 : 1;
  const mesPedido = Number(params.get("mes"));
  const mes = Number.isInteger(mesPedido) && mesPedido >= 1 && mesPedido <= 12 ? mesPedido : mesPadrao;

  const [config, setConfig] = useState<ConfigAno | null>(null);
  const [indicadores, setIndicadores] = useState<Indicador[]>([]);
  const [dados, setDados] = useState<LancamentosResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [edicoes, setEdicoes] = useState<Record<string, Edicao>>({});
  const [gravando, setGravando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (ano == null) return;
    let cancelado = false;
    setErro(null);
    Promise.all([
      axios.get<ConfigAno>(`/api/metas-comercial/anos/${ano}`),
      axios.get<{ indicadores: Indicador[] }>("/api/metas-comercial/indicadores"),
      axios.get<LancamentosResposta>(`/api/metas-comercial/anos/${ano}/lancamentos`),
    ])
      .then(([c, i, l]) => {
        if (cancelado) return;
        setConfig(c.data);
        setIndicadores(i.data.indicadores);
        setDados(l.data);
        setEdicoes({});
      })
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível carregar os lançamentos.")));
    return () => {
      cancelado = true;
    };
  }, [ano, recarga]);

  const indPorId = useMemo(() => new Map(indicadores.map((i) => [i.id, i])), [indicadores]);
  const lancDoMes = useMemo(() => {
    const m = new Map<string, Lancamento>();
    for (const l of dados?.lancamentos ?? []) if (l.mes === mes) m.set(chave(l.participanteId, l.indicadorId), l);
    return m;
  }, [dados, mes]);
  const mesesComDado = useMemo(() => new Set((dados?.lancamentos ?? []).filter((l) => l.realizado != null).map((l) => l.mes)), [dados]);

  const sujo = Object.keys(edicoes).length > 0;
  function confirmarDescarte(): boolean {
    return !sujo || window.confirm("Há valores digitados que ainda não foram salvos. Descartar?");
  }
  function irParaMes(novo: number) {
    if (novo === mes || !confirmarDescarte()) return;
    setEdicoes({});
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set("mes", String(novo));
      return n;
    });
  }
  function escolher(novoAno: number) {
    if (novoAno === ano || !confirmarDescarte()) return;
    escolherAno(novoAno);
  }

  const textoCampo = useCallback(
    (pid: number, iid: number, f: "meta" | "realizado" | "observacao"): string => {
      const e = edicoes[chave(pid, iid)]?.[f];
      if (e !== undefined) return e;
      const l = lancDoMes.get(chave(pid, iid));
      if (!l) return "";
      return f === "observacao" ? l.observacao ?? "" : numParaCampo(l[f]);
    },
    [edicoes, lancDoMes]
  );

  function digitar(pid: number, iid: number, f: keyof Edicao, valor: string) {
    setEdicoes((atual) => {
      const k = chave(pid, iid);
      const novo = { ...atual, [k]: { ...atual[k], [f]: valor } };
      // Voltou ao valor original: deixa de contar como alteração.
      const l = lancDoMes.get(k);
      const original = f === "observacao" ? l?.observacao ?? "" : numParaCampo(l ? l[f] : null);
      if (valor === original) {
        const { [f]: _removido, ...resto } = novo[k];
        if (Object.keys(resto).length === 0) delete novo[k];
        else novo[k] = resto;
      }
      return novo;
    });
  }

  async function salvar() {
    if (ano == null || !sujo || gravando) return;
    const itens: Array<Record<string, unknown>> = [];
    for (const [k, e] of Object.entries(edicoes)) {
      const [pid, iid] = k.split(":").map(Number);
      const item: Record<string, unknown> = { participanteId: pid, indicadorId: iid, mes };
      for (const f of ["meta", "realizado"] as const) {
        if (e[f] === undefined) continue;
        const n = lerNumero(e[f]!);
        if (Number.isNaN(n)) {
          const nome = config?.participantes.find((p) => p.id === pid)?.nome ?? "";
          mostrar(`Valor inválido em ${nome} / ${indPorId.get(iid)?.nome ?? ""}: use números como 1.234,56.`, "destructive");
          return;
        }
        item[f] = n;
      }
      if (e.observacao !== undefined) item.observacao = e.observacao.trim() === "" ? null : e.observacao.trim();
      itens.push(item);
    }
    setGravando(true);
    try {
      const { data } = await axios.put<{ gravados: number }>(`/api/metas-comercial/anos/${ano}/lancamentos`, { itens });
      mostrar(data.gravados === 0 ? "Nada mudou." : `${data.gravados} lançamento${data.gravados === 1 ? "" : "s"} salvo${data.gravados === 1 ? "" : "s"} em ${MESES_LONGOS[mes - 1].toLowerCase()}.`, "success");
      setRecarga((n) => n + 1);
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível salvar os lançamentos."), "destructive");
    } finally {
      setGravando(false);
    }
  }

  const participantes = (config?.participantes ?? []).filter((p) => p.ativo && p.indicadores.length > 0);
  const semPessoas = config != null && participantes.filter((p) => !p.naoAtribuido).length === 0;

  return (
    <div>
      <Cabecalho titulo="Lançamentos do mês" descricao="Digite a meta e o realizado de cada pessoa por indicador e salve. Campo vazio apaga o valor. O faturamento vem do Senior e não é digitado.">
        {anos && <SeletorAno anos={anos} ano={ano} onEscolher={escolher} onCriado={recarregarAnos} />}
        <button type="button" onClick={() => setEdicoes({})} disabled={!sujo || gravando} className={botaoSecundario}>
          Descartar
        </button>
        <button type="button" onClick={salvar} disabled={!sujo || gravando} className={botaoPrimario}>
          {gravando ? "Salvando…" : sujo ? `Salvar (${Object.keys(edicoes).length})` : "Salvar"}
        </button>
      </Cabecalho>

      {(erroAnos || erro) && <Aviso>{erroAnos ?? erro}</Aviso>}
      {anos && anos.length === 0 && <Vazio>Ainda não há metas cadastradas. Use <strong>Novo ano</strong> para começar.</Vazio>}

      {ano != null && (
        <>
          <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Mês">
            {MESES_CURTOS.map((m, i) => {
              const ativo = i + 1 === mes;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => irParaMes(i + 1)}
                  aria-pressed={ativo}
                  className={`relative rounded-md border px-3 py-1.5 text-[13px] font-medium capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    ativo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  {m}
                  {mesesComDado.has(i + 1) && !ativo && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-success" title="Tem realizado lançado" />}
                </button>
              );
            })}
          </div>

          {!config || !dados ? (
            !erro && (
              <div className="space-y-4" aria-busy="true">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            )
          ) : semPessoas ? (
            <Vazio>
              Nenhuma pessoa nas metas de {ano}. Inclua o time em{" "}
              <Link to={`/comercial/metas/planejamento?ano=${ano}`} className="font-medium text-primary hover:underline">Metas do ano</Link>.
            </Vazio>
          ) : (
            <div className="space-y-4">
              {participantes.map((p) => (
                <Cartao key={p.id} titulo={p.nome} nota={p.naoAtribuido ? "Ajustes sem dono: somam nos números da empresa" : p.funcao ?? undefined}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                          <th className="py-1.5 pr-3 font-medium">Indicador</th>
                          <th className="w-36 px-2 py-1.5 font-medium">Meta do mês</th>
                          <th className="w-36 px-2 py-1.5 font-medium">Realizado</th>
                          <th className="w-24 px-2 py-1.5 text-right font-medium">%</th>
                          <th className="px-2 py-1.5 font-medium">Observação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.indicadores.map((pi) => {
                          const ind = indPorId.get(pi.indicadorId);
                          if (!ind) return null;
                          const senior = ehDoSenior(ind.origem);
                          const seriePessoa = dados.realizadoSeniorPessoa?.[ind.origem];
                          const valorSenior = (seriePessoa ? seriePessoa[String(p.id)]?.[mes - 1] : dados.realizadoSenior?.[ind.origem]?.[mes - 1]) ?? null;
                          const fonteCarteira = dados.fontesCarteira?.[mes - 1] ?? null;
                          const notaSenior =
                            ind.origem !== "CARTEIRA_SENIOR"
                              ? "Senior"
                              : valorSenior == null
                                ? "sem foto"
                                : fonteCarteira === "RECONSTRUIDA"
                                  ? "reconstruída"
                                  : mes === (dados.fontesCarteira ?? []).lastIndexOf("FOTO") + 1
                                    ? `foto de ${quandoFoto(dados.ultimaFotoCarteira).split(" às")[0]}`
                                    : "foto";
                          const metaTxt = textoCampo(p.id, ind.id, "meta");
                          const realTxt = textoCampo(p.id, ind.id, "realizado");
                          const meta = lerNumero(metaTxt);
                          const real = senior ? valorSenior : lerNumero(realTxt);
                          const ating = typeof meta === "number" && typeof real === "number" && meta > 0 ? real / meta : null;
                          const sufixo = ind.unidade === "BRL" ? "R$" : ind.unidade === "HORAS" ? "h" : "";
                          return (
                            <tr key={ind.id} className="border-b border-border/60 align-middle">
                              <td className="py-1.5 pr-3">
                                <span className="text-foreground">{pi.rotulo?.trim() || ind.nome}</span>
                                {pi.rotulo && pi.rotulo.trim() !== ind.nome && <span className="ml-1.5 text-[11.5px] text-muted">({ind.nome})</span>}
                                {ind.acumulacao === "SALDO" && <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted">posição</span>}
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  inputMode="decimal"
                                  aria-label={`Meta de ${pi.rotulo?.trim() || ind.nome} para ${p.nome}`}
                                  value={metaTxt}
                                  onChange={(e) => digitar(p.id, ind.id, "meta", e.target.value)}
                                  placeholder={sufixo}
                                  className={`${campo} text-right tabular-nums ${edicoes[chave(p.id, ind.id)]?.meta !== undefined ? "border-primary" : ""}`}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                {senior ? (
                                  <span className="block px-2.5 py-1.5 text-right tabular-nums text-muted" title={rotuloOrigem(ind.origem)}>
                                    {fmtValor(ind.unidade, valorSenior)} <span className="text-[10.5px]">{notaSenior}</span>
                                  </span>
                                ) : (
                                  <input
                                    inputMode="decimal"
                                    aria-label={`Realizado de ${pi.rotulo?.trim() || ind.nome} para ${p.nome}`}
                                    value={realTxt}
                                    onChange={(e) => digitar(p.id, ind.id, "realizado", e.target.value)}
                                    placeholder={sufixo}
                                    className={`${campo} text-right tabular-nums ${edicoes[chave(p.id, ind.id)]?.realizado !== undefined ? "border-primary" : ""}`}
                                  />
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                <span className={tomDoAtingimento(ating)}>{fmtPct(ating, 0)}</span>
                                <BarraAtingimento valor={ating} className="mt-1" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  aria-label={`Observação de ${pi.rotulo?.trim() || ind.nome} para ${p.nome}`}
                                  value={textoCampo(p.id, ind.id, "observacao")}
                                  onChange={(e) => digitar(p.id, ind.id, "observacao", e.target.value)}
                                  maxLength={300}
                                  className={campo}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Cartao>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
