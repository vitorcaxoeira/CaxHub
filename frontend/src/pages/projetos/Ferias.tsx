import axios from "axios";
import { CalendarDays, ChevronDown, ChevronRight, Palmtree } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GradeDoMes, useCalendarioMes } from "../../components/calendario/pecas";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { cn } from "../../lib/cn";
import { MESES, type Aquisitivo, type Gozo, type MesDaMedia, type Simulacao, dataBr, hhhmm, hhhmmDeHoras, lerHoras, mensagemDeErro, moeda } from "../../lib/feriasCalendario";

interface LinhaResumo {
  codemp: number;
  codfor: number;
  nome: string;
  departamento: string | null;
  aquisitivoAtual: { id: number; inicio: string; fim: string; diasDireito: number; saldo: number; remunerado: boolean } | null;
  saldoTotal: number;
  emFerias: Gozo | null;
  proximasFerias: Gozo | null;
  qtdAquisitivos: number;
}

interface DetalheConsultor {
  consultor: { codemp: number; codfor: number; nome: string };
  aquisitivos: Aquisitivo[];
  folgasDescontadas: { id: number; data: string; motivo: string | null; aquisitivoId: number | null }[];
  podeLancar: boolean;
}

/** Dias corridos de início a fim (YYYY-MM-DD), inclusive, só para o texto do formulário (o servidor calcula o valor oficial). */
const diasCorridosDe = (ini: string, fim: string) => Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${ini}T00:00:00Z`)) / 86_400_000) + 1;

const campo = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground placeholder:text-muted";
const rotuloCampo = "mb-1 block text-[11.5px] text-muted";
const botaoPrimario = "rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const botaoSecundario = "rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground";

// Controle de férias dos consultores PJ (13/11/2026), no lugar da planilha "Simulação Férias PJs". O gestor do departamento (e o admin) lança o período
// AQUISITIVO (o direito) e os GOZOS (as férias tiradas); o gozo vira "Férias" no calendário do consultor e sai da meta. O valor é uma simulação gravada no gozo
// (dias úteis × horas/dia × média do % trabalhado × valor-hora): não entra sozinho na nota.
export function Ferias() {
  const [linhas, setLinhas] = useState<LinhaResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<LinhaResumo | null>(null);

  const carregar = useCallback(() => {
    setLoading(true);
    axios
      .get<{ consultores: LinhaResumo[] }>("/api/ferias/resumo")
      .then(({ data }) => {
        setLinhas(data.consultores);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar as férias")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(carregar, [carregar]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return termo ? linhas.filter((l) => l.nome.toLowerCase().includes(termo) || (l.departamento ?? "").toLowerCase().includes(termo)) : linhas;
  }, [linhas, busca]);

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Gestão de Projetos · Férias</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-foreground">Férias dos consultores</h1>
      <p className="mt-1 text-sm text-muted">
        Período aquisitivo (o direito) e férias tiradas, com o saldo de cada consultor. As férias aparecem no{" "}
        <Link to="/projetos/calendario" className="text-primary underline decoration-dotted">
          calendário
        </Link>{" "}
        do consultor e saem da meta.
      </p>

      {erro && <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>}

      <div className="mt-4">
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar consultor ou departamento…" aria-label="Buscar consultor" className={cn(campo, "max-w-sm")} />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="px-3 py-2">Consultor</th>
                <th className="px-3 py-2">Departamento</th>
                <th className="px-3 py-2">Período aquisitivo</th>
                <th className="px-3 py-2 text-right">Saldo (dias)</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2">Próximas férias</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && filtradas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted">
                    Nenhum consultor encontrado.
                  </td>
                </tr>
              )}
              {filtradas.map((l) => (
                <tr key={l.codfor} onClick={() => setAberto(l)} className="cursor-pointer border-t border-border/60 hover:bg-surface-2">
                  <td className="px-3 py-2 font-medium text-foreground">{l.nome}</td>
                  <td className="px-3 py-2 text-muted">{l.departamento ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[12.5px] text-muted">
                    {l.aquisitivoAtual ? `${dataBr(l.aquisitivoAtual.inicio)} a ${dataBr(l.aquisitivoAtual.fim)}` : "—"}
                    {l.aquisitivoAtual && !l.aquisitivoAtual.remunerado && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 font-sans text-[10.5px] text-muted">não remuneradas</span>}
                  </td>
                  <td className={cn("px-3 py-2 text-right font-mono", l.aquisitivoAtual && l.aquisitivoAtual.saldo > 0 ? "text-primary" : "text-muted")}>
                    {l.aquisitivoAtual ? l.aquisitivoAtual.saldo : "—"}
                    {l.qtdAquisitivos > 1 && <span className="ml-1 text-[11px] text-muted">(total {l.saldoTotal})</span>}
                  </td>
                  <td className="px-3 py-2">
                    {l.emFerias ? (
                      <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[11.5px] font-medium text-primary">
                        <Palmtree size={12} aria-hidden /> Em férias até {dataBr(l.emFerias.fim)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12.5px] text-muted">{l.proximasFerias ? `${dataBr(l.proximasFerias.inicio)} a ${dataBr(l.proximasFerias.fim)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {aberto && <ModalConsultor linha={aberto} onFechar={() => setAberto(null)} onMudou={carregar} />}
    </div>
  );
}

