import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";

interface Opcao {
  value: number | string;
  label: string;
}

interface Rota {
  id: number;
  desrot: string;
  kmtrot: number | null;
  horrot: number | null;
}

interface DespesaLancada {
  id: number;
  datemi: string | null;
  desrdv: string | null;
  tipdesLabel: string;
  moddesLabel: string | null;
  qtdrdv: number | null;
  vlrunt: number | null;
  vlrtot: number | null;
  hordes: number | null;
  fatrdvLabel: string;
  pendenteDeEnvio: boolean;
  podeExcluir: boolean;
}

interface RespostaDespesas {
  podeLancar: boolean;
  despesas: DespesaLancada[];
  rotas: Rota[];
  opcoesTipo: Opcao[];
  opcoesModalidade: Opcao[];
}

interface ModalDespesasRatProps {
  ratId: number;
  ratLabel: string;
  onFechar: () => void;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number | null) => (v == null ? "—" : `R$ ${currency.format(v)}`);
const formatData = (v: string | null) => (v ? dateFormatter.format(new Date(v)) : "—");
const hojeInput = () => new Date().toISOString().slice(0, 10);

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted";

export function ModalDespesasRat({ ratId, ratLabel, onFechar }: ModalDespesasRatProps) {
  const [dados, setDados] = useState<RespostaDespesas | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<"despesa" | "deslocamento">("despesa");
  const [salvando, setSalvando] = useState(false);

  // Formulário "Despesas"
  const [tipdes, setTipdes] = useState<number | "">("");
  const [descDespesa, setDescDespesa] = useState("");
  const [qtdDespesa, setQtdDespesa] = useState("1");
  const [unitDespesa, setUnitDespesa] = useState("");
  const [fatura, setFatura] = useState<"S" | "N">("S");
  const [dataDespesa, setDataDespesa] = useState(hojeInput());

  // Formulário "Deslocamento"
  const [rotaId, setRotaId] = useState<number | "">("");
  const [moddes, setModdes] = useState<string>("");
  const [descDeslocamento, setDescDeslocamento] = useState("");
  const [dataDeslocamento, setDataDeslocamento] = useState(hojeInput());
  const [qtdDeslocamento, setQtdDeslocamento] = useState("");
  const [unitDeslocamento, setUnitDeslocamento] = useState("");
  const [horasDeslocamento, setHorasDeslocamento] = useState("");

  function carregar() {
    setLoading(true);
    axios
      .get(`/api/rats/${ratId}/despesas`)
      .then(({ data }) => {
        setDados(data);
        setErro(null);
        if (data.opcoesTipo.length > 0 && tipdes === "") setTipdes(data.opcoesTipo[0].value);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar despesas"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratId]);

  const totalDespesa = useMemo(() => {
    const q = Number(qtdDespesa);
    const u = Number(unitDespesa);
    return Number.isFinite(q) && Number.isFinite(u) ? q * u : 0;
  }, [qtdDespesa, unitDespesa]);

  const totalDeslocamento = useMemo(() => {
    const q = Number(qtdDeslocamento);
    const u = Number(unitDeslocamento);
    return Number.isFinite(q) && Number.isFinite(u) ? q * u : 0;
  }, [qtdDeslocamento, unitDeslocamento]);

  function selecionarRota(idStr: string) {
    const id = idStr === "" ? "" : Number(idStr);
    setRotaId(id);
    const rota = dados?.rotas.find((r) => r.id === id);
    if (rota) {
      // Pré-preenche, mas continua editável — só a quantidade tem base provada (km da
      // rota); valor unitário e horas ficam em branco até a regra de cálculo ser definida.
      if (descDeslocamento.trim() === "") setDescDeslocamento(rota.desrot);
      // qtdrdv é Int no banco — arredonda aqui pra mostrar já o valor que de fato vai ser
      // gravado (o backend também arredonda antes de calcular vlrtot, mas o campo exibido
      // não pode ficar mostrando "239.1" enquanto o total já reflete "239").
      if (rota.kmtrot != null) setQtdDeslocamento(String(Math.round(rota.kmtrot)));
    }
  }

  async function lancarDespesa() {
    setSalvando(true);
    setErro(null);
    try {
      await axios.post(`/api/rats/${ratId}/despesas`, {
        aba: "despesa",
        tipdes,
        desrdv: descDespesa.trim(),
        qtdrdv: Number(qtdDespesa),
        vlrunt: Number(unitDespesa),
        fatrdv: fatura,
        datemi: dataDespesa,
      });
      setDescDespesa("");
      setQtdDespesa("1");
      setUnitDespesa("");
      setFatura("S");
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao lançar a despesa");
    } finally {
      setSalvando(false);
    }
  }

  async function lancarDeslocamento() {
    setSalvando(true);
    setErro(null);
    try {
      await axios.post(`/api/rats/${ratId}/despesas`, {
        aba: "deslocamento",
        rotid: rotaId,
        moddes,
        desrdv: descDeslocamento.trim(),
        qtdrdv: Number(qtdDeslocamento),
        vlrunt: Number(unitDeslocamento),
        hordes: horasDeslocamento === "" ? undefined : Number(horasDeslocamento),
        datemi: dataDeslocamento,
      });
      setRotaId("");
      setModdes("");
      setDescDeslocamento("");
      setQtdDeslocamento("");
      setUnitDeslocamento("");
      setHorasDeslocamento("");
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao lançar o deslocamento");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(despesaId: number) {
    if (!window.confirm("Excluir esta despesa? Só é possível porque ainda não foi enviada ao Senior.")) return;
    try {
      await axios.delete(`/api/rats/despesas/${despesaId}`);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir a despesa");
    }
  }

  const tabClass = (ativa: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      ativa ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

  return (
    <Modal open onClose={onFechar} title="Despesas de Viagem" subtitulo={ratLabel} className="max-w-2xl" fecharPorFora={false}>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : !dados?.podeLancar ? (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Esta RAT ainda não tem número do ERP — não é possível lançar despesa ainda.
        </p>
      ) : (
        <>
          {erro && (
            <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>
          )}

          {dados.despesas.length > 0 && (
            <div className="mb-4 overflow-hidden rounded-md border border-border">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-surface-2">
                    <th className="px-2.5 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Data</th>
                    <th className="px-2.5 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Tipo</th>
                    <th className="px-2.5 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Descrição</th>
                    <th className="px-2.5 py-1.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Total</th>
                    <th className="px-2.5 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {dados.despesas.map((d) => (
                    <tr key={d.id} className="border-t border-border/60">
                      <td className="px-2.5 py-1.5 font-mono text-[12px] text-muted">{formatData(d.datemi)}</td>
                      <td className="px-2.5 py-1.5 text-[12px] text-muted">
                        {d.tipdesLabel}
                        {d.moddesLabel && <span className="text-muted/70"> · {d.moddesLabel}</span>}
                      </td>
                      <td className="max-w-[180px] truncate px-2.5 py-1.5 text-[12px] text-foreground" title={d.desrdv ?? undefined}>
                        {d.desrdv ?? "—"}
                        {d.pendenteDeEnvio && (
                          <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-medium text-warning">
                            Pendente de envio
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">{formatMoney(d.vlrtot)}</td>
                      <td className="px-2.5 py-1.5 text-right">
                        {d.podeExcluir && (
                          <button onClick={() => excluir(d.id)} className="text-[11px] text-destructive hover:underline">
                            Excluir
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mb-4 flex gap-1 rounded-md border border-border p-1" style={{ width: "fit-content" }}>
            <button onClick={() => setAba("despesa")} className={tabClass(aba === "despesa")}>
              Despesas
            </button>
            <button onClick={() => setAba("deslocamento")} className={tabClass(aba === "deslocamento")}>
              Deslocamento
            </button>
          </div>

          {aba === "despesa" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Tipo</label>
                  <select value={tipdes} onChange={(e) => setTipdes(Number(e.target.value))} className={inputClass}>
                    {dados.opcoesTipo.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Data</label>
                  <input type="date" value={dataDespesa} onChange={(e) => setDataDespesa(e.target.value)} className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Descrição</label>
                <input value={descDespesa} onChange={(e) => setDescDespesa(e.target.value)} className={inputClass} placeholder="Ex.: Almoço" />
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className={labelClass}>Quantidade</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={qtdDespesa}
                    onChange={(e) => setQtdDespesa(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Valor Unit.</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={unitDespesa}
                    onChange={(e) => setUnitDespesa(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Valor Total</label>
                  <input value={currency.format(totalDespesa)} disabled className={`${inputClass} cursor-not-allowed bg-surface-2 text-muted`} />
                </div>
                <div>
                  <label className={labelClass}>Fatura</label>
                  <select value={fatura} onChange={(e) => setFatura(e.target.value as "S" | "N")} className={inputClass}>
                    <option value="S">Sim</option>
                    <option value="N">Não</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={lancarDespesa}
                  disabled={salvando || descDespesa.trim() === "" || Number(qtdDespesa) <= 0 || unitDespesa === ""}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {salvando ? "Lançando..." : "Lançar despesa"}
                </button>
              </div>
            </div>
          )}

          {aba === "deslocamento" && (
            <div className="space-y-3">
              {dados.rotas.length === 0 ? (
                <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
                  Não há rota cadastrada para o cliente desta RAT — fale com quem cadastra rotas no ERP se precisar lançar
                  deslocamento por rota nesta viagem.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Rota</label>
                      <select value={rotaId} onChange={(e) => selecionarRota(e.target.value)} className={inputClass}>
                        <option value="">Selecione...</option>
                        {dados.rotas.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.desrot} {r.kmtrot != null ? `(${r.kmtrot} km)` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Modalidade</label>
                      <select value={moddes} onChange={(e) => setModdes(e.target.value)} className={inputClass}>
                        <option value="">Selecione...</option>
                        {dados.opcoesModalidade.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Descrição</label>
                      <input value={descDeslocamento} onChange={(e) => setDescDeslocamento(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Data</label>
                      <input type="date" value={dataDeslocamento} onChange={(e) => setDataDeslocamento(e.target.value)} className={inputClass} />
                    </div>
                  </div>
                  {/* Os 3 campos abaixo ficam editáveis por ora — só Quantidade tem regra
                      provada (pré-preenchida com o km da rota ao selecionar); Valor Unitário e
                      Horas de Deslocamento aguardam a regra de cálculo automático. */}
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <label className={labelClass}>Quantidade (km)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={qtdDeslocamento}
                        onChange={(e) => setQtdDeslocamento(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Valor Unit.</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={unitDeslocamento}
                        onChange={(e) => setUnitDeslocamento(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Valor Total</label>
                      <input
                        value={currency.format(totalDeslocamento)}
                        disabled
                        className={`${inputClass} cursor-not-allowed bg-surface-2 text-muted`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Horas Desloc.</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={horasDeslocamento}
                        onChange={(e) => setHorasDeslocamento(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={lancarDeslocamento}
                      disabled={salvando || rotaId === "" || moddes === "" || Number(qtdDeslocamento) <= 0 || unitDeslocamento === ""}
                      className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {salvando ? "Lançando..." : "Lançar deslocamento"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex justify-end border-t border-border pt-3">
        <button
          onClick={onFechar}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Fechar
        </button>
      </div>
    </Modal>
  );
}
