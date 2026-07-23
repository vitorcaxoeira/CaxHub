import axios from "axios";
import { useEffect, useState } from "react";
import { formatHoras } from "../../utils/horas";

interface SessaoPendente {
  id: number;
  atividadeId: number;
  codpro: number;
  numprj: number | null;
  cliente: string | null;
  itemDescricao: string | null;
  colunaNome: string;
  inicio: string;
  fim: string;
  duracaoMinutos: number;
  origem: string;
}

interface AtividadeResumo {
  id: number;
  codpro: number;
  itemDescricao: string | null;
}

interface ApontamentoHistorico {
  id: number;
  ratItemId: number | null;
  codpro: number;
  inicio: string;
  fim: string | null;
  duracaoMinutos: number | null;
  desati: string | null;
  confirmadoNoSenior: boolean;
  statusEnvio: string;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function formatMinutos(minutos: number): string {
  return formatHoras(minutos / 60);
}

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente de envio",
  bloqueado: "Bloqueado",
  enviado: "Enviado",
  confirmado_senior: "Confirmado no Senior",
};

const STATUS_TONE: Record<string, string> = {
  pendente: "bg-warning/15 text-warning",
  bloqueado: "bg-destructive/15 text-destructive",
  enviado: "bg-success/15 text-success",
  confirmado_senior: "bg-success/15 text-success",
};

