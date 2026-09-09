import axios from "axios";
import { useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { horasParaMinutos, minutosParaInputHoras } from "../../utils/horas";
import { DespesaLancada, Opcao, Rota } from "./DespesasRatPainel";

interface ModalLancarDespesaProps {
  ratId: number;
  rotas: Rota[];
  opcoesTipo: Opcao[];
  opcoesModalidade: Opcao[];
  // null = modo "nova despesa"; preenchida = edição, formulário nasce com os dados dela (ver os
  // useState abaixo — o pai (DespesasRatPainel.tsx) remonta este componente do zero a cada
  // abertura via `key`, então não precisa de useEffect pra sincronizar troca de despesa).
  despesaEmEdicao: DespesaLancada | null;
  onFechar: () => void;
  // Chamado depois de CADA salvamento bem-sucedido (não só ao fechar), com o id da despesa
  // criada/editada — o pai recarrega a lista na hora E fica de olho (acompanharReenvio) até o
  // Senior responder de verdade, com o modal ainda aberto. Sem esse acompanhamento, um envio
  // pego em voo pelo primeiro refresh (comum, o envio roda em segundo plano) ficava com o
  // ícone "enviando" preso pra sempre — mesmo bug já corrigido pro botão de reenviar manual.
  onSalvo: (despesaId: number) => void;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number) => `R$ ${currency.format(v)}`;
const hojeInput = () => new Date().toISOString().slice(0, 10);

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted";
const fieldErrorClass = "mt-1 text-xs text-destructive";

// Formulário de lançar/editar UMA despesa de viagem (RDV) de uma RAT, num modal por cima da
// tela — aberto por DespesasRatPainel.tsx ("Nova Despesa"/"Editar"). Chegou a ser uma janela
// popup própria (window.open) por um instante em 08/09/2026, revertido a pedido do Vitor: "só
// modal mesmo". Sem fetch próprio — recebe tudo já carregado (rotas/opções) e a despesa a
// editar (se houver) como props, do mesmo GET /:id/despesas que DespesasRatPainel já fez.
export function ModalLancarDespesa({ ratId, rotas, opcoesTipo, opcoesModalidade, despesaEmEdicao, onFechar, onSalvo }: ModalLancarDespesaProps) {
  const editandoDeslocamento = despesaEmEdicao?.moddes != null;

  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [aba, setAba] = useState<"despesa" | "deslocamento">(editandoDeslocamento ? "deslocamento" : "despesa");
  const [tentouEnviar, setTentouEnviar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // Id da despesa em edição — null = formulário no modo "novo lançamento". Volta a null depois
  // de uma edição salva com sucesso (o formulário vira "nova despesa" em seguida, no MESMO
  // modal — decisão explícita: não fecha sozinho).
  const [editandoId, setEditandoId] = useState<number | null>(despesaEmEdicao?.id ?? null);

  // Formulário "Despesa avulsa" — nasce preenchido quando despesaEmEdicao é uma despesa avulsa.
  const [tipdes, setTipdes] = useState<number | "">(
    despesaEmEdicao && !editandoDeslocamento ? despesaEmEdicao.tipdes : opcoesTipo[0] ? Number(opcoesTipo[0].value) : ""
  );
  const [descDespesa, setDescDespesa] = useState(despesaEmEdicao && !editandoDeslocamento ? despesaEmEdicao.desrdv ?? "" : "");
  const [qtdDespesa, setQtdDespesa] = useState(
    despesaEmEdicao && !editandoDeslocamento && despesaEmEdicao.qtdrdv != null ? String(despesaEmEdicao.qtdrdv) : "1"
  );
  const [unitDespesa, setUnitDespesa] = useState(
    despesaEmEdicao && !editandoDeslocamento && despesaEmEdicao.vlrunt != null ? String(despesaEmEdicao.vlrunt) : ""
  );
  const [fatura, setFatura] = useState<"S" | "N">(despesaEmEdicao && !editandoDeslocamento && despesaEmEdicao.fatrdv === "N" ? "N" : "S");
  const [dataDespesa, setDataDespesa] = useState(
    despesaEmEdicao && !editandoDeslocamento && despesaEmEdicao.datemi ? despesaEmEdicao.datemi.slice(0, 10) : hojeInput()
  );

  // Formulário "Deslocamento por rota" — nasce preenchido quando despesaEmEdicao é deslocamento.
  const [rotaId, setRotaId] = useState<number | "">(editandoDeslocamento ? despesaEmEdicao!.rotid ?? "" : "");
  const [moddes, setModdes] = useState<string>(editandoDeslocamento ? despesaEmEdicao!.moddes! : "");
  const [descDeslocamento, setDescDeslocamento] = useState(editandoDeslocamento ? despesaEmEdicao!.desrdv ?? "" : "");
  const [dataDeslocamento, setDataDeslocamento] = useState(
    editandoDeslocamento && despesaEmEdicao!.datemi ? despesaEmEdicao!.datemi!.slice(0, 10) : hojeInput()
  );
  const [qtdDeslocamento, setQtdDeslocamento] = useState(
    editandoDeslocamento && despesaEmEdicao!.qtdrdv != null ? String(despesaEmEdicao!.qtdrdv) : ""
  );
  const [unitDeslocamento, setUnitDeslocamento] = useState(
    editandoDeslocamento && despesaEmEdicao!.vlrunt != null ? String(despesaEmEdicao!.vlrunt) : ""
  );
  // "H:MM" pra tela (minutosParaInputHoras) — `hordes` no banco é minutos crus (Senior calcula
  // e devolve em `Result.horDes`, ver outboxSeniorDespesa.ts), nunca mostrado cru na tela.
  // Mesmo formato "h:mm" já usado em "Horas previstas" no Cronograma (DrawerAtividade.tsx).
  const [horasDeslocamento, setHorasDeslocamento] = useState(
    editandoDeslocamento ? minutosParaInputHoras(despesaEmEdicao!.hordes) : ""
  );

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

  const rotaSelecionada = rotas.find((rota) => rota.id === rotaId) ?? null;

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
    const rota = rotas.find((item) => item.id === id);
    if (rota) {
      if (descDeslocamento.trim() === "") setDescDeslocamento(rota.desrot);
      if (rota.kmtrot != null) setQtdDeslocamento(String(Math.round(rota.kmtrot)));
    }
  }

  function resetFormularioDespesa() {
    setTipdes(opcoesTipo[0] ? Number(opcoesTipo[0].value) : "");
    setDescDespesa("");
    setQtdDespesa("1");
    setUnitDespesa("");
    setFatura("S");
    setDataDespesa(hojeInput());
  }

  function resetFormularioDeslocamento() {
    setRotaId("");
    setModdes("");
    setDescDeslocamento("");
    setDataDeslocamento(hojeInput());
    setQtdDeslocamento("");
    setUnitDeslocamento("");
    setHorasDeslocamento("");
  }

  async function lancarDespesa() {
    setSalvando(true);
    setErro(null);
    setSucesso(null);
    const payload = {
      aba: "despesa",
      tipdes,
      desrdv: descDespesa.trim(),
      qtdrdv: Number(qtdDespesa),
      vlrunt: Number(unitDespesa),
      fatrdv: fatura,
      datemi: dataDespesa,
    };
    try {
      let despesaId: number;
      if (editandoId != null) {
        despesaId = editandoId;
        await axios.patch(`/api/rats/despesas/${despesaId}`, payload);
        setSucesso("Despesa atualizada.");
        setEditandoId(null);
      } else {
        const { data } = await axios.post(`/api/rats/${ratId}/despesas`, payload);
        despesaId = data.id;
        setSucesso("Despesa lançada. Você já pode incluir a próxima.");
      }
      onSalvo(despesaId);
      resetFormularioDespesa();
      setTentouEnviar(false);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao salvar a despesa");
    } finally {
      setSalvando(false);
    }
  }

  async function lancarDeslocamento() {
    setSalvando(true);
    setErro(null);
    setSucesso(null);
    const payload = {
      aba: "deslocamento",
      rotid: rotaId,
      moddes,
      desrdv: descDeslocamento.trim(),
      qtdrdv: Number(qtdDeslocamento),
      vlrunt: Number(unitDeslocamento),
      hordes: horasParaMinutos(horasDeslocamento) ?? undefined,
      datemi: dataDeslocamento,
    };
    try {
      let despesaId: number;
      if (editandoId != null) {
        despesaId = editandoId;
        await axios.patch(`/api/rats/despesas/${despesaId}`, payload);
        setSucesso("Deslocamento atualizado.");
        setEditandoId(null);
      } else {
        const { data } = await axios.post(`/api/rats/${ratId}/despesas`, payload);
        despesaId = data.id;
        setSucesso("Deslocamento lançado. Você já pode incluir o próximo.");
      }
      onSalvo(despesaId);
      resetFormularioDeslocamento();
      setTentouEnviar(false);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao salvar o deslocamento");
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
    // Sem `fecharPorFora` (clique fora/Esc não fecham) — mesmo cuidado de ModalObservacaoAtividade:
    // um clique torto no fundo escuro não pode descartar o que a pessoa acabou de digitar. Sai
    // pelo ✕ do cabeçalho (sempre ativo, mesmo com fecharPorFora=false).
    <Modal
      open
      onClose={onFechar}
      fecharPorFora={false}
      title={editandoId != null ? "Editar despesa" : "Lançar despesa"}
      subtitulo={`RAT ${ratId}`}
      className="max-w-xl"
    >
      <div className="space-y-4">
        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
        {sucesso && <p role="status" className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">{sucesso}</p>}

        <div className="flex w-full gap-1 rounded-md border border-border bg-surface-2 p-1" role="tablist" aria-label="Tipo de lançamento">
          <button type="button" role="tab" aria-selected={aba === "despesa"} onClick={() => trocarAba("despesa")} className={tabClass(aba === "despesa")}>
            Despesa avulsa
          </button>
          <button type="button" role="tab" aria-selected={aba === "deslocamento"} onClick={() => trocarAba("deslocamento")} className={tabClass(aba === "deslocamento")}>
            Deslocamento por rota
          </button>
        </div>

        {aba === "despesa" && (
          <section role="tabpanel" className="space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <p className="text-xs text-muted">Os campos marcados com * são obrigatórios.</p>
              <output className="font-mono text-lg font-semibold tabular-nums text-primary" aria-label="Valor total calculado">
                {formatMoney(totalDespesa)}
              </output>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="despesa-tipo">Tipo da despesa *</label>
                <select id="despesa-tipo" value={tipdes} onChange={(e) => setTipdes(Number(e.target.value))} className={inputClass}>
                  {opcoesTipo.map((opcao) => (
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

            <div className="grid gap-3 sm:grid-cols-3">
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
                {tentouEnviar && despesaInvalida.quantidade && <p className={fieldErrorClass}>Maior que zero.</p>}
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
                {tentouEnviar && despesaInvalida.unitario && <p className={fieldErrorClass}>Informe o valor.</p>}
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
                {salvando ? "Salvando..." : editandoId != null ? "Salvar edição" : "Lançar despesa"}
              </button>
            </div>
          </section>
        )}

        {aba === "deslocamento" && (
          <section role="tabpanel" className="space-y-4">
            <p className="text-xs text-muted">A rota sugere a descrição e a quilometragem. Valor e horas continuam sob sua conferência.</p>

            {rotas.length === 0 ? (
              <p className="rounded-md border border-border bg-surface-2 px-3 py-3 text-sm text-muted">
                Não há rota cadastrada para o cliente desta RAT — fale com quem cadastra rotas no ERP se precisar lançar um deslocamento por rota.
              </p>
            ) : (
              <>
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
                      {rotas.map((rota) => (
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
                    {opcoesModalidade.map((opcao) => {
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

                <div className="grid gap-3 sm:grid-cols-3">
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
                    {tentouEnviar && deslocamentoInvalido.quantidade && <p className={fieldErrorClass}>Maior que zero.</p>}
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
                    {tentouEnviar && deslocamentoInvalido.unitario && <p className={fieldErrorClass}>Informe o valor.</p>}
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
                    <label className={labelClass} htmlFor="deslocamento-horas">Horas de deslocamento (h:mm, opcional)</label>
                    <input
                      id="deslocamento-horas"
                      type="text"
                      inputMode="numeric"
                      placeholder="ex.: 2:30"
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
                    {salvando ? "Salvando..." : editandoId != null ? "Salvar edição" : "Lançar deslocamento"}
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
