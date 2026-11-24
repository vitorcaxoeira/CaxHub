import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../../components/gestao5s/campos";
import { Modal } from "../../../components/ui/Modal";
import { useToast } from "../../../components/ui/Toast";
import { fmtCompetencia, fmtData, fmtMoeda, mensagemDe, useOpcoesDescontos } from "./comum";
import type { ProcessoDetalhe, Simulacao } from "./tipos";

// Novo desconto / edição de um processo. Duas formas de lançar (modo): "Valor total parcelado" (o sistema divide; a última parcela absorve os
// centavos) e "Valor mensal fixo" (todas as parcelas iguais; o total é calculado). A conta mora SÓ no backend (POST /processos/simular): a
// tela mostra o que ele devolve, para a pré-visualização nunca divergir do que será gravado.

const mesAtual = () => new Date().toISOString().slice(0, 7);
const primeiroDiaDoMes = (competencia: string) => `${competencia}-01`;
/** Último dia do mês da última parcela (competência inicial + qtd - 1): sugestão para a data final da vigência. */
function fimSugerido(competencia: string, qtd: number): string {
  const [ano, mes] = competencia.split("-").map(Number);
  if (!ano || !mes || !Number.isInteger(qtd) || qtd < 1) return "";
  return new Date(Date.UTC(ano, mes - 1 + qtd, 0)).toISOString().slice(0, 10);
}
const numero = (t: string): number | undefined => {
  const n = Number(t.replace(",", "."));
  return t.trim() !== "" && Number.isFinite(n) ? n : undefined;
};