const selectClass =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Tela do consultor: revisa as sessões que o sistema já rastreou automaticamente (ao
// mover o card pra uma coluna "em execução", ver PATCH /atividades/:id/mover) e
// confirma — só nesse momento vira um apontamento de verdade (RatItem) e entra na fila
// pro Senior. O botão "+ Apontamento manual" cobre o caso de não ter passado pelo
// Kanban (trabalho fora do CaxHub, ou esqueceu de mover o card).
export function MeusApontamentos() {
  const [sessoes, setSessoes] = useState<SessaoPendente[]>([]);
  const [historico, setHistorico] = useState<ApontamentoHistorico[]>([]);
  const [atividades, setAtividades] = useState<AtividadeResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [descricoes, setDescricoes] = useState<Record<number, string>>({});

  const [modalManual, setModalManual] = useState(false);
  const [manualAtividadeId, setManualAtividadeId] = useState("");
  const [manualData, setManualData] = useState("");
  const [manualInicio, setManualInicio] = useState("");
  const [manualFim, setManualFim] = useState("");
  const [manualDescricao, setManualDescricao] = useState("");
  const [salvandoManual, setSalvandoManual] = useState(false);
  const [erroManual, setErroManual] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    Promise.all([
      axios.get("/api/apontamentos/sessoes-pendentes"),
      axios.get("/api/apontamentos"),
      axios.get("/api/apontamentos/minhas-atividades"),
    ])
      .then(([sessoesRes, historicoRes, atividadesRes]) => {
        setSessoes(sessoesRes.data.sessoes);
        setHistorico(historicoRes.data.apontamentos);
        setAtividades(atividadesRes.data.atividades);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar apontamentos"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  async function confirmar(sessaoId: number) {
    setConfirmando(sessaoId);
    try {
      await axios.post("/api/apontamentos/confirmar", { sessaoId, descricao: descricoes[sessaoId] || undefined });
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao confirmar apontamento");
    } finally {
      setConfirmando(null);
    }
  }

  function limparFormularioManual() {
    setManualAtividadeId("");
    setManualData("");
    setManualInicio("");
    setManualFim("");
    setManualDescricao("");
    setErroManual(null);
  }

  async function salvarManual() {
    if (!manualAtividadeId || !manualData || !manualInicio || !manualFim) {
      setErroManual("Preencha atividade, data e os dois horários");
      return;
    }
    setSalvandoManual(true);
    setErroManual(null);
    try {
      await axios.post("/api/apontamentos/manual", {
        atividadeId: Number(manualAtividadeId),
        inicio: `${manualData}T${manualInicio}:00`,
        fim: `${manualData}T${manualFim}:00`,
        descricao: manualDescricao || undefined,
      });
      setModalManual(false);
      limparFormularioManual();
      carregar();
    } catch (err: any) {
      setErroManual(err.response?.data?.error ?? "Falha ao lançar apontamento");
    } finally {
      setSalvandoManual(false);
    }
  }

  async function excluir(id: number) {
    try {
      await axios.delete(`/api/apontamentos/${id}`);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir apontamento");
    }
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Meus Apontamentos
      </p>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Meus Apontamentos</h1>
          <p className="mt-1 text-sm text-muted">
            Revise o tempo rastreado nas suas atividades e confirme pra virar apontamento oficial.
          </p>
        </div>
        <button
          onClick={() => setModalManual(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Apontamento manual
        </button>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : (
        <div className="space-y-8">
          <section>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">
              Sessões pendentes de confirmação {sessoes.length > 0 && `(${sessoes.length})`}
            </p>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Proposta
                      </th>
                      <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                        Coluna
                      </th>
                      <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Início
                      </th>
                      <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                        Fim
                      </th>
                      <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Duração
                      </th>
                      <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                        Descrição
                      </th>
                      <th className="bg-surface-2 px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {sessoes.map((s) => (
                      <tr key={s.id} className="border-t border-border/60">
                        <td className="px-5 py-3.5 text-sm font-semibold text-foreground">
                          {s.codpro}
                          {s.cliente && <div className="mt-0.5 text-[11px] font-normal text-muted">{s.cliente}</div>}
                          {s.itemDescricao && (
                            <div className="max-w-[220px] truncate text-[11px] text-muted" title={s.itemDescricao}>
                              {s.itemDescricao}
                            </div>
                          )}
                        </td>
                        <td className="hidden px-5 py-3.5 text-sm text-muted md:table-cell">{s.colunaNome}</td>
                        <td className="px-5 py-3.5 font-mono text-sm text-muted">{dateTimeFormatter.format(new Date(s.inicio))}</td>
                        <td className="hidden px-5 py-3.5 font-mono text-sm text-muted sm:table-cell">
                          {dateTimeFormatter.format(new Date(s.fim))}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
                          {formatMinutos(s.duracaoMinutos)}
                        </td>
                        <td className="hidden px-5 py-3.5 lg:table-cell">
                          <input
                            type="text"
                            placeholder="Descrição (opcional)"
                            value={descricoes[s.id] ?? ""}
                            onChange={(e) => setDescricoes((atual) => ({ ...atual, [s.id]: e.target.value }))}
                            className={`${selectClass} w-full`}
                          />
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => confirmar(s.id)}
                            disabled={confirmando === s.id}
                            className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:bg-surface-2 disabled:opacity-50"
                          >
                            {confirmando === s.id ? "Confirmando..." : "Confirmar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {sessoes.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                          Nenhuma sessão pendente — mova um card pra "Em Andamento" pra começar a rastrear tempo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">Histórico de apontamentos</p>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Proposta
                      </th>
                      <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Data
                      </th>
                      <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Duração
                      </th>
                      <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                        Descrição
                      </th>
                      <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                        Status
                      </th>
                      <th className="bg-surface-2 px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((h) => (
                      <tr key={h.id} className="border-t border-border/60">
                        <td className="px-5 py-3.5 text-sm font-semibold text-foreground">{h.codpro}</td>
                        <td className="px-5 py-3.5 font-mono text-sm text-muted">{dateTimeFormatter.format(new Date(h.inicio))}</td>
                        <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-foreground">
                          {h.duracaoMinutos != null ? formatMinutos(h.duracaoMinutos) : "—"}
                        </td>
                        <td className="hidden max-w-[280px] truncate px-5 py-3.5 text-sm text-muted md:table-cell" title={h.desati ?? undefined}>
                          {h.desati ?? "—"}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span
                            className={`inline-block rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium ${
                              STATUS_TONE[h.statusEnvio] ?? "bg-muted/15 text-muted"
                            }`}
                          >
                            {STATUS_LABEL[h.statusEnvio] ?? h.statusEnvio}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {h.statusEnvio === "pendente" && (
                            <button onClick={() => excluir(h.id)} className="text-[11px] text-destructive hover:underline">
                              Excluir
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {historico.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                          Nenhum apontamento confirmado ainda.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}

      {modalManual && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-foreground">Apontamento manual</h2>
              <button
                onClick={() => {
                  setModalManual(false);
                  limparFormularioManual();
                }}
                className="text-sm text-muted hover:text-foreground"
              >
                Fechar
              </button>
            </div>
            {erroManual && (
              <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erroManual}
              </p>
            )}
            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Atividade</span>
                <select value={manualAtividadeId} onChange={(e) => setManualAtividadeId(e.target.value)} className={selectClass}>
                  <option value="">Selecione...</option>
                  {atividades.map((a) => (
                    <option key={a.id} value={a.id}>
                      Proposta {a.codpro}
                      {a.itemDescricao ? ` · ${a.itemDescricao}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Data</span>
                <input type="date" value={manualData} onChange={(e) => setManualData(e.target.value)} className={selectClass} />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] text-muted">Início</span>
                  <input type="time" value={manualInicio} onChange={(e) => setManualInicio(e.target.value)} className={selectClass} />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11px] text-muted">Fim</span>
                  <input type="time" value={manualFim} onChange={(e) => setManualFim(e.target.value)} className={selectClass} />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Descrição</span>
                <textarea
                  value={manualDescricao}
                  onChange={(e) => setManualDescricao(e.target.value)}
                  rows={2}
                  className={`${selectClass} resize-none`}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setModalManual(false);
                  limparFormularioManual();
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                onClick={salvarManual}
                disabled={salvandoManual}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {salvandoManual ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
