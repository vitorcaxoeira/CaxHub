import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Aviso, botaoPerigo, botaoPrimario, botaoSecundario, Cabecalho, Cartao, campo, mensagemDe, SeletorAno, useAnosMetas, Vazio } from "../../../components/metasComercial/comum";
import { MetasMensaisModal } from "../../../components/metasComercial/MetasMensaisModal";
import { Elegivel, PessoaForm } from "../../../components/metasComercial/PessoaForm";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { ConfigAno, Indicador, LancamentosResposta, MESES_CURTOS, Participante, PESOS_PADRAO, Representante, fmtValor, lerNumero, numParaCampo, pesoParaCampo, somaPesos, ehDoSenior, rotuloOrigem } from "../../../lib/metasComercial";

// Comercial › Gestão de Metas › Metas do ano: pesos de cada mês, meta anual da empresa por indicador e o time (quem acompanha o quê e as
// metas mensais de cada pessoa). Depois disso a rotina do mês é só a tela de Lançamentos.
export function MetasPlanejamento() {
  const { anos, ano, escolherAno, recarregarAnos, erro: erroAnos } = useAnosMetas();
  const { mostrar } = useToast();
  const [config, setConfig] = useState<ConfigAno | null>(null);
  const [indicadores, setIndicadores] = useState<Indicador[]>([]);
  const [dados, setDados] = useState<LancamentosResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const recarregar = () => setRecarga((n) => n + 1);

  const [pesos, setPesos] = useState<string[]>([]);
  const [metas, setMetas] = useState<Record<number, string>>({});
  const [observacao, setObservacao] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const [elegiveis, setElegiveis] = useState<Elegivel[]>([]);
  const [representantes, setRepresentantes] = useState<Representante[]>([]);
  const [incluindo, setIncluindo] = useState(false);
  const [editando, setEditando] = useState<Participante | null>(null);
  const [mensais, setMensais] = useState<Participante | null>(null);

  useEffect(() => {
    if (ano == null) return;
    let cancelado = false;
    setErro(null);
    Promise.all([
      axios.get<ConfigAno>(`/api/metas-comercial/anos/${ano}`),
      axios.get<{ indicadores: Indicador[] }>("/api/metas-comercial/indicadores"),
      axios.get<LancamentosResposta>(`/api/metas-comercial/anos/${ano}/lancamentos`),
      axios.get<{ elegiveis: Elegivel[] }>("/api/metas-comercial/elegiveis"),
      axios.get<{ representantes: Representante[] }>("/api/metas-comercial/representantes"),
    ])
      .then(([c, i, l, e, r]) => {
        if (cancelado) return;
        setConfig(c.data);
        setIndicadores(i.data.indicadores);
        setDados(l.data);
        setElegiveis(e.data.elegiveis);
        setRepresentantes(r.data.representantes);
        setPesos(c.data.pesosMensais.map((p) => pesoParaCampo(p)));
        setMetas(Object.fromEntries(c.data.empresa.map((m) => [m.indicadorId, numParaCampo(m.metaAnual)])));
        setObservacao(c.data.observacao ?? "");
        setErroForm(null);
      })
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível carregar as metas do ano.")));
    return () => {
      cancelado = true;
    };
  }, [ano, recarga]);

  const pesosNum = pesos.map((p) => lerNumero(p));
  const pesosValidos = pesosNum.length === 12 && pesosNum.every((p) => typeof p === "number" && !Number.isNaN(p));
  const soma = pesosValidos ? somaPesos(pesosNum as number[]) : null;
  const somaOk = soma != null && Math.abs(soma - 100) <= 0.01;

  // Quem aparece na tabela de metas da empresa: indicadores ativos, e os inativos que já têm meta.
  const listaIndicadores = useMemo(() => indicadores.filter((i) => i.ativo || metas[i.id] !== undefined), [indicadores, metas]);
  const somaDasPessoas = useMemo(() => {
    const m = new Map<number, number>();
    const ativos = new Set((config?.participantes ?? []).filter((p) => p.ativo).map((p) => p.id));
    for (const l of dados?.lancamentos ?? []) if (l.meta != null && ativos.has(l.participanteId)) m.set(l.indicadorId, (m.get(l.indicadorId) ?? 0) + l.meta);
    return m;
  }, [dados, config]);

  async function salvar() {
    if (ano == null || !config) return;
    setErroForm(null);
    if (!pesosValidos || !somaOk) {
      setErroForm(soma == null ? "Preencha os 12 pesos com números." : `Os pesos devem somar 100% (somam ${numParaCampo(Math.round(soma * 10000) / 10000)}%).`);
      return;
    }
    const empresa: Array<{ indicadorId: number; metaAnual: number }> = [];
    for (const [id, t] of Object.entries(metas)) {
      const n = lerNumero(t);
      if (n == null) continue;
      if (Number.isNaN(n)) {
        setErroForm(`Meta inválida em ${indicadores.find((i) => i.id === Number(id))?.nome ?? id}: use números como 1.234,56.`);
        return;
      }
      empresa.push({ indicadorId: Number(id), metaAnual: n });
    }
    setGravando(true);
    try {
      await axios.put(`/api/metas-comercial/anos/${ano}`, { pesosMensais: pesosNum, observacao: observacao.trim() === "" ? null : observacao.trim(), empresa });
      mostrar("Metas do ano salvas.", "success");
      recarregar();
    } catch (e) {
      setErroForm(mensagemDe(e, "Não foi possível salvar."));
    } finally {
      setGravando(false);
    }
  }

  async function excluir(p: Participante) {
    if (!window.confirm(`Excluir ${p.nome} das metas de ${ano}? Só é possível se ela não tiver lançamentos.`)) return;
    try {
      await axios.delete(`/api/metas-comercial/anos/${ano}/participantes/${p.id}`);
      mostrar(`${p.nome} saiu das metas.`, "success");
      recarregar();
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível excluir."), "destructive");
    }
  }

  const idsNoAno = new Set((config?.participantes ?? []).map((p) => p.codfor));
  const disponiveis = elegiveis.filter((e) => !idsNoAno.has(e.codfor));
  const nomeInd = (id: number) => indicadores.find((i) => i.id === id)?.nome ?? String(id);

  return (
    <div>
      <Cabecalho titulo="Metas do ano" descricao="Defina como o ano se divide em meses, a meta da empresa por indicador e quem do time acompanha o quê. Os valores do dia a dia entram em Lançamentos.">
        {anos && <SeletorAno anos={anos} ano={ano} onEscolher={escolherAno} onCriado={recarregarAnos} />}
        <button type="button" onClick={salvar} disabled={gravando || !config} className={botaoPrimario}>
          {gravando ? "Salvando…" : "Salvar pesos e metas"}
        </button>
      </Cabecalho>

      {(erroAnos || erro) && <Aviso>{erroAnos ?? erro}</Aviso>}
      {anos && anos.length === 0 && <Vazio>Ainda não há metas cadastradas. Use <strong>Novo ano</strong> para começar.</Vazio>}

      {ano != null && !config && !erro && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {ano != null && config && (
        <div className="space-y-5">
          {erroForm && <Aviso>{erroForm}</Aviso>}

          <Cartao
            titulo="Peso de cada mês"
            nota="Quanto do ano cada mês representa. Reparte a meta da empresa e alimenta o assistente das metas das pessoas."
            acao={
              <button type="button" onClick={() => setPesos(PESOS_PADRAO.map((p) => pesoParaCampo(p)))} className="text-[12.5px] font-medium text-primary hover:underline">
                Restaurar padrão da planilha
              </button>
            }
          >
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
              {MESES_CURTOS.map((m, i) => (
                <div key={m}>
                  <label htmlFor={`peso-${i}`} className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">{m}</label>
                  <input id={`peso-${i}`} inputMode="decimal" value={pesos[i] ?? ""} onChange={(e) => setPesos((atual) => atual.map((p, j) => (j === i ? e.target.value : p)))} className={`${campo} text-right tabular-nums`} />
                </div>
              ))}
            </div>
            <p className={`mt-3 text-[12.5px] tabular-nums ${somaOk ? "text-muted" : "text-destructive"}`}>
              Soma: {soma == null ? "—" : `${numParaCampo(Math.round(soma * 10000) / 10000)}%`} {somaOk ? "✓" : "(precisa fechar 100%)"}
            </p>
            <div className="mt-3">
              <label htmlFor="obs-ano" className="mb-1 block text-[12px] text-muted">Observação do ano (opcional)</label>
              <input id="obs-ano" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} className={campo} />
            </div>
          </Cartao>

          <Cartao titulo="Meta anual da empresa" nota="Em branco = sem meta da empresa neste indicador.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                    <th className="py-1.5 pr-3 font-medium">Indicador</th>
                    <th className="w-44 px-2 py-1.5 font-medium">Meta do ano</th>
                    <th className="px-2 py-1.5 font-medium">Conferência</th>
                  </tr>
                </thead>
                <tbody>
                  {listaIndicadores.map((i) => {
                    const pessoas = somaDasPessoas.get(i.id);
                    const metaEmp = lerNumero(metas[i.id] ?? "");
                    return (
                      <tr key={i.id} className="border-b border-border/60">
                        <td className="py-1.5 pr-3 text-foreground">
                          {i.nome}
                          <span className="ml-1.5 text-[11px] text-muted">{i.unidade === "BRL" ? "R$" : i.unidade === "HORAS" ? "horas" : "unidades"}</span>
                          {i.acumulacao === "SALDO" && <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted">posição-alvo</span>}
                          {ehDoSenior(i.origem) && <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted" title={rotuloOrigem(i.origem)}>{i.origem === "CARTEIRA_SENIOR" ? "realizado: carteira do Senior" : "realizado do Senior"}</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            inputMode="decimal"
                            aria-label={`Meta anual de ${i.nome}`}
                            value={metas[i.id] ?? ""}
                            onChange={(e) => setMetas((atual) => ({ ...atual, [i.id]: e.target.value }))}
                            className={`${campo} text-right tabular-nums`}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-[12.5px] text-muted">
                          {i.origem === "FATURAMENTO_SENIOR" && config.referenciaSenior && (
                            <span>Meta no Senior: {fmtValor("BRL", config.referenciaSenior.metaAnualFaturamento)} ({numParaCampo(config.referenciaSenior.crescimentoEsperado)}% de crescimento)</span>
                          )}
                          {i.acumulacao === "SOMA" && pessoas != null && (
                            <span>
                              Soma das metas das pessoas: {fmtValor(i.unidade, pessoas)}
                              {typeof metaEmp === "number" && !Number.isNaN(metaEmp) && metaEmp > 0 ? ` (${numParaCampo(Math.round((pessoas / metaEmp) * 1000) / 10)}% da meta)` : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Cartao>

          <Cartao
            titulo="Time"
            nota="Quem do Comercial tem meta neste ano e quais indicadores acompanha."
            acao={
              <button type="button" onClick={() => setIncluindo(true)} className={botaoSecundario}>
                Incluir pessoa
              </button>
            }
          >
            <ul className="divide-y divide-border">
              {config.participantes.map((p) => (
                <li key={p.id} className={`flex flex-wrap items-center justify-between gap-3 py-3 ${p.ativo ? "" : "opacity-60"}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {p.nome}
                      {p.funcao && <span className="ml-2 text-[12.5px] font-normal text-muted">{p.funcao}</span>}
                      {p.codrep != null && (
                        <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-normal text-muted" title="Representante do Senior: as horas das propostas dele são o realizado de Horas de Serviços">
                          representante {representantes.find((x) => x.codrep === p.codrep)?.nome ?? p.codrep}
                        </span>
                      )}
                      {!p.ativo && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-normal text-muted">inativa</span>}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {p.naoAtribuido && "Guarda ajustes sem dono (somam na empresa). "}
                      {p.indicadores.length === 0
                        ? "Nenhum indicador ainda."
                        : p.indicadores.map((i) => (i.rotulo && i.rotulo !== nomeInd(i.indicadorId) ? `${i.rotulo} (${nomeInd(i.indicadorId)})` : nomeInd(i.indicadorId))).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setMensais(p)} disabled={p.indicadores.length === 0} className={botaoSecundario}>
                      Metas mensais
                    </button>
                    <button type="button" onClick={() => setEditando(p)} className={botaoSecundario}>
                      Editar
                    </button>
                    {!p.naoAtribuido && (
                      <button type="button" onClick={() => excluir(p)} className={botaoPerigo}>
                        Excluir
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Cartao>

          <PessoaForm aberto={incluindo} onClose={() => setIncluindo(false)} ano={config.ano} indicadores={indicadores} elegiveis={disponiveis} representantes={representantes} onSalvo={recarregar} />
          {editando && <PessoaForm aberto onClose={() => setEditando(null)} ano={config.ano} indicadores={indicadores} elegiveis={[]} representantes={representantes} participante={editando} onSalvo={recarregar} />}
          {mensais && dados && <MetasMensaisModal aberto onClose={() => setMensais(null)} config={{ ...config, pesosMensais: pesosValidos ? (pesosNum as number[]) : config.pesosMensais }} indicadores={indicadores} participante={mensais} lancamentos={dados.lancamentos} onSalvo={recarregar} />}
        </div>
      )}
    </div>
  );
}