export function NovoDescontoModal({ processo, onFechar }: { processo: ProcessoDetalhe | null; onFechar: (salvou: boolean) => void }) {
  const { mostrar } = useToast();
  const { consultores, tipos } = useOpcoesDescontos();
  const editando = processo != null;
  // Com parcelas já descontadas/canceladas/transportadas só a observação e o fim da vigência mudam (o cronograma virou histórico).
  const travado = editando && !processo.editavelPorCompleto;

  const [codfor, setCodfor] = useState(processo ? String(processo.codfor) : "");
  const [tipoId, setTipoId] = useState(processo ? String(processo.tipoId) : "");
  const [modo, setModo] = useState<"total_parcelado" | "mensal_fixo">(processo?.modo ?? "total_parcelado");
  const [valorTotal, setValorTotal] = useState(processo && processo.modo === "total_parcelado" ? String(processo.valorTotal) : "");
  const [valorParcela, setValorParcela] = useState(processo && processo.modo === "mensal_fixo" ? String(processo.valorParcela) : "");
  const [qtd, setQtd] = useState(processo ? String(processo.qtdParcelas) : "1");
  const [competencia, setCompetencia] = useState(processo?.competenciaInicial ?? mesAtual());
  const [vigenciaInicio, setVigenciaInicio] = useState(processo?.vigenciaInicio ?? primeiroDiaDoMes(mesAtual()));
  const [vigenciaFim, setVigenciaFim] = useState(processo?.vigenciaFim ?? fimSugerido(mesAtual(), 1));
  const [fimManual, setFimManual] = useState(editando);
  const [diaVencimento, setDiaVencimento] = useState(processo ? String(processo.diaVencimento) : "10");
  const [observacao, setObservacao] = useState(processo?.observacao ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);

  // Enquanto a data final não foi digitada à mão, acompanha competência e quantidade (cobre todas as parcelas).
  useEffect(() => {
    if (fimManual) return;
    setVigenciaFim(fimSugerido(competencia, Number(qtd)));
  }, [competencia, qtd, fimManual]);

  const tipo = tipos.find((t) => String(t.id) === tipoId) ?? null;
  const tiposSelecionaveis = tipos.filter((t) => t.ativo || String(t.id) === tipoId);

  const corpo = useMemo(
    () => ({
      codfor: Number(codfor),
      tipoId: Number(tipoId),
      modo,
      valorTotal: modo === "total_parcelado" ? numero(valorTotal) : undefined,
      valorParcela: modo === "mensal_fixo" ? numero(valorParcela) : undefined,
      qtdParcelas: Number(qtd),
      vigenciaInicio,
      vigenciaFim,
      competenciaInicial: competencia,
      diaVencimento: Number(diaVencimento),
      observacao: observacao.trim() || undefined,
    }),
    [codfor, tipoId, modo, valorTotal, valorParcela, qtd, vigenciaInicio, vigenciaFim, competencia, diaVencimento, observacao]
  );

  // Pré-visualização (debounce): o backend calcula e valida; a tela só mostra.
  useEffect(() => {
    if (travado || !codfor || !tipoId) {
      setSimulacao(null);
      return;
    }
    let cancelado = false;
    const t = window.setTimeout(() => {
      axios
        .post<Simulacao>("/api/descontos/processos/simular", corpo)
        .then(({ data }) => !cancelado && setSimulacao(data))
        .catch(() => !cancelado && setSimulacao(null));
    }, 350);
    return () => {
      cancelado = true;
      window.clearTimeout(t);
    };
  }, [corpo, travado, codfor, tipoId]);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      if (editando) await axios.put(`/api/descontos/processos/${processo.id}`, corpo);
      else await axios.post("/api/descontos/processos", corpo);
      mostrar(editando ? "Desconto atualizado" : "Desconto lançado", "success");
      onFechar(true);
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível salvar o desconto"));
      setSalvando(false);
    }
  }

  const podeSalvar = !salvando && !!codfor && !!tipoId && (travado || simulacao?.valido === true);

  return (
    <Modal open onClose={() => onFechar(false)} title={editando ? `Editar ${processo.numero}` : "Novo desconto"} fecharPorFora={false} className="max-w-3xl">
      <div className="space-y-4">
        {travado && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-foreground">
            Este processo já tem parcelas descontadas, canceladas ou transportadas: só a observação e a data final da vigência podem mudar. Para alterar o resto,
            cancele o processo e lance outro.
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className={classeRotulo} htmlFor="d-consultor">Consultor</label>
            <select id="d-consultor" className={classeCampo} value={codfor} onChange={(e) => setCodfor(e.target.value)} disabled={travado}>
              <option value="">Selecione…</option>
              {consultores.map((c) => (
                <option key={c.codfor} value={c.codfor}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={classeRotulo} htmlFor="d-tipo">Tipo de desconto</label>
            <select id="d-tipo" className={classeCampo} value={tipoId} onChange={(e) => setTipoId(e.target.value)} disabled={travado}>
              <option value="">Selecione…</option>
              {tiposSelecionaveis.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                  {!t.ativo ? " (inativo)" : ""}
                </option>
              ))}
            </select>
            {tipo && (
              <p className="mt-1 text-[11px] text-muted">
                {!tipo.permiteParcelamento ? "Sem parcelamento. " : tipo.maxParcelas ? `Até ${tipo.maxParcelas} parcela(s). ` : ""}
                {tipo.valorMinimo != null ? `Mínimo ${fmtMoeda(tipo.valorMinimo)}. ` : ""}
                {tipo.valorMaximo != null ? `Máximo ${fmtMoeda(tipo.valorMaximo)}. ` : ""}
                {tipo.exigeObservacao ? "Exige observação." : ""}
              </p>
            )}
          </div>
        </div>

        <fieldset disabled={travado} className="space-y-2">
          <legend className={classeRotulo}>Modo de lançamento</legend>
          <div className="grid gap-2 md:grid-cols-2">
            {(
              [
                ["total_parcelado", "Valor total parcelado", "Informe o total; o sistema divide (a última parcela absorve os centavos)."],
                ["mensal_fixo", "Valor mensal fixo", "Informe o valor da parcela; o total é calculado (ex.: plano de saúde, 12 × 29,99)."],
              ] as const
            ).map(([valor, titulo, dica]) => (
              <label key={valor} className={`flex cursor-pointer gap-2 rounded-md border px-3 py-2 text-sm ${modo === valor ? "border-primary bg-primary/5" : "border-border"}`}>
                <input type="radio" name="modo-desconto" className="mt-1" checked={modo === valor} onChange={() => setModo(valor)} />
                <span>
                  <span className="block font-medium text-foreground">{titulo}</span>
                  <span className="block text-[11.5px] text-muted">{dica}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className={classeRotulo} htmlFor="d-valor">{modo === "total_parcelado" ? "Valor total (R$)" : "Valor mensal (R$)"}</label>
            {modo === "total_parcelado" ? (
              <input id="d-valor" className={classeCampo} inputMode="decimal" value={valorTotal} onChange={(e) => setValorTotal(e.target.value)} placeholder="500,00" disabled={travado} />
            ) : (
              <input id="d-valor" className={classeCampo} inputMode="decimal" value={valorParcela} onChange={(e) => setValorParcela(e.target.value)} placeholder="29,99" disabled={travado} />
            )}
          </div>
          <div>
            <label className={classeRotulo} htmlFor="d-qtd">Parcelas</label>
            <input id="d-qtd" className={classeCampo} type="number" min={1} max={120} value={qtd} onChange={(e) => setQtd(e.target.value)} disabled={travado} />
          </div>
          <div>
            <label className={classeRotulo} htmlFor="d-comp">Competência inicial</label>
            <input id="d-comp" className={classeCampo} type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} disabled={travado} />
          </div>
          <div>
            <label className={classeRotulo} htmlFor="d-dia">Dia do vencimento</label>
            <input id="d-dia" className={classeCampo} type="number" min={1} max={31} value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} disabled={travado} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className={classeRotulo} htmlFor="d-vini">Vigência: início</label>
            <input id="d-vini" className={classeCampo} type="date" value={vigenciaInicio} onChange={(e) => setVigenciaInicio(e.target.value)} disabled={travado} />
          </div>
          <div>
            <label className={classeRotulo} htmlFor="d-vfim">Vigência: fim</label>
            <input
              id="d-vfim"
              className={classeCampo}
              type="date"
              value={vigenciaFim}
              onChange={(e) => {
                setFimManual(true);
                setVigenciaFim(e.target.value);
              }}
            />
          </div>
        </div>

        <div>
          <label className={classeRotulo} htmlFor="d-obs">Observações{tipo?.exigeObservacao ? " (obrigatória neste tipo)" : ""}</label>
          <textarea id="d-obs" className={classeCampo} rows={2} maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: 2 camisas polo tamanho M" />
        </div>

        {!travado && simulacao && (
          <div className="rounded-md border border-border">
            {simulacao.valido && simulacao.parcelas ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2 text-[12.5px]">
                  <span className="text-muted">
                    Total do processo: <strong className="font-mono text-foreground">{fmtMoeda(simulacao.valorTotal)}</strong>
                  </span>
                  <span className="text-muted">
                    Última competência: <strong className="text-foreground">{fmtCompetencia(simulacao.competenciaFinal)}</strong> · vence em{" "}
                    <strong className="text-foreground">{fmtData(simulacao.vencimentoFinal)}</strong>
                  </span>
                </div>
                <div className="max-h-44 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                        <th className="px-3 py-1.5">Parcela</th>
                        <th className="px-3 py-1.5">Competência</th>
                        <th className="px-3 py-1.5">Vencimento</th>
                        <th className="px-3 py-1.5 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulacao.parcelas.map((p) => (
                        <tr key={p.numero} className="border-t border-border/60">
                          <td className="px-3 py-1 font-mono">{p.numero}/{simulacao.parcelas!.length}</td>
                          <td className="px-3 py-1">{fmtCompetencia(p.competencia)}</td>
                          <td className="px-3 py-1">{fmtData(p.vencimento)}</td>
                          <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtMoeda(p.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="px-3 py-2 text-[12.5px] text-destructive">{simulacao.erro}</p>
            )}
          </div>
        )}

        {erro && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={() => onFechar(false)} disabled={salvando} className={classeBotaoSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={!podeSalvar} className={classeBotaoPrimario}>
            {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Lançar desconto"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
