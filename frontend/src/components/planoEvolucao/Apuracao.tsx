import axios from "axios";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../ui/Toast";
import { baixarPdfDoServidor } from "../relatorio/relatorioComum";
import { Cartao, Chip, Indicador, Vazio } from "../eficiencia/comum";
import { hn } from "../../lib/eficiencia";
import {
  ApuracaoDetalheResposta,
  ApuracaoListaResposta,
  ChaveObservacao,
  CicloDto,
  LancamentosDto,
  brl2,
  dataBr,
  pctBp,
  pctNum,
  rotuloSituacaoCiclo,
  rotuloStatusApuracao,
  tomDaSituacaoCiclo,
  tomDoStatusApuracao,
} from "../../lib/planoEvolucao";
import { MemoriaCalculo } from "./MemoriaCalculo";

const campo =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const botaoSecundario =
  "rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const botaoPrimario =
  "rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const rotuloCampo = "mb-1 block text-[13px] font-medium text-foreground";

const mensagemDe = (e: unknown, padrao: string) => (axios.isAxiosError(e) ? e.response?.data?.error ?? padrao : padrao);

// ---------------------------------------------------------------- lista do ciclo

// Aba "Apuração": por ciclo, o índice global fechado e o andamento de cada consultor (lançamento → apuração → devolutiva → encerramento).
export function Apuracao({ ciclos, cicloId, onSelecionar, admin }: { ciclos: CicloDto[]; cicloId: number | null; onSelecionar: (id: number) => void; admin: boolean }) {
  const { mostrar } = useToast();
  const [dados, setDados] = useState<ApuracaoListaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [aberto, setAberto] = useState<number | null>(null);
  const [fechando, setFechando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const recarregar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    if (cicloId == null) {
      setDados(null);
      return;
    }
    let cancelado = false;
    setErro(null);
    axios
      .get<ApuracaoListaResposta>(`/api/plano-evolucao/ciclos/${cicloId}/apuracao`)
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível carregar a apuração do ciclo.")));
    return () => {
      cancelado = true;
    };
  }, [cicloId, recarga]);

  async function fecharGlobal(refazer: boolean) {
    if (cicloId == null || fechando) return;
    if (refazer && !window.confirm("Refazer o índice global recalcula o resultado de TODOS os consultores que ainda não foram apurados. Continuar?")) return;
    setFechando(true);
    try {
      await axios.post(`/api/plano-evolucao/ciclos/${cicloId}/global`, refazer ? { refazer: true } : {});
      mostrar("Índice global do ciclo fechado.", "success");
      recarregar();
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível fechar o índice global."), "destructive");
    } finally {
      setFechando(false);
    }
  }

  async function exportar() {
    if (cicloId == null || exportando) return;
    setExportando(true);
    try {
      const { data } = await axios.get<Blob>(`/api/plano-evolucao/ciclos/${cicloId}/export`, { responseType: "blob" });
      const href = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = href;
      a.download = `plano-evolucao-${dados?.ciclo.ano ?? "ciclo"}-${dados?.ciclo.semestre ?? ""}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      mostrar(axios.isAxiosError(e) && e.response?.status === 404 ? "Não foi possível exportar." : "Não foi possível exportar o CSV.", "destructive");
    } finally {
      setExportando(false);
    }
  }

  if (ciclos.length === 0) return <Vazio>Ainda não há ciclo. A apuração acontece sobre um ciclo criado na aba Ciclos e parâmetros.</Vazio>;

  const g = dados?.global ?? null;
  const encerrados = dados?.participantes.filter((p) => p.status === "encerrado").length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ciclo-apuracao" className="text-[12.5px] text-muted">Ciclo</label>
        <select id="ciclo-apuracao" value={cicloId ?? ""} onChange={(e) => onSelecionar(Number(e.target.value))} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {ciclos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.rotulo}
            </option>
          ))}
        </select>
        {admin && (
          <button type="button" onClick={exportar} disabled={exportando || encerrados === 0} title={encerrados === 0 ? "Nenhuma apuração encerrada neste ciclo ainda" : "Baixa as apurações encerradas, para a folha de pagamento"} className={botaoSecundario}>
            {exportando ? "Gerando…" : "Exportar CSV"}
          </button>
        )}
      </div>

      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>}
      {!dados && !erro && <Skeleton className="h-64 w-full" />}

      {dados && (
        <>
          {dados.ensaio && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px] text-foreground" role="status">
              <b>Ciclo de simulação.</b> Anterior ao início do plano (01/01/2027): dá para lançar e apurar para conhecer o fluxo, mas nada aqui vale como resultado, entra na sequência do reforçador ou efetiva valor.
            </p>
          )}

          <Cartao
            titulo="Eficiência global da área"
            nota="requisito coletivo: um só resultado, igual para todos, fechado uma vez"
            acao={
              admin && dados.podeFecharGlobal ? (
                <button type="button" onClick={() => fecharGlobal(g != null)} disabled={fechando} className={g ? botaoSecundario : botaoPrimario}>
                  {fechando ? "Fechando…" : g ? "Refazer índice global" : "Fechar índice global"}
                </button>
              ) : undefined
            }
          >
            {g ? (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Indicador
                  rotulo="Índice fechado"
                  valor={g.semBase ? "sem base" : pctNum(g.indice)}
                  sub={g.meta != null ? `meta ${pctNum(g.meta)}` : "meta não definida"}
                  tom={g.atingiu == null ? "off" : g.atingiu ? "ok" : "warn"}
                  dica="Das horas executadas nos itens da área, a parte dentro do orçado do item. É fechado uma vez por ciclo e vale para todos os consultores."
                />
                <Indicador rotulo="Horas executadas" valor={`${hn(g.executadoMin)} h`} sub={`${g.itens} itens`} />
                <Indicador rotulo="Dentro do orçado" valor={`${hn(g.dentroMin)} h`} sub={`${hn(g.acimaMin)} h acima`} />
                <Indicador rotulo="Resultado" valor={g.atingiu == null ? "sem base" : g.atingiu ? "atingida" : "não atingida"} sub={g.atingiu == null ? "o 5º ponto não é concedido" : g.atingiu ? "+1 ponto para todos" : "5º ponto não concedido"} tom={g.atingiu == null ? "off" : g.atingiu ? "ok" : "warn"} />
              </div>
            ) : (
              <div className="space-y-2 text-sm text-muted">
                <p>
                  O índice global ainda não foi fechado. {dados.podeFecharGlobal ? "Confira o valor de agora e feche para liberar a apuração dos consultores." : <>A apuração abre no corte de evidências, <b className="text-foreground">{dataBr(dados.abreEm)}</b>.</>}
                </p>
                <p className="font-mono text-[12.5px]">
                  Hoje: {dados.globalAgora.semBase ? "sem base" : pctNum(dados.globalAgora.indice)} · {hn(dados.globalAgora.dentroMin)} h dentro de {hn(dados.globalAgora.executadoMin)} h executadas
                </p>
              </div>
            )}
          </Cartao>

          <Cartao titulo="Consultores" nota={`${dados.participantes.length} no plano · ${encerrados} encerrado${encerrados === 1 ? "" : "s"}`}>
            {dados.participantes.length === 0 ? (
              <Vazio>Nenhum consultor do seu time está no plano.</Vazio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm [&_td]:px-2 [&_th]:px-2">
                  <thead>
                    <tr className="text-left font-mono text-[10.5px] uppercase tracking-wider text-muted">
                      <th className="py-2 font-medium">Consultor</th>
                      <th className="py-2 font-medium">Andamento</th>
                      <th className="py-2 font-medium">Resultado</th>
                      <th className="py-2 text-right font-medium">Percentual</th>
                      {dados.mostraValores && <th className="py-2 text-right font-medium">Valor hora</th>}
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {dados.participantes.map((p) => (
                      <tr key={p.participanteId} className="border-t border-border/60">
                        <td className="px-2.5 py-2">
                          <button type="button" onClick={() => setAberto(p.participanteId)} className="block text-left font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {p.nome}
                          </button>
                          <span className="block text-[11.5px] text-muted">{p.departamento ?? "—"}</span>
                        </td>
                        <td className="px-2.5 py-2">
                          <Chip tom={tomDoStatusApuracao(p.status)}>{p.statusRotulo}</Chip>
                          {p.contestacaoPendente && <span className="mt-0.5 block text-[11.5px] font-medium text-warning">contestação aguardando desfecho</span>}
                          {p.status === "rascunho" || p.status === "nao_iniciada" ? (
                            <span className="mt-0.5 block text-[11.5px] text-muted">{p.pendentes.length === 0 ? "pronto para apurar" : `falta lançar: ${p.pendentes.length}`}</span>
                          ) : null}
                        </td>
                        <td className="px-2.5 py-2">{p.statusCiclo ? <Chip tom={tomDaSituacaoCiclo(p.statusCiclo)}>{rotuloSituacaoCiclo(p.statusCiclo)}</Chip> : <span className="text-muted">—</span>}{p.efetivou && <span className="ml-2 text-[11.5px] font-medium text-success">efetiva</span>}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{p.percentualBp != null ? pctBp(p.percentualBp) : "—"}</td>
                        {dados.mostraValores && <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{p.valorHora != null ? brl2(p.valorHora) : "—"}</td>}
                        <td className="whitespace-nowrap px-2.5 py-2 text-right">
                          <button type="button" onClick={() => setAberto(p.participanteId)} className="text-[12.5px] font-medium text-primary hover:underline">
                            {p.status === "nao_iniciada" || p.status === "rascunho" ? "Lançar" : "Abrir"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!dados.mostraValores && <p className="mt-3 text-[12px] text-muted">Valor hora é dado sensível: só o administrador e os gestores da Consultoria ERP e HCM veem.</p>}
          </Cartao>
        </>
      )}

      {aberto != null && cicloId != null && <ModalApuracao cicloId={cicloId} participanteId={aberto} onFechar={() => setAberto(null)} onMudou={recarregar} />}
    </div>
  );
}

// ---------------------------------------------------------------- uma apuração

type Tri = "" | "sim" | "nao";
const triDe = (v: boolean | null | undefined): Tri => (v == null ? "" : v ? "sim" : "nao");
const triPara = (t: Tri): boolean | null => (t === "" ? null : t === "sim");
const numTxt = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const txtNum = (t: string): number | null => {
  const l = t.trim().replace(",", ".");
  if (l === "") return null;
  const n = Number(l);
  return Number.isFinite(n) ? n : NaN;
};

interface Forma {
  contratoAtivoNoCiclo: boolean;
  cicloCompleto: boolean;
  interrupcaoDias: string;
  competenciasPct: string;
  certificacoesCumpriu: Tri;
  clientesMedia: string;
  clientesRespostas: string;
  caseCumpriu: Tri;
  eficienciaIndividualDecisao: Tri;
  manuais: Record<string, Tri>;
  observacoes: Record<ChaveObservacao, string>;
}

function formaDe(d: ApuracaoDetalheResposta): Forma {
  const l: LancamentosDto = d.apuracao.lancamentos;
  const manuais: Record<string, Tri> = {};
  for (const i of d.apuracao.indicadores.filter((x) => x.tipo === "manual")) manuais[i.chave] = triDe(l.manuais.find((m) => m.chave === i.chave)?.atingiu);
  const o = d.apuracao.observacoes;
  return {
    contratoAtivoNoCiclo: l.contratoAtivoNoCiclo,
    cicloCompleto: l.cicloCompleto,
    interrupcaoDias: String(l.interrupcaoDias ?? 0),
    competenciasPct: numTxt(l.competenciasPct),
    certificacoesCumpriu: triDe(l.certificacoesCumpriu),
    clientesMedia: numTxt(l.clientesMedia),
    clientesRespostas: numTxt(l.clientesRespostas),
    caseCumpriu: triDe(l.caseCumpriu),
    eficienciaIndividualDecisao: triDe(l.eficienciaIndividualDecisao),
    manuais,
    observacoes: { competencias: o.competencias ?? "", certificacoes: o.certificacoes ?? "", clientes: o.clientes ?? "", case: o.case ?? "", eficiencia: o.eficiencia ?? "", geral: o.geral ?? "" },
  };
}

function corpoDe(f: Forma) {
  return {
    contratoAtivoNoCiclo: f.contratoAtivoNoCiclo,
    cicloCompleto: f.cicloCompleto,
    interrupcaoDias: Number(f.interrupcaoDias || 0),
    competenciasPct: txtNum(f.competenciasPct),
    certificacoesCumpriu: triPara(f.certificacoesCumpriu),
    clientesMedia: txtNum(f.clientesMedia),
    clientesRespostas: txtNum(f.clientesRespostas),
    caseCumpriu: triPara(f.caseCumpriu),
    eficienciaIndividualDecisao: triPara(f.eficienciaIndividualDecisao),
    manuais: Object.entries(f.manuais).map(([chave, t]) => ({ chave, atingiu: triPara(t) })),
    observacoes: Object.fromEntries(Object.entries(f.observacoes).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()])),
  };
}

function TriSelect({ id, valor, onChange, sim = "Cumprido", nao = "Não cumprido", disabled }: { id: string; valor: Tri; onChange: (t: Tri) => void; sim?: string; nao?: string; disabled?: boolean }) {
  return (
    <select id={id} value={valor} onChange={(e) => onChange(e.target.value as Tri)} className={campo} disabled={disabled}>
      <option value="">Ainda não lançado</option>
      <option value="sim">{sim}</option>
      <option value="nao">{nao}</option>
    </select>
  );
}

function Obs({ id, valor, onChange, disabled }: { id: string; valor: string; onChange: (t: string) => void; disabled?: boolean }) {
  return <input id={id} value={valor} onChange={(e) => onChange(e.target.value)} maxLength={500} disabled={disabled} placeholder="Evidência / observação (opcional)" aria-label="Evidência ou observação" className={`${campo} mt-1.5 text-[13px]`} />;
}

function Bloco({ titulo, nota, children }: { titulo: string; nota?: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-[13px] font-semibold text-foreground">{titulo}</legend>
      {nota && <p className="-mt-0.5 mb-2 text-[12px] text-muted">{nota}</p>}
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function ModalApuracao({ cicloId, participanteId, onFechar, onMudou }: { cicloId: number; participanteId: number; onFechar: () => void; onMudou: () => void }) {
  const { mostrar } = useToast();
  const [det, setDet] = useState<ApuracaoDetalheResposta | null>(null);
  const [forma, setForma] = useState<Forma | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const url = `/api/plano-evolucao/apuracoes/${cicloId}/${participanteId}`;

  const aplicar = useCallback((d: ApuracaoDetalheResposta) => {
    setDet(d);
    setForma(formaDe(d));
    setErro(null);
  }, []);

  useEffect(() => {
    let cancelado = false;
    axios
      .get<ApuracaoDetalheResposta>(url)
      .then(({ data }) => !cancelado && aplicar(data))
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível carregar a apuração.")));
    return () => {
      cancelado = true;
    };
  }, [url, aplicar]);

  const status = det?.apuracao.status ?? "rascunho";
  const editavel = status === "rascunho";
  const sujo = useMemo(() => (det && forma ? JSON.stringify(forma) !== JSON.stringify(formaDe(det)) : false), [det, forma]);
  const decisaoPendente = det?.apuracao.pendentes.some((p) => p.chave === "eficienciaIndividual") ?? false;
  const manuaisAtivos = det?.apuracao.indicadores.filter((i) => i.tipo === "manual") ?? [];
  const mostraDecisao = decisaoPendente || forma?.eficienciaIndividualDecisao !== "";

  async function acao(nome: string, metodo: "put" | "post", caminho: string, corpo: unknown, sucesso: string) {
    if (ocupado) return;
    setOcupado(nome);
    setErro(null);
    try {
      const { data } = await axios.request<ApuracaoDetalheResposta>({ method: metodo, url: caminho, data: corpo });
      aplicar(data);
      mostrar(sucesso, "success");
      onMudou();
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível concluir."));
    } finally {
      setOcupado(null);
    }
  }

  const salvar = (e?: FormEvent) => {
    e?.preventDefault();
    if (forma) void acao("salvar", "put", url, corpoDe(forma), "Lançamentos salvos.");
  };

  async function baixarPdf() {
    const id = det?.apuracao.id;
    if (!id) return;
    setOcupado("pdf");
    try {
      await baixarPdfDoServidor(`/api/plano-evolucao/apuracoes/${id}/memoria/pdf`, { tema: "claro", orientacao: "retrato" }, `memoria-de-calculo-${id}.pdf`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const r = det?.apuracao.resultado ?? null;
  const set = <K extends keyof Forma>(k: K, v: Forma[K]) => setForma((f) => (f ? { ...f, [k]: v } : f));
  const setObs = (k: ChaveObservacao, v: string) => setForma((f) => (f ? { ...f, observacoes: { ...f.observacoes, [k]: v } } : f));

  return (
    <Modal open onClose={onFechar} title={det ? det.participante.nome : "Apuração"} subtitulo={det ? `${det.ciclo.rotulo} · ${det.participante.departamento ?? "sem departamento"}` : undefined} className="max-w-3xl" fecharPorFora={false}>
      <div className="space-y-4">
        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive" role="alert">{erro}</p>}
        {!det && !erro && <Skeleton className="h-64 w-full" />}

        {det && forma && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tom={tomDoStatusApuracao(status)}>{rotuloStatusApuracao[status]}</Chip>
              {det.ensaio && <Chip tom="warn">simulação</Chip>}
              {r && <Chip tom={tomDaSituacaoCiclo(r.statusCiclo)}>{rotuloSituacaoCiclo(r.statusCiclo)}</Chip>}
              <span className="text-[12px] text-muted">{det.estadoAntes.consecutivos} ciclo(s) já cumprido(s) antes deste{det.apuracao.revisoes > 0 ? ` · reaberta ${det.apuracao.revisoes}×` : ""}</span>
            </div>

            {editavel && det.bloqueios.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-foreground" role="status">
                <p className="font-medium">Ainda não dá para apurar:</p>
                <ul className="mt-1 list-disc pl-5">
                  {det.bloqueios.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* ---- Indicadores ao vivo ---- */}
            <Cartao titulo="Eficiência individual: indicadores do ciclo" nota={det.apuracao.eficienciaIndividual.nota != null ? `nota ${pctNum(det.apuracao.eficienciaIndividual.nota)} · mínimo ${det.ciclo.notaMinimaEficienciaIndividual}%` : "sem base para a nota"}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm [&_td]:px-2 [&_th]:px-2">
                  <thead>
                    <tr className="text-left font-mono text-[10.5px] uppercase tracking-wider text-muted">
                      <th className="py-1.5 font-medium">Indicador</th>
                      <th className="py-1.5 text-right font-medium">Peso</th>
                      <th className="py-1.5 text-right font-medium">Valor</th>
                      <th className="py-1.5 text-right font-medium">Meta</th>
                      <th className="py-1.5 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {det.apuracao.indicadores.map((i) => {
                      const manual = i.tipo === "manual";
                      return (
                        <tr key={i.chave} className="border-t border-border/60">
                          <td className="py-1.5 text-foreground">
                            {i.rotulo}
                            <span className="block text-[11px] text-muted">{manual ? "lançado pelo gestor" : "automático"}</span>
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums">{i.peso}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums">{manual ? "—" : i.semBase ? "sem base" : pctNum(i.valor)}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums">{i.meta != null ? pctNum(i.meta) : "—"}</td>
                          <td className="py-1.5">
                            <Chip tom={i.atingiu == null ? "off" : i.atingiu ? "ok" : "bad"}>{i.semBase ? "sem base" : i.atingiu == null ? "não lançado" : i.atingiu ? "atingido" : "não atingido"}</Chip>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {editavel && sujo && <p className="mt-2 text-[12px] text-muted">Salve os lançamentos para recalcular a nota com o que você acabou de marcar.</p>}
            </Cartao>

            {/* ---- Formulário de lançamentos ---- */}
            {editavel && (
              <form onSubmit={salvar} className="space-y-3">
                <Bloco titulo="Portão do ciclo" nota="Os três são eliminatórios: sem eles o ciclo não é apurado ou não pontua.">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="flex items-center gap-2 text-[13px] text-foreground">
                      <input type="checkbox" checked={forma.contratoAtivoNoCiclo} onChange={(e) => set("contratoAtivoNoCiclo", e.target.checked)} />
                      Contrato ativo durante o ciclo
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-foreground">
                      <input type="checkbox" checked={forma.cicloCompleto} onChange={(e) => set("cicloCompleto", e.target.checked)} />
                      Ciclo completo (6 meses)
                    </label>
                    <div>
                      <label htmlFor="ap-int" className="text-[12px] text-muted">Interrupção formal (dias)</label>
                      <input id="ap-int" inputMode="numeric" value={forma.interrupcaoDias} onChange={(e) => set("interrupcaoDias", e.target.value.replace(/\D/g, ""))} className={campo} />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="ap-comp" className={rotuloCampo}>Avaliação de Competências (%)</label>
                    <input id="ap-comp" inputMode="decimal" value={forma.competenciasPct} onChange={(e) => set("competenciasPct", e.target.value)} placeholder="0 a 100 (mínimo 80)" className={`${campo} sm:max-w-[220px]`} />
                    <Obs id="obs-comp" valor={forma.observacoes.competencias} onChange={(t) => setObs("competencias", t)} />
                  </div>
                </Bloco>

                <Bloco titulo="Requisitos individuais" nota="Cada um vale 1 ponto percentual e são indivisíveis: cumprir três dos quatro dá 0%.">
                  <div>
                    <label htmlFor="ap-cert" className={rotuloCampo}>
                      6.1 Certificações Técnicas
                      {det.ciclo.certificacoesExigidas ? <span className="ml-2 font-normal text-muted">exigidas: {det.ciclo.certificacoesExigidas}</span> : null}
                    </label>
                    <TriSelect id="ap-cert" valor={forma.certificacoesCumpriu} onChange={(t) => set("certificacoesCumpriu", t)} />
                    <Obs id="obs-cert" valor={forma.observacoes.certificacoes} onChange={(t) => setObs("certificacoes", t)} />
                  </div>
                  <div>
                    <span className={rotuloCampo}>6.2 Avaliação de Clientes</span>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="ap-resp" className="text-[12px] text-muted">Avaliações respondidas</label>
                        <input id="ap-resp" inputMode="numeric" value={forma.clientesRespostas} onChange={(e) => set("clientesRespostas", e.target.value.replace(/\D/g, ""))} placeholder="0 se nenhum cliente respondeu" className={campo} />
                      </div>
                      <div>
                        <label htmlFor="ap-media" className="text-[12px] text-muted">Média (0 a 10)</label>
                        <input id="ap-media" inputMode="decimal" value={forma.clientesMedia} onChange={(e) => set("clientesMedia", e.target.value)} placeholder="ex.: 8,5" className={campo} />
                      </div>
                    </div>
                    <p className="mt-1 text-[12px] text-muted">Com menos de 3 respostas o requisito é considerado cumprido: a falta de resposta não é do consultor. Aí a média não é necessária.</p>
                    <Obs id="obs-cli" valor={forma.observacoes.clientes} onChange={(t) => setObs("clientes", t)} />
                  </div>
                  <div>
                    <label htmlFor="ap-case" className={rotuloCampo}>6.3 Case Técnico</label>
                    <TriSelect id="ap-case" valor={forma.caseCumpriu} onChange={(t) => set("caseCumpriu", t)} />
                    <Obs id="obs-case" valor={forma.observacoes.case} onChange={(t) => setObs("case", t)} />
                  </div>
                  {manuaisAtivos.length > 0 && (
                    <div>
                      <span className={rotuloCampo}>Indicadores lançados pelo gestor (6.4)</span>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {manuaisAtivos.map((i) => (
                          <div key={i.chave}>
                            <label htmlFor={`man-${i.chave}`} className="text-[12px] text-muted">
                              {i.rotulo} (peso {i.peso})
                            </label>
                            <TriSelect id={`man-${i.chave}`} valor={forma.manuais[i.chave] ?? ""} onChange={(t) => setForma((f) => (f ? { ...f, manuais: { ...f.manuais, [i.chave]: t } } : f))} sim="Atingido" nao="Não atingido" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {mostraDecisao && (
                    <div>
                      <label htmlFor="ap-dec" className={rotuloCampo}>6.4 Eficiência Individual: decisão do gestor</label>
                      <p className="mb-1 text-[12px] text-muted">Nenhum indicador teve base neste ciclo (poucas horas na área e nenhum indicador manual com peso): decida e justifique.</p>
                      <TriSelect id="ap-dec" valor={forma.eficienciaIndividualDecisao} onChange={(t) => set("eficienciaIndividualDecisao", t)} />
                      <Obs id="obs-efi" valor={forma.observacoes.eficiencia} onChange={(t) => setObs("eficiencia", t)} />
                    </div>
                  )}
                </Bloco>

                <div>
                  <label htmlFor="obs-geral" className={rotuloCampo}>Observação geral da apuração</label>
                  <textarea id="obs-geral" rows={2} maxLength={500} value={forma.observacoes.geral} onChange={(e) => setObs("geral", e.target.value)} className={campo} />
                </div>

                {det.apuracao.pendentes.length > 0 && (
                  <div className="rounded-md border border-border bg-surface-2/60 px-3 py-2 text-[13px]">
                    <p className="font-medium text-foreground">Falta lançar:</p>
                    <ul className="mt-1 list-disc pl-5 text-muted">
                      {det.apuracao.pendentes.map((p) => (
                        <li key={p.chave}>{p.rotulo}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={onFechar} className={botaoSecundario}>
                    Fechar
                  </button>
                  <button type="submit" disabled={!sujo || ocupado != null} className={botaoSecundario}>
                    {ocupado === "salvar" ? "Salvando…" : "Salvar lançamentos"}
                  </button>
                  <button
                    type="button"
                    disabled={sujo || !det.podeApurar || ocupado != null}
                    title={sujo ? "Salve os lançamentos antes de apurar" : !det.podeApurar ? "Resolva os bloqueios e as pendências" : "Congela o resultado deste ciclo"}
                    onClick={() => window.confirm("Apurar congela o resultado e trava os lançamentos. Continuar?") && void acao("apurar", "post", `${url}/apurar`, {}, "Ciclo apurado.")}
                    className={botaoPrimario}
                  >
                    {ocupado === "apurar" ? "Apurando…" : "Apurar o ciclo"}
                  </button>
                </div>
              </form>
            )}

            {/* ---- Depois de apurado ---- */}
            {!editavel && r && (
              <Cartao titulo="Resultado do ciclo" nota={`apurado em ${det.apuracao.apuradoEm ? dataBr(det.apuracao.apuradoEm) : "—"}`}>
                <div className="grid grid-cols-2 gap-3">
                  <Indicador rotulo="Percentual sobre a base" valor={r.statusCiclo === "cumprido" ? pctBp(r.percentualBp) : "0%"} sub={`${pctBp(r.pontuacaoBp)} do ciclo + ${pctBp(r.reforcadorBp)} de reforçador`} tom={tomDaSituacaoCiclo(r.statusCiclo)} />
                  {det.mostraValores ? (
                    <Indicador rotulo="Valor hora do ciclo" valor={brl2(r.valorHora)} sub={`base ${brl2(r.valorHoraBase)}${r.efetivou ? " · EFETIVA no encerramento" : ""}`} tom={r.efetivou ? "ok" : undefined} />
                  ) : (
                    <Indicador rotulo="Sequência" valor={`${r.consecutivosDepois}`} sub={r.efetivou ? "10º ciclo: efetivação" : "ciclos seguidos cumpridos"} />
                  )}
                </div>
              </Cartao>
            )}

            {!editavel && det.memoria && (
              <div className="rounded-lg border border-border p-4">
                <div className="mb-3 flex flex-wrap justify-end gap-2">
                  <a href={`/projetos/plano-evolucao/memoria/${det.apuracao.id}`} target="_blank" rel="noreferrer" className={botaoSecundario}>
                    Abrir para imprimir
                  </a>
                  <button type="button" onClick={baixarPdf} disabled={ocupado === "pdf"} className={botaoSecundario}>
                    {ocupado === "pdf" ? "Gerando PDF…" : "Baixar PDF"}
                  </button>
                </div>
                <MemoriaCalculo memoria={det.memoria} />
              </div>
            )}

            {status === "apurado" && <FormDevolutiva ocupado={ocupado} onEnviar={(c) => acao("devolutiva", "post", `${url}/devolutiva`, c, "Devolutiva registrada.")} />}

            {(status === "devolutiva" || status === "encerrado") && (
              <Cartao titulo="Devolutiva e contestação">
                <ul className="space-y-1.5 text-[13px] text-foreground">
                  {det.apuracao.devolutiva && (
                    <li>
                      Devolutiva em <b>{dataBr(det.apuracao.devolutiva.em)}</b>
                      {det.apuracao.devolutiva.observacao ? <span className="text-muted"> — {det.apuracao.devolutiva.observacao}</span> : null}
                    </li>
                  )}
                  {det.apuracao.contestacao && (
                    <li>
                      Contestação{det.apuracao.contestacao.recebidaEm ? ` recebida em ${dataBr(det.apuracao.contestacao.recebidaEm)}` : ""}: <span className="text-muted">{det.apuracao.contestacao.texto}</span>
                    </li>
                  )}
                  {det.apuracao.desfecho && (
                    <li>
                      Desfecho: <b>{det.apuracao.desfecho.resultado === "procedente" ? "contestação procedente" : "apuração mantida"}</b>
                      {det.apuracao.desfecho.texto ? <span className="text-muted"> — {det.apuracao.desfecho.texto}</span> : null}
                    </li>
                  )}
                  {!det.apuracao.contestacao && status === "encerrado" && <li className="text-muted">Sem contestação.</li>}
                </ul>

                {status === "devolutiva" && !det.apuracao.contestacao && <FormContestacao ocupado={ocupado} onEnviar={(c) => acao("contestacao", "post", `${url}/contestacao`, c, "Contestação registrada.")} />}
                {status === "devolutiva" && det.apuracao.contestacao && !det.apuracao.desfecho && <FormDesfecho ocupado={ocupado} admin={det.mostraValores} onEnviar={(c) => acao("desfecho", "post", `${url}/desfecho`, c, c.resultado === "procedente" ? "Apuração reaberta para correção." : "Desfecho registrado.")} />}
                {status === "devolutiva" && det.apuracao.contestacao && det.apuracao.desfecho && (
                  <p className="mt-3 text-[12px] text-muted">Se o consultor contestar de novo, registre uma nova contestação abaixo.</p>
                )}
                {status === "devolutiva" && det.apuracao.contestacao && det.apuracao.desfecho && <FormContestacao ocupado={ocupado} onEnviar={(c) => acao("contestacao", "post", `${url}/contestacao`, c, "Contestação registrada.")} />}
              </Cartao>
            )}

            {status === "devolutiva" && (
              <div className="flex flex-wrap items-center justify-end gap-3">
                {det.apuracao.contestacao && !det.apuracao.desfecho && <span className="text-[12px] text-warning">Registre o desfecho da contestação antes de encerrar.</span>}
                <button
                  type="button"
                  disabled={ocupado != null || (!!det.apuracao.contestacao && !det.apuracao.desfecho)}
                  onClick={() => window.confirm(r?.efetivou && !det.ensaio ? "Este é o 10º ciclo: encerrar EFETIVA o valor do ciclo como novo Valor Hora Base. Continuar?" : "Encerrar fecha a apuração em definitivo. Continuar?") && void acao("encerrar", "post", `${url}/encerrar`, {}, "Apuração encerrada.")}
                  className={botaoPrimario}
                >
                  {ocupado === "encerrar" ? "Encerrando…" : "Encerrar apuração"}
                </button>
              </div>
            )}
            {status === "encerrado" && <p className="text-right text-[12px] text-muted">Apuração encerrada em {det.apuracao.encerradoEm ? dataBr(det.apuracao.encerradoEm) : "—"}.</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- formulários da devolutiva

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function FormDevolutiva({ ocupado, onEnviar }: { ocupado: string | null; onEnviar: (c: { devolutivaEm: string; observacao?: string }) => void }) {
  const [data, setData] = useState(hojeLocal());
  const [obs, setObs] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onEnviar({ devolutivaEm: data, observacao: obs.trim() || undefined });
      }}
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <div>
        <h3 className="font-display text-[14px] font-semibold text-foreground">Registrar a devolutiva</h3>
        <p className="mt-0.5 text-[12px] text-muted">Depois da reunião com o consultor, registre a data. É isso que libera o resultado e a memória de cálculo para ele em Meu plano.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div>
          <label htmlFor="dv-data" className={rotuloCampo}>Data da reunião</label>
          <input id="dv-data" type="date" value={data} max={hojeLocal()} onChange={(e) => setData(e.target.value)} className={campo} required />
        </div>
        <div>
          <label htmlFor="dv-obs" className={rotuloCampo}>Observação (opcional)</label>
          <input id="dv-obs" value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} className={campo} />
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={!data || ocupado != null} className={botaoPrimario}>
          {ocupado === "devolutiva" ? "Registrando…" : "Registrar devolutiva"}
        </button>
      </div>
    </form>
  );
}

function FormContestacao({ ocupado, onEnviar }: { ocupado: string | null; onEnviar: (c: { recebidaEm: string; texto: string }) => void }) {
  const [data, setData] = useState(hojeLocal());
  const [texto, setTexto] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onEnviar({ recebidaEm: data, texto: texto.trim() });
      }}
      className="mt-4 space-y-3 border-t border-border pt-4"
    >
      <h3 className="text-[13px] font-semibold text-foreground">Registrar contestação do consultor</h3>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div>
          <label htmlFor="ct-data" className={rotuloCampo}>Recebida em</label>
          <input id="ct-data" type="date" value={data} max={hojeLocal()} onChange={(e) => setData(e.target.value)} className={campo} required />
        </div>
        <div>
          <label htmlFor="ct-texto" className={rotuloCampo}>O que foi contestado</label>
          <textarea id="ct-texto" rows={2} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} className={campo} />
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={!data || texto.trim() === "" || ocupado != null} className={botaoSecundario}>
          {ocupado === "contestacao" ? "Registrando…" : "Registrar contestação"}
        </button>
      </div>
    </form>
  );
}

function FormDesfecho({ ocupado, admin, onEnviar }: { ocupado: string | null; admin: boolean; onEnviar: (c: { resultado: "mantida" | "procedente"; texto: string }) => void }) {
  const [resultado, setResultado] = useState<"mantida" | "procedente">("mantida");
  const [texto, setTexto] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onEnviar({ resultado, texto: texto.trim() });
      }}
      className="mt-4 space-y-3 border-t border-border pt-4"
    >
      <h3 className="text-[13px] font-semibold text-foreground">Desfecho da contestação</h3>
      <div role="radiogroup" aria-label="Desfecho" className="space-y-1.5 text-[13px] text-foreground">
        <label className="flex items-start gap-2">
          <input type="radio" name="desfecho" checked={resultado === "mantida"} onChange={() => setResultado("mantida")} className="mt-1" />
          <span>Apuração mantida</span>
        </label>
        <label className={`flex items-start gap-2 ${admin ? "" : "opacity-60"}`}>
          <input type="radio" name="desfecho" checked={resultado === "procedente"} disabled={!admin} onChange={() => setResultado("procedente")} className="mt-1" />
          <span>
            Contestação procedente: reabre a apuração para corrigir os lançamentos
            {!admin && <span className="block text-[12px] text-muted">Só o administrador e os gestores da Consultoria ERP e HCM reabrem uma apuração.</span>}
          </span>
        </label>
      </div>
      <div>
        <label htmlFor="ds-texto" className={rotuloCampo}>Resposta formal ao consultor</label>
        <textarea id="ds-texto" rows={2} maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} className={campo} />
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={texto.trim() === "" || ocupado != null} className={botaoPrimario}>
          {ocupado === "desfecho" ? "Registrando…" : "Registrar desfecho"}
        </button>
      </div>
    </form>
  );
}