type Vista = { tipo: "detalhe" } | { tipo: "aquisitivo"; editar?: Aquisitivo } | { tipo: "gozo"; aquisitivoId: number; editar?: Gozo };

function ModalConsultor({ linha, onFechar, onMudou }: { linha: LinhaResumo; onFechar: () => void; onMudou: () => void }) {
  const toast = useToast();
  const [detalhe, setDetalhe] = useState<DetalheConsultor | null>(null);
  const [vista, setVista] = useState<Vista>({ tipo: "detalhe" });
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    axios
      .get<DetalheConsultor>(`/api/ferias/consultor/${linha.codfor}`)
      .then(({ data }) => {
        setDetalhe(data);
        setErro(null);
      })
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar o consultor")));
  }, [linha.codfor]);

  useEffect(carregar, [carregar]);

  function depois(mensagem: string) {
    toast.mostrar(mensagem, "success");
    setVista({ tipo: "detalhe" });
    carregar();
    onMudou();
  }

  async function cancelarGozo(g: Gozo) {
    if (!window.confirm(`Cancelar as férias de ${dataBr(g.inicio)} a ${dataBr(g.fim)}? Os dias voltam para o saldo e para a meta.`)) return;
    try {
      await axios.put(`/api/ferias/gozos/${g.id}`, { situacao: "cancelada" });
      depois("Férias canceladas.");
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível cancelar as férias"));
    }
  }

  async function excluirAquisitivo(a: Aquisitivo) {
    if (!window.confirm(`Excluir o período aquisitivo de ${dataBr(a.inicio)} a ${dataBr(a.fim)}?`)) return;
    try {
      await axios.delete(`/api/ferias/aquisitivos/${a.id}`);
      depois("Período aquisitivo excluído.");
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível excluir o período"));
    }
  }

  return (
    <Modal open onClose={onFechar} title={linha.nome} subtitulo={linha.departamento ?? undefined} className="max-w-3xl" fecharPorFora={vista.tipo === "detalhe"}>
      {erro && <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
      {!detalhe && !erro && <p className="text-sm text-muted">Carregando...</p>}

      {detalhe && vista.tipo === "detalhe" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {detalhe.podeLancar && (
              <button type="button" className={botaoSecundario} onClick={() => setVista({ tipo: "aquisitivo" })}>
                + Período aquisitivo
              </button>
            )}
            <Link to={`/projetos/calendario`} className={cn(botaoSecundario, "inline-flex items-center gap-1.5")}>
              <CalendarDays size={13} aria-hidden /> Abrir calendário
            </Link>
            {!detalhe.podeLancar && <span className="text-[12.5px] text-muted">Você só visualiza as férias deste consultor.</span>}
          </div>

          {detalhe.aquisitivos.length === 0 && <p className="text-sm text-muted">Nenhum período aquisitivo cadastrado.</p>}

          {detalhe.aquisitivos.map((a) => {
            const folgas = detalhe.folgasDescontadas.filter((f) => f.aquisitivoId === a.id);
            return (
              <section key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">
                      {dataBr(a.inicio)} a {dataBr(a.fim)}
                      <span className={cn("ml-2 rounded px-1.5 py-0.5 align-middle text-[10.5px] font-medium", a.remunerado ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted")}>
                        {a.remunerado ? "férias remuneradas" : "férias não remuneradas"}
                      </span>
                    </p>
                    <p className="font-mono text-[12px] text-muted">
                      direito {a.diasDireito} d · gozados {a.diasGozados} d · folgas descontadas {a.diasFolgaDescontada} d
                    </p>
                    {a.observacao && <p className="text-[12px] text-muted">{a.observacao}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("font-mono text-lg font-semibold", a.saldo > 0 ? "text-primary" : "text-muted")}>Saldo {a.saldo} d</span>
                  </div>
                </div>

                {a.gozos.length > 0 && (
                  <table className="mt-3 w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                        <th className="py-1 pr-2">Férias</th>
                        <th className="py-1 pr-2 text-right">Dias</th>
                        <th className="py-1 pr-2 text-right">Úteis</th>
                        <th className="py-1 pr-2 text-right">Valor</th>
                        <th className="py-1 pr-2">Pago em</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {a.gozos.map((g) => (
                        <tr key={g.id} className={cn("border-t border-border/60", g.situacao === "cancelada" && "text-muted line-through")}>
                          <td className="py-1.5 pr-2 font-mono">
                            {dataBr(g.inicio)} a {dataBr(g.fim)}
                          </td>
                          <td className="py-1.5 pr-2 text-right font-mono">{g.diasCorridos}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{g.diasUteis ?? "—"}</td>
                          <td className="py-1.5 pr-2 text-right font-mono" title={g.horasFerias != null ? `${hhhmmDeHoras(g.horasFerias)} h × ${g.valorHora != null ? moeda(g.valorHora) : "—"}/h` : undefined}>
                            {!a.remunerado ? "não remunerada" : g.valorFerias != null ? moeda(g.valorFerias) : "—"}
                          </td>
                          <td className="py-1.5 pr-2 font-mono">{g.competenciaPagamento ? `${g.competenciaPagamento.slice(5, 7)}/${g.competenciaPagamento.slice(0, 4)}` : "—"}</td>
                          <td className="py-1.5 text-right">
                            {g.situacao !== "cancelada" && (
                              <button
                                type="button"
                                className="mr-2 text-primary hover:underline"
                                title="Abre o aviso de férias com o demonstrativo do cálculo, para imprimir"
                                onClick={() => window.open(`/projetos/ferias/aviso/${g.id}`, "_blank", "noopener")}
                              >
                                Aviso
                              </button>
                            )}
                            {detalhe.podeLancar && g.situacao !== "cancelada" && (
                              <>
                                <button type="button" className="mr-2 text-primary hover:underline" onClick={() => setVista({ tipo: "gozo", aquisitivoId: a.id, editar: g })}>
                                  Editar
                                </button>
                                <button type="button" className="text-destructive hover:underline" onClick={() => cancelarGozo(g)}>
                                  Cancelar
                                </button>
                              </>
                            )}
                            {g.situacao === "cancelada" && <span className="no-underline">cancelada</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {folgas.length > 0 && (
                  <p className="mt-2 text-[12px] text-muted">
                    Folgas descontadas do saldo: {folgas.map((f) => `${dataBr(f.data)}${f.motivo ? ` (${f.motivo})` : ""}`).join(", ")}
                  </p>
                )}

                {detalhe.podeLancar && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={botaoSecundario} onClick={() => setVista({ tipo: "gozo", aquisitivoId: a.id })}>
                      + Lançar férias
                    </button>
                    <button type="button" className={botaoSecundario} onClick={() => setVista({ tipo: "aquisitivo", editar: a })}>
                      Editar período
                    </button>
                    {a.gozos.length === 0 && (
                      <button type="button" className={cn(botaoSecundario, "hover:text-destructive")} onClick={() => excluirAquisitivo(a)}>
                        Excluir período
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {detalhe && vista.tipo === "aquisitivo" && (
        <FormAquisitivo consultor={detalhe.consultor} editar={vista.editar} onVoltar={() => setVista({ tipo: "detalhe" })} onSalvo={(mensagem) => depois(mensagem ?? "Período aquisitivo salvo.")} />
      )}
      {detalhe && vista.tipo === "gozo" && (
        <FormGozo consultor={detalhe.consultor} aquisitivos={detalhe.aquisitivos} aquisitivoId={vista.aquisitivoId} editar={vista.editar} onVoltar={() => setVista({ tipo: "detalhe" })} onSalvo={() => depois("Férias lançadas.")} />
      )}
    </Modal>
  );
}

function FormAquisitivo({
  consultor,
  editar,
  onVoltar,
  onSalvo,
}: {
  consultor: { codemp: number; codfor: number; nome: string };
  editar?: Aquisitivo;
  onVoltar: () => void;
  onSalvo: (mensagem?: string) => void;
}) {
  const [inicio, setInicio] = useState(editar?.inicio ?? "");
  const [fim, setFim] = useState(editar?.fim ?? "");
  const [remunerado, setRemunerado] = useState(editar?.remunerado ?? true);
  const [dias, setDias] = useState(String(editar?.diasDireito ?? 20));
  const [obs, setObs] = useState(editar?.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Atalho: o contrato mais comum é "12 meses -> 20 dias"; contratos de 6 meses dão 10 dias.
  function sugerirFim(meses: number, direito: number) {
    if (!inicio) return;
    const d = new Date(`${inicio}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + meses);
    setFim(d.toISOString().slice(0, 10));
    setDias(String(direito));
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = { codemp: consultor.codemp, codfor: consultor.codfor, inicio, fim, diasDireito: Number(dias), remunerado, observacao: obs.trim() || null };
      let aviso: string | undefined;
      if (editar) {
        const { data } = await axios.put<{ gozosSemValor?: number; precisaRecalcular?: boolean }>(`/api/ferias/aquisitivos/${editar.id}`, corpo);
        if (data.gozosSemValor) aviso = `Período salvo. ${data.gozosSemValor} lançamento(s) de férias perderam o valor calculado (férias não remuneradas).`;
        else if (data.precisaRecalcular) aviso = "Período salvo. Use \"Editar\" nas férias já lançadas para calcular o valor.";
      } else await axios.post("/api/ferias/aquisitivos", corpo);
      onSalvo(aviso);
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível salvar o período"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-medium text-foreground">{editar ? "Editar período aquisitivo" : "Novo período aquisitivo"}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label>
          <span className={rotuloCampo}>Início</span>
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={campo} />
        </label>
        <label>
          <span className={rotuloCampo}>Fim</span>
          <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className={campo} />
        </label>
        <label>
          <span className={rotuloCampo}>Dias de direito (corridos)</span>
          <input type="number" min={1} max={60} value={dias} onChange={(e) => setDias(e.target.value)} className={campo} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={botaoSecundario} disabled={!inicio} onClick={() => sugerirFim(12, 20)}>
          12 meses = 20 dias
        </button>
        <button type="button" className={botaoSecundario} disabled={!inicio} onClick={() => sugerirFim(6, 10)}>
          6 meses = 10 dias
        </button>
      </div>
      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 font-mono text-[10px] uppercase tracking-widest text-muted">Férias remuneradas?</legend>
        <div className="flex gap-5">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="remunerado" checked={remunerado} onChange={() => setRemunerado(true)} className="accent-primary" /> Sim, o contrato paga as férias
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="remunerado" checked={!remunerado} onChange={() => setRemunerado(false)} className="accent-primary" /> Não
          </label>
        </div>
        <p className="mt-1 text-[12px] text-muted">
          {remunerado
            ? "Cada lançamento de férias deste período calcula o valor (dias úteis × horas/dia × média do % trabalhado × valor-hora)."
            : "As férias deste período só marcam os dias no calendário e consomem o saldo; não há valor a calcular nem a pagar."}
        </p>
      </fieldset>
      <label className="block">
        <span className={rotuloCampo}>Observação (opcional)</span>
        <input type="text" maxLength={300} value={obs} onChange={(e) => setObs(e.target.value)} className={campo} />
      </label>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={botaoSecundario} onClick={onVoltar}>
          Voltar
        </button>
        <button type="button" className={botaoPrimario} onClick={salvar} disabled={salvando || !inicio || !fim}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

const chaveMes = (m: { ano: number; mes: number }) => `${m.ano}-${String(m.mes).padStart(2, "0")}`;
const pctTexto = (p: number) => `${Math.round(p * 1000) / 10}%`;

/** Os dias úteis que já vêm ajustados num gozo gravado (só os meses em que o valor foi trocado do padrão). */
function ajustesGravados(meses: MesDaMedia[] | null | undefined): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const m of meses ?? []) {
    if (m.diasUteis != null && m.diasUteisPadrao != null && m.diasUteis !== m.diasUteisPadrao) saida[chaveMes(m)] = String(m.diasUteis);
  }
  return saida;
}

/** Os ajustes digitados no formato da API ({ "AAAA-MM": n }); sem ajuste, undefined (vale o padrão). */
function diasMesParaEnvio(diasMes: Record<string, string>): Record<string, number> | undefined {
  const saida: Record<string, number> = {};
  for (const [chave, texto] of Object.entries(diasMes)) {
    const n = Number(texto);
    if (texto.trim() !== "" && Number.isInteger(n) && n >= 0) saida[chave] = n;
  }
  return Object.keys(saida).length > 0 ? saida : undefined;
}

/**
 * Os 12 meses da média, com os dias úteis disponíveis editáveis (o gestor ajusta; vazio = padrão), as horas, a base e o % de cada mês. Mês com 0 dias fica
 * fora da média. O botão do calendário abre o mês em outra aba, no calendário do consultor.
 */
function TabelaMeses({
  meses,
  horasDia,
  mediaUsada,
  codfor,
  diasMes,
  onMudar,
}: {
  meses: MesDaMedia[];
  horasDia: number;
  mediaUsada: number;
  codfor: number;
  diasMes: Record<string, string>;
  onMudar: (atualizar: (d: Record<string, string>) => Record<string, string>) => void;
}) {
  const definir = (chave: string, texto: string) =>
    onMudar((d) => {
      const proximo = { ...d };
      if (texto.trim() === "") delete proximo[chave];
      else proximo[chave] = texto;
      return proximo;
    });
  const naMediaQtd = meses.filter((m) => m.naMedia ?? (m.diasUteis ?? 0) > 0).length;
  // Do mês mais recente para o mais antigo (o mais próximo das férias primeiro).
  const ordenados = [...meses].sort((a, b) => b.ano * 12 + b.mes - (a.ano * 12 + a.mes));
  // Mês cujo calendário está aberto no modal.
  const [calendario, setCalendario] = useState<{ ano: number; mes: number } | null>(null);
  // A tabela começa recolhida: a média usada fica sempre visível e o gestor abre os meses quando quer conferir ou ajustar.
  const [aberto, setAberto] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted hover:text-foreground"
      >
        {aberto ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        Meses considerados na média ({meses.length})
      </button>
      {aberto && (
      <div className="mt-1 overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
              <th className="py-1 pr-2">Mês</th>
              <th className="py-1 pr-2 text-right">Dias úteis disponíveis</th>
              <th className="py-1 pr-2 text-right">Horas</th>
              <th className="py-1 pr-2 text-right">Base</th>
              <th className="py-1 pr-2 text-right">% do mês</th>
              <th className="py-1 pr-2 text-right">Calendário</th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((m) => {
              const chave = chaveMes(m);
              const padrao = m.diasUteisPadrao ?? 0;
              const dias = m.diasUteis ?? padrao;
              const naMedia = m.naMedia ?? dias > 0;
              const ajustado = (diasMes[chave] ?? "").trim() !== "";
              const rotulo = `${String(m.mes).padStart(2, "0")}/${m.ano}`;
              const feriados = (m.feriados ?? []).map((f) => `${f.data.slice(8)}/${f.data.slice(5, 7)} ${f.nome}`).join(" · ");
              return (
                <tr key={chave} className={cn("border-t border-border/60", !naMedia && "text-muted")}>
                  <td className="py-1.5 pr-2 font-mono">
                    {rotulo}
                    <span className="ml-1 font-sans text-[11px] text-muted">{MESES[m.mes - 1]}</span>
                    {!naMedia && <span className="ml-2 font-sans text-[11px] text-muted">fora da média</span>}
                    {feriados && <p className="font-sans text-[11px] text-muted">{feriados}</p>}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <span className="inline-flex items-center justify-end gap-2">
                      <input
                        inputMode="numeric"
                        aria-label={`Dias úteis disponíveis em ${rotulo}`}
                        value={diasMes[chave] ?? ""}
                        placeholder={String(padrao)}
                        onChange={(e) => definir(chave, e.target.value.replace(/\D/g, "").slice(0, 2))}
                        className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono text-sm text-foreground placeholder:text-muted"
                      />
                      {ajustado && (
                        <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => definir(chave, "")} title={`Voltar para ${padrao} dia(s) úteis`}>
                          padrão
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono">{hhhmm(m.minutos)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{hhhmmDeHoras(dias * horasDia)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{naMedia ? pctTexto(m.pct) : "—"}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <button
                      type="button"
                      aria-label={`Abrir o calendário de ${rotulo}`}
                      title="Abre o calendário deste mês, com as horas trabalhadas"
                      className="inline-flex items-center text-primary hover:opacity-80"
                      onClick={() => setCalendario({ ano: m.ano, mes: m.mes })}
                    >
                      <CalendarDays size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      <p className="mt-2 text-[12px] text-muted">
        Média usada: <span className="font-mono text-foreground">{pctTexto(mediaUsada)}</span> · {naMediaQtd} de {meses.length} meses entram. Mês com 0 dias úteis
        disponíveis sai da média; ao ajustar os dias, a simulação refaz sozinha.
      </p>
      {calendario && <ModalCalendarioMes ano={calendario.ano} mes={calendario.mes} codfor={codfor} onFechar={() => setCalendario(null)} />}
    </div>
  );
}

/**
 * O calendário de um mês da média, só para consulta: a mesma grade da Home do consultor (férias, folgas e feriados), com as horas trabalhadas em cada dia e o
 * total do mês. Clicar num dia não faz nada aqui (folga se marca na página Calendário).
 */
function ModalCalendarioMes({ ano, mes, codfor, onFechar }: { ano: number; mes: number; codfor: number; onFechar: () => void }) {
  const { dados, loading, erro, feriados } = useCalendarioMes(ano, mes, codfor);
  return (
    <Modal open onClose={onFechar} title={`${MESES[mes - 1]} ${ano}`} subtitulo={dados?.consultor.nome} className="max-w-3xl">
      {erro && <p className="mb-3 text-sm text-destructive">{erro}</p>}
      {dados && (
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface px-4 py-2">
            <p className="text-[11px] text-muted">Horas trabalhadas</p>
            <p className="font-mono text-lg font-semibold text-foreground">{hhhmm(dados.totais.apontadoMinutos)}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-2">
            <p className="text-[11px] text-muted">Meta do mês</p>
            <p className="font-mono text-lg font-semibold text-foreground">{hhhmm(dados.totais.metaMinutos)}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-2">
            <p className="text-[11px] text-muted">Dias com horas</p>
            <p className="font-mono text-lg font-semibold text-foreground">{dados.dias.filter((d) => d.apontadoMinutos > 0).length}</p>
          </div>
        </div>
      )}
      <GradeDoMes dados={dados} loading={loading} feriados={feriados} onDia={() => undefined} compacto />
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-primary/40" /> Férias
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-warning/40" /> Folga
        </span>
        <span>
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-muted" /> Feriado
        </span>
        <span>As horas em cada dia são as trabalhadas.</span>
      </p>
    </Modal>
  );
}

function FormGozo({
  consultor,
  aquisitivos,
  aquisitivoId,
  editar,
  onVoltar,
  onSalvo,
}: {
  consultor: { codemp: number; codfor: number; nome: string };
  aquisitivos: Aquisitivo[];
  aquisitivoId: number;
  editar?: Gozo;
  onVoltar: () => void;
  onSalvo: () => void;
}) {
  const [aqId, setAqId] = useState(aquisitivoId);
  const [inicio, setInicio] = useState(editar?.inicio ?? "");
  const [fim, setFim] = useState(editar?.fim ?? "");
  const [competencia, setCompetencia] = useState(editar?.competenciaPagamento?.slice(0, 7) ?? "");
  const [obs, setObs] = useState(editar?.observacao ?? "");
  // Ajustes do gestor sobre a simulação: vazio = usa o calculado.
  const [horasDia, setHorasDia] = useState("");
  const [mediaPct, setMediaPct] = useState("");
  const [valorHora, setValorHora] = useState("");
  // Dias úteis disponíveis ajustados por mês da média ("AAAA-MM" -> texto digitado). Vazio = o padrão (dias úteis com feriados nacionais descontados).
  const [diasMes, setDiasMes] = useState<Record<string, string>>(() => ajustesGravados(editar?.mesesMedia));
  const [sim, setSim] = useState<Simulacao | null>(null);
  const [simErro, setSimErro] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [excede, setExcede] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const aquisitivo = aquisitivos.find((a) => a.id === aqId);
  // Período sem férias remuneradas: o gozo só marca os dias; nada de simulação, valor nem mês de pagamento.
  const remunerado = aquisitivo?.remunerado !== false;

  const numero = (t: string) => (t.trim() === "" ? null : Number(t.replace(",", ".")));

  // Datas incoerentes (fim antes do início) e a conta dos dias, valem com ou sem remuneração: o calendário e o saldo dependem só das datas.
  const datasInvertidas = Boolean(inicio && fim && fim < inicio);
  const datasOk = Boolean(inicio && fim && !datasInvertidas);
  const diasCorridos = datasOk ? diasCorridosDe(inicio, fim) : 0;
  const saldoDisponivel = aquisitivo ? aquisitivo.saldo + (editar && editar.situacao !== "cancelada" ? editar.diasCorridos : 0) : 0;
  const excedeSaldo = datasOk && Boolean(aquisitivo) && diasCorridos > saldoDisponivel;

  // Simula sozinho quando as datas estão completas e quando o gestor ajusta um número (espera a digitação parar). Sem férias remuneradas a chamada só traz os dias
  // úteis (o valor não é usado nem gravado).
  useEffect(() => {
    if (!datasOk) {
      setSim(null);
      return;
    }
    const t = window.setTimeout(() => {
      axios
        .post<Simulacao>("/api/ferias/simular", { codfor: consultor.codfor, inicio, fim, horasDia: lerHoras(horasDia), mediaPct: numero(mediaPct), valorHora: numero(valorHora), diasUteisMes: diasMesParaEnvio(diasMes), somenteDias: !remunerado })
        .then(({ data }) => {
          setSim(data);
          setSimErro(null);
        })
        .catch((err) => setSimErro(mensagemDeErro(err, "Não foi possível simular o valor")));
    }, 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicio, fim, horasDia, mediaPct, valorHora, diasMes, consultor.codfor, remunerado, datasOk]);

  async function salvar(permitirExcedente = false) {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = {
        inicio,
        fim,
        observacao: obs.trim() || null,
        competenciaPagamento: remunerado ? competencia || null : null,
        horasDia: lerHoras(horasDia),
        mediaPct: numero(mediaPct),
        valorHora: numero(valorHora),
        diasUteisMes: diasMesParaEnvio(diasMes),
        permitirExcedente,
      };
      if (editar) await axios.put(`/api/ferias/gozos/${editar.id}`, { ...corpo, recalcular: true });
      else await axios.post("/api/ferias/gozos", { ...corpo, aquisitivoId: aqId });
      onSalvo();
    } catch (err) {
      const dados = (err as { response?: { data?: { error?: string; excedeSaldo?: boolean } } }).response?.data;
      setExcede(dados?.excedeSaldo === true);
      setErro(dados?.error ?? "Não foi possível salvar as férias");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-medium text-foreground">{editar ? "Editar férias" : "Lançar férias"}</p>
      {!editar && (
        <label className="block">
          <span className={rotuloCampo}>Período aquisitivo</span>
          <select value={aqId} onChange={(e) => setAqId(Number(e.target.value))} className={campo}>
            {aquisitivos.map((a) => (
              <option key={a.id} value={a.id}>
                {dataBr(a.inicio)} a {dataBr(a.fim)} — saldo {a.saldo} d{a.remunerado ? "" : " (não remuneradas)"}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label>
          <span className={rotuloCampo}>Início</span>
          <input
            type="date"
            value={inicio}
            onChange={(e) => {
              setInicio(e.target.value);
              // Fim antes do novo início não faz sentido: o fim acompanha o início (o gestor ajusta depois).
              if (fim && e.target.value && fim < e.target.value) setFim(e.target.value);
            }}
            className={campo}
          />
        </label>
        <label>
          <span className={rotuloCampo}>Fim</span>
          <input type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} className={campo} />
        </label>
        {remunerado && (
          <label>
            <span className={rotuloCampo}>Pago na nota de (mês)</span>
            <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} className={campo} />
          </label>
        )}
      </div>
      {datasInvertidas && <p className="text-[12.5px] text-destructive">O fim das férias não pode ser antes do início.</p>}
      {datasOk && aquisitivo && (
        <p className={cn("text-[12.5px]", excedeSaldo ? "text-warning" : "text-muted")}>
          {diasCorridos} dia(s) corridos{sim ? `, ${sim.diasUteis} úteis` : ""}. Saldo do período: {saldoDisponivel} dia(s){excedeSaldo ? ` — faltam ${diasCorridos - saldoDisponivel}` : ` — sobram ${saldoDisponivel - diasCorridos}`}.
        </p>
      )}

      {!remunerado && (
        <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-[12.5px] text-muted">
          <p className="font-mono text-[10px] uppercase tracking-widest">Férias não remuneradas</p>
          <p className="mt-1">
            Este período não tem férias remuneradas no contrato: o lançamento só marca os dias no calendário (que saem da meta) e consome o saldo de dias. Não há valor a calcular.
          </p>
        </div>
      )}
      {remunerado && (
      <div className="rounded-lg border border-border p-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Valor das férias (simulação)</p>
        {!sim && <p className="mt-2 text-[12.5px] text-muted">Informe o início e o fim para simular.</p>}
        {simErro && <p className="mt-2 text-sm text-destructive">{simErro}</p>}
        {sim && (
          <div className="mt-2 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label>
                <span className={rotuloCampo}>Horas por dia útil (hhh:mm)</span>
                <input value={horasDia} onChange={(e) => setHorasDia(e.target.value)} placeholder={hhhmmDeHoras(sim.horasDia)} className={campo} />
              </label>
              <label>
                <span className={rotuloCampo}>Média do % trabalhado</span>
                <input inputMode="decimal" value={mediaPct} onChange={(e) => setMediaPct(e.target.value)} placeholder={String(sim.mediaPct)} className={campo} />
              </label>
              <label>
                <span className={rotuloCampo}>Valor-hora (R$)</span>
                <input inputMode="decimal" value={valorHora} onChange={(e) => setValorHora(e.target.value)} placeholder={sim.valorHora != null ? String(sim.valorHora) : "sem contrato por hora"} className={campo} />
              </label>
            </div>
            <p className="font-mono text-[12.5px] text-muted">
              {sim.diasUteis} dias úteis × {hhhmmDeHoras(sim.horasDia)} × {sim.mediaPct} = {hhhmmDeHoras(sim.horasFerias)}
              {sim.valorHora != null && sim.valorFerias != null && (
                <>
                  {" "}
                  × {moeda(sim.valorHora)} = <span className="text-base font-semibold text-foreground">{moeda(sim.valorFerias)}</span>
                </>
              )}
            </p>
            {sim.valorHora == null && <p className="text-[12px] text-muted">Consultor sem valor-hora (contrato fixo ou sem contrato): informe o valor-hora se quiser o cálculo.</p>}
            {sim.meses.length > 0 && <TabelaMeses meses={sim.meses} horasDia={sim.horasDia} mediaUsada={sim.mediaPct} codfor={consultor.codfor} diasMes={diasMes} onMudar={setDiasMes} />}
          </div>
        )}
      </div>
      )}

      <label className="block">
        <span className={rotuloCampo}>Observação (opcional)</span>
        <input type="text" maxLength={300} value={obs} onChange={(e) => setObs(e.target.value)} className={campo} />
      </label>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={botaoSecundario} onClick={onVoltar}>
          Voltar
        </button>
        {excede && (
          <button type="button" className={botaoSecundario} onClick={() => salvar(true)} disabled={salvando}>
            Lançar mesmo assim
          </button>
        )}
        <button type="button" className={botaoPrimario} onClick={() => salvar(false)} disabled={salvando || !datasOk}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}
