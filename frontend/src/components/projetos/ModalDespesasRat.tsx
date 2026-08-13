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
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted";
const fieldErrorClass = "mt-1 text-xs text-destructive";

export function ModalDespesasRat({ ratId, ratLabel, onFechar }: ModalDespesasRatProps) {
  const [dados, setDados] = useState<RespostaDespesas | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [aba, setAba] = useState<"despesa" | "deslocamento">("despesa");
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [tentouEnviar, setTentouEnviar] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Formulário "Despesa avulsa"
  const [tipdes, setTipdes] = useState<number | "">("");
  const [descDespesa, setDescDespesa] = useState("");
  const [qtdDespesa, setQtdDespesa] = useState("1");
  const [unitDespesa, setUnitDespesa] = useState("");
  const [fatura, setFatura] = useState<"S" | "N">("S");
  const [dataDespesa, setDataDespesa] = useState(hojeInput());

  // Formulário "Deslocamento por rota"
  const [rotaId, setRotaId] = useState<number | "">("");
  const [moddes, setModdes] = useState<string>("");
  const [descDeslocamento, setDescDeslocamento] = useState("");
  const [dataDeslocamento, setDataDeslocamento] = useState(hojeInput());
  const [qtdDeslocamento, setQtdDeslocamento] = useState("");
  const [unitDeslocamento, setUnitDeslocamento] = useState("");
  const [horasDeslocamento, setHorasDeslocamento] = useState("");

  function carregar(mostrarLoading = true) {
    if (mostrarLoading) setLoading(true);
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

  const rotaSelecionada = dados?.rotas.find((rota) => rota.id === rotaId) ?? null;
  const totalLancado = useMemo(() => dados?.despesas.reduce((total, despesa) => total + (despesa.vlrtot ?? 0), 0) ?? 0, [dados]);
  const pendentesDeEnvio = dados?.despesas.filter((despesa) => despesa.pendenteDeEnvio).length ?? 0;

  const despesaInvalida = {
    descricao: descDespesa.trim() === "",
    quantidade: !Number.isFinite(Number(qtdDespesa)) || Number(qtdDespesa) <= 0,
    unitario: unitDespesa === "" || !Number.isFinite(Number(unitDespesa)) || Number(unitDespesa) < 0,
  };
  const deslocamentoInvalido = {
    rota: rotaId === "",
    modalidade: moddes === "",
    descricao: descDeslocamento.trim() === "",
    quantidade: !Number.isFinite(Number(qtdDeslocamento)) || Number(qtdDeslocamento) <= 0,
    unitario: unitDeslocamento === "" || !Number.isFinite(Number(unitDeslocamento)) || Number(unitDeslocamento) < 0,
  };
  const formularioDespesaValido = !Object.values(despesaInvalida).some(Boolean);
  const formularioDeslocamentoValido = !Object.values(deslocamentoInvalido).some(Boolean);

  function selecionarRota(idStr: string) {
    const id = idStr === "" ? "" : Number(idStr);
    setRotaId(id);
    const rota = dados?.rotas.find((item) => item.id === id);
    if (rota) {
      // Pré-preenche, mas continua editável: só a quantidade tem base provada (km da rota).
      if (descDeslocamento.trim() === "") setDescDeslocamento(rota.desrot);
      // qtdrdv é Int no banco; a tela já mostra o mesmo valor inteiro que será gravado.
      if (rota.kmtrot != null) setQtdDeslocamento(String(Math.round(rota.kmtrot)));
    }
  }

  async function lancarDespesa() {
    setSalvando(true);
    setErro(null);
    setSucesso(null);
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
      setTentouEnviar(false);
      setSucesso("Despesa lançada. Você já pode incluir a próxima.");
      carregar(false);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao lançar a despesa");
    } finally {
      setSalvando(false);
    }
  }

  async function lancarDeslocamento() {
    setSalvando(true);
    setErro(null);
    setSucesso(null);
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
      setTentouEnviar(false);
      setSucesso("Deslocamento lançado. Você já pode incluir o próximo.");
      carregar(false);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao lançar o deslocamento");
    } finally {
      setSalvando(false);
    }
  }

  function tentarLancarDespesa() {
    if (!formularioDespesaValido) {
      setTentouEnviar(true);
      return;
    }
    void lancarDespesa();
  }

  function tentarLancarDeslocamento() {
    if (!formularioDeslocamentoValido) {
      setTentouEnviar(true);
      return;
    }
    void lancarDeslocamento();
  }

  async function excluir(despesaId: number) {
    if (!window.confirm("Excluir esta despesa? Só é possível porque ela ainda não foi enviada ao Senior.")) return;
    setErro(null);
    setSucesso(null);
    try {
      await axios.delete(`/api/rats/despesas/${despesaId}`);
      setSucesso("Despesa excluída.");
      carregar(false);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao excluir a despesa");
    }
  }

  function trocarAba(proximaAba: "despesa" | "deslocamento") {
    setAba(proximaAba);
    setTentouEnviar(false);
    setSucesso(null);
  }

  const tabClass = (ativa: boolean) =>
    `flex-1 rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      ativa ? "bg-primary text-primary-foreground shadow-sm" : "text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

  return (
    <Modal open onClose={onFechar} title="Despesas de Viagem" subtitulo={ratLabel} className="max-w-3xl" fecharPorFora={false}>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      ) : !dados?.podeLancar ? (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Esta RAT ainda não tem número do ERP — não é possível lançar despesa ainda.
        </p>
      ) : (
        <div className="space-y-4">
          {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
          {sucesso && <p role="status" className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">{sucesso}</p>}

          <section className="rounded-lg border border-border bg-surface p-3 sm:p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-foreground">O que deseja lançar?</p>
              <p className="mt-0.5 text-xs text-muted">Escolha o tipo de lançamento e preencha somente os dados necessários.</p>
            </div>
            <div className="flex w-full gap-1 rounded-md border border-border bg-surface-2 p-1" role="tablist" aria-label="Tipo de lançamento">
              <button type="button" role="tab" aria-selected={aba === "despesa"} onClick={() => trocarAba("despesa")} className={tabClass(aba === "despesa")}>
                Despesa avulsa
              </button>
              <button type="button" role="tab" aria-selected={aba === "deslocamento"} onClick={() => trocarAba("deslocamento")} className={tabClass(aba === "deslocamento")}>
                Deslocamento por rota
              </button>
            </div>
          </section>

          {aba === "despesa" && (
            <section role="tabpanel" className="rounded-lg border border-border bg-surface p-3 sm:p-4">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Detalhes da despesa</h2>
                  <p className="text-xs text-muted">Os campos marcados com * são obrigatórios.</p>
                </div>
                <output className="font-mono text-lg font-semibold tabular-nums text-primary" aria-label="Valor total calculado">
                  {formatMoney(totalDespesa)}
                </output>
              </div>

              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="despesa-tipo">Tipo da despesa *</label>
                    <select id="despesa-tipo" value={tipdes} onChange={(e) => setTipdes(Number(e.target.value))} className={inputClass}>
                      {dados.opcoesTipo.map((opcao) => (
                        <option key={opcao.value} value={opcao.value}>
                          {opcao.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="despesa-data">Data *</label>
                    <input id="despesa-data" type="date" value={dataDespesa} onChange={(e) => setDataDespesa(e.target.value)} className={inputClass} />
                  </div>
                </div>

                <div>
                  <label className={labelClass} htmlFor="despesa-descricao">Descrição *</label>
                  <input
                    id="despesa-descricao"
                    value={descDespesa}
                    onChange={(e) => setDescDespesa(e.target.value)}
                    className={inputClass}
                    placeholder="Ex.: Almoço com o cliente"
                    aria-invalid={tentouEnviar && despesaInvalida.descricao}
                  />
                  {tentouEnviar && despesaInvalida.descricao && <p className={fieldErrorClass}>Informe uma descrição.</p>}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className={labelClass} htmlFor="despesa-quantidade">Quantidade *</label>
                    <input
                      id="despesa-quantidade"
                      type="number"
                      min="0"
                      step="1"
                      value={qtdDespesa}
                      onChange={(e) => setQtdDespesa(e.target.value)}
                      className={inputClass}
                      aria-invalid={tentouEnviar && despesaInvalida.quantidade}
                    />
                    {tentouEnviar && despesaInvalida.quantidade && <p className={fieldErrorClass}>Informe uma quantidade maior que zero.</p>}
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="despesa-unitario">Valor unitário *</label>
                    <input
                      id="despesa-unitario"
                      type="number"
                      min="0"
                      step="0.01"
                      value={unitDespesa}
                      onChange={(e) => setUnitDespesa(e.target.value)}
                      className={inputClass}
                      placeholder="0,00"
                      aria-invalid={tentouEnviar && despesaInvalida.unitario}
                    />
                    {tentouEnviar && despesaInvalida.unitario && <p className={fieldErrorClass}>Informe o valor unitário.</p>}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={fatura === "S"}
                    onClick={() => setFatura((valor) => (valor === "S" ? "N" : "S"))}
                    className="flex min-h-11 items-center justify-between rounded-md border border-border bg-surface-2 px-3 text-left text-sm text-foreground transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted">Faturar cliente</span>
                      <span className="mt-0.5 block font-medium">{fatura === "S" ? "Sim" : "Não"}</span>
                    </span>
                    <span aria-hidden="true" className={`h-5 w-9 rounded-full p-0.5 transition ${fatura === "S" ? "bg-primary" : "bg-border"}`}>
                      <span className={`block h-4 w-4 rounded-full bg-white transition ${fatura === "S" ? "translate-x-4" : "translate-x-0"}`} />
                    </span>
                  </button>
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted">O total é conferido novamente ao salvar.</p>
                  <button
                    type="button"
                    onClick={tentarLancarDespesa}
                    disabled={salvando}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {salvando ? "Lançando..." : "Lançar despesa"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {aba === "deslocamento" && (
            <section role="tabpanel" className="rounded-lg border border-border bg-surface p-3 sm:p-4">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-foreground">Detalhes do deslocamento</h2>
                <p className="mt-0.5 text-xs text-muted">A rota sugere a descrição e a quilometragem. Valor e horas continuam sob sua conferência.</p>
              </div>

              {dados.rotas.length === 0 ? (
                <p className="rounded-md border border-border bg-surface-2 px-3 py-3 text-sm text-muted">
                  Não há rota cadastrada para o cliente desta RAT — fale com quem cadastra rotas no ERP se precisar lançar um deslocamento por rota.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelClass} htmlFor="deslocamento-rota">Rota *</label>
                      <select
                        id="deslocamento-rota"
                        value={rotaId}
                        onChange={(e) => selecionarRota(e.target.value)}
                        className={inputClass}
                        aria-invalid={tentouEnviar && deslocamentoInvalido.rota}
                      >
                        <option value="">Selecione uma rota</option>
                        {dados.rotas.map((rota) => (
                          <option key={rota.id} value={rota.id}>
                            {rota.desrot} {rota.kmtrot != null ? `(${rota.kmtrot} km)` : ""}
                          </option>
                        ))}
                      </select>
                      {tentouEnviar && deslocamentoInvalido.rota && <p className={fieldErrorClass}>Selecione uma rota.</p>}
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="deslocamento-data">Data *</label>
                      <input id="deslocamento-data" type="date" value={dataDeslocamento} onChange={(e) => setDataDeslocamento(e.target.value)} className={inputClass} />
                    </div>
                  </div>

                  {rotaSelecionada && (
                    <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-foreground">
                      <span className="font-medium">Rota selecionada:</span> {rotaSelecionada.desrot}
                      {rotaSelecionada.kmtrot != null && <span className="text-muted"> · {rotaSelecionada.kmtrot} km</span>}
                      {rotaSelecionada.horrot != null && <span className="text-muted"> · previsão de {rotaSelecionada.horrot} h</span>}
                    </div>
                  )}

                  <div>
                    <span className={labelClass}>Modalidade *</span>
                    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Modalidade do deslocamento">
                      {dados.opcoesModalidade.map((opcao) => {
                        const selecionada = moddes === String(opcao.value);
                        return (
                          <button
                            key={opcao.value}
                            type="button"
                            role="radio"
                            aria-checked={selecionada}
                            onClick={() => setModdes(String(opcao.value))}
                            className={`rounded-md border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              selecionada ? "border-primary bg-primary/10 text-foreground" : "border-border bg-surface-2 text-muted hover:border-primary/60 hover:text-foreground"
                            }`}
                          >
                            {opcao.label}
                          </button>
                        );
                      })}
                    </div>
                    {tentouEnviar && deslocamentoInvalido.modalidade && <p className={fieldErrorClass}>Selecione uma modalidade.</p>}
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="deslocamento-descricao">Descrição *</label>
                    <input
                      id="deslocamento-descricao"
                      value={descDeslocamento}
                      onChange={(e) => setDescDeslocamento(e.target.value)}
                      className={inputClass}
                      placeholder="Ex.: Visita ao cliente"
                      aria-invalid={tentouEnviar && deslocamentoInvalido.descricao}
                    />
                    {tentouEnviar && deslocamentoInvalido.descricao && <p className={fieldErrorClass}>Informe uma descrição.</p>}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className={labelClass} htmlFor="deslocamento-quantidade">Quilometragem *</label>
                      <input
                        id="deslocamento-quantidade"
                        type="number"
                        min="0"
                        step="1"
                        value={qtdDeslocamento}
                        onChange={(e) => setQtdDeslocamento(e.target.value)}
                        className={inputClass}
                        aria-invalid={tentouEnviar && deslocamentoInvalido.quantidade}
                      />
                      {tentouEnviar && deslocamentoInvalido.quantidade && <p className={fieldErrorClass}>Informe uma quilometragem maior que zero.</p>}
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="deslocamento-unitario">Valor unitário *</label>
                      <input
                        id="deslocamento-unitario"
                        type="number"
                        min="0"
                        step="0.01"
                        value={unitDeslocamento}
                        onChange={(e) => setUnitDeslocamento(e.target.value)}
                        className={inputClass}
                        placeholder="0,00"
                        aria-invalid={tentouEnviar && deslocamentoInvalido.unitario}
                      />
                      {tentouEnviar && deslocamentoInvalido.unitario && <p className={fieldErrorClass}>Informe o valor unitário.</p>}
                    </div>
                    <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted">Valor total</span>
                      <output className="mt-0.5 block font-mono text-lg font-semibold tabular-nums text-primary" aria-label="Valor total calculado">
                        {formatMoney(totalDeslocamento)}
                      </output>
                    </div>
                  </div>

                  <details className="rounded-md border border-border bg-surface-2 px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-muted hover:text-foreground">Informações adicionais</summary>
                    <div className="mt-3 max-w-xs">
                      <label className={labelClass} htmlFor="deslocamento-horas">Horas de deslocamento (opcional)</label>
                      <input
                        id="deslocamento-horas"
                        type="number"
                        min="0"
                        step="1"
                        value={horasDeslocamento}
                        onChange={(e) => setHorasDeslocamento(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </details>

                  <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted">O total é conferido novamente ao salvar.</p>
                    <button
                      type="button"
                      onClick={tentarLancarDeslocamento}
                      disabled={salvando}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {salvando ? "Lançando..." : "Lançar deslocamento"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="overflow-hidden rounded-lg border border-border bg-surface">
            <button
              type="button"
              onClick={() => setHistoricoAberto((aberto) => !aberto)}
              aria-expanded={historicoAberto}
              aria-controls="historico-despesas-rat"
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
            >
              <span>
                <span className="block text-sm font-semibold text-foreground">Lançamentos desta RAT</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {dados.despesas.length === 0 ? "Nenhuma despesa lançada" : `${dados.despesas.length} ${dados.despesas.length === 1 ? "lançamento" : "lançamentos"}`} · {formatMoney(totalLancado)}
                  {pendentesDeEnvio > 0 && ` · ${pendentesDeEnvio} pendente${pendentesDeEnvio === 1 ? "" : "s"} de envio`}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium text-primary">{historicoAberto ? "Ocultar" : "Ver lançamentos"}</span>
            </button>

            {historicoAberto && (
              <div id="historico-despesas-rat" className="border-t border-border">
                {dados.despesas.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted sm:px-4">Os lançamentos realizados aqui aparecerão neste histórico.</p>
                ) : (
                  <>
                    <div className="hidden overflow-x-auto sm:block">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-surface-2">
                            <th className="px-4 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Data</th>
                            <th className="px-4 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Tipo</th>
                            <th className="px-4 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Descrição</th>
                            <th className="px-4 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Total</th>
                            <th className="px-4 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {dados.despesas.map((despesa) => (
                            <tr key={despesa.id} className="border-t border-border/60">
                              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">{formatData(despesa.datemi)}</td>
                              <td className="px-4 py-2.5 text-xs text-muted">
                                {despesa.tipdesLabel}
                                {despesa.moddesLabel && <span className="text-muted/70"> · {despesa.moddesLabel}</span>}
                              </td>
                              <td className="max-w-[260px] px-4 py-2.5 text-xs text-foreground">
                                <p className="truncate" title={despesa.desrdv ?? undefined}>{despesa.desrdv ?? "—"}</p>
                                {despesa.pendenteDeEnvio && <span className="mt-1 inline-block rounded-full bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-medium text-warning">Pendente de envio</span>}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs tabular-nums text-foreground">{formatMoney(despesa.vlrtot)}</td>
                              <td className="px-4 py-2.5 text-right">
                                {despesa.podeExcluir && (
                                  <button type="button" onClick={() => void excluir(despesa.id)} className="text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    Excluir
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="divide-y divide-border sm:hidden">
                      {dados.despesas.map((despesa) => (
                        <article key={despesa.id} className="space-y-2 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{despesa.desrdv ?? "Sem descrição"}</p>
                              <p className="mt-0.5 text-xs text-muted">{despesa.tipdesLabel}{despesa.moddesLabel ? ` · ${despesa.moddesLabel}` : ""}</p>
                            </div>
                            <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-foreground">{formatMoney(despesa.vlrtot)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs text-muted">
                            <span>{formatData(despesa.datemi)}</span>
                            <span>{despesa.fatrdvLabel === "Sim" ? "Fatura cliente" : "Não fatura cliente"}</span>
                          </div>
                          {(despesa.pendenteDeEnvio || despesa.podeExcluir) && (
                            <div className="flex items-center justify-between gap-3">
                              <span>{despesa.pendenteDeEnvio && <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-medium text-warning">Pendente de envio</span>}</span>
                              {despesa.podeExcluir && (
                                <button type="button" onClick={() => void excluir(despesa.id)} className="text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                  Excluir
                                </button>
                              )}
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      <div className="mt-4 flex justify-end border-t border-border pt-3">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Fechar
        </button>
      </div>
    </Modal>
  );
}
