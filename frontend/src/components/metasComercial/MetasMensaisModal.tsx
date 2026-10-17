import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { ConfigAno, Indicador, Lancamento, MESES_CURTOS, MESES_LONGOS, Participante, distribuirPorPesos, fmtValor, lerNumero, numParaCampo } from "../../lib/metasComercial";
import { Aviso, botaoPrimario, botaoSecundario, campo, mensagemDe } from "./comum";

interface Props {
  aberto: boolean;
  onClose: () => void;
  config: ConfigAno;
  indicadores: Indicador[];
  participante: Participante;
  lancamentos: Lancamento[];
  onSalvo: () => void;
}

const MESES = Array.from({ length: 12 }, (_, i) => i + 1);

// Metas mensais de UMA pessoa: grade indicador × 12 meses, com um assistente que reparte um valor pelos pesos do ano (ou copia o mesmo
// valor, nos indicadores de posição). O assistente só preenche os campos; a meta que vale é a que estiver na grade ao salvar.
export function MetasMensaisModal({ aberto, onClose, config, indicadores, participante, lancamentos, onSalvo }: Props) {
  const { mostrar } = useToast();
  const defs = useMemo(
    () => participante.indicadores.map((pi) => ({ pi, ind: indicadores.find((i) => i.id === pi.indicadorId) })).filter((x): x is { pi: Participante["indicadores"][number]; ind: Indicador } => x.ind != null),
    [participante, indicadores]
  );
  const original = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const { ind } of defs) m.set(ind.id, MESES.map((mes) => numParaCampo(lancamentos.find((l) => l.participanteId === participante.id && l.indicadorId === ind.id && l.mes === mes)?.meta ?? null)));
    return m;
  }, [defs, lancamentos, participante.id]);

  const [grade, setGrade] = useState<Map<number, string[]>>(new Map());
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // assistente
  const [indAss, setIndAss] = useState<number | "">("");
  const [modo, setModo] = useState<"valor" | "percentual">("valor");
  const [valorAss, setValorAss] = useState("");
  const [de, setDe] = useState(1);
  const [ate, setAte] = useState(12);

  useEffect(() => {
    if (!aberto) return;
    setGrade(new Map([...original].map(([k, v]) => [k, [...v]])));
    setErro(null);
    setIndAss(defs[0]?.ind.id ?? "");
    setValorAss("");
    setModo("valor");
    setDe(1);
    setAte(12);
  }, [aberto, original, defs]);

  const metaEmpresa = (iid: number) => config.empresa.find((e) => e.indicadorId === iid)?.metaAnual ?? null;

  function distribuir() {
    const def = defs.find((d) => d.ind.id === indAss);
    if (!def) return;
    const digitado = lerNumero(valorAss);
    if (digitado == null || Number.isNaN(digitado)) {
      setErro("Informe o valor (ou o percentual) para distribuir.");
      return;
    }
    let total = digitado;
    if (modo === "percentual") {
      const emp = metaEmpresa(def.ind.id);
      if (emp == null) {
        setErro(`Não há meta da empresa para ${def.ind.nome}: cadastre-a antes ou use "Valor".`);
        return;
      }
      total = Math.round(emp * digitado) / 100;
    }
    const meses = MESES.filter((m) => m >= Math.min(de, ate) && m <= Math.max(de, ate));
    const saida = def.ind.acumulacao === "SALDO" ? MESES.map((m) => (meses.includes(m) ? total : 0)) : distribuirPorPesos(total, config.pesosMensais, meses);
    setErro(null);
    setGrade((atual) => new Map(atual).set(def.ind.id, MESES.map((m) => (meses.includes(m) ? numParaCampo(saida[m - 1]) : ""))));
  }

  async function salvar() {
    const itens: Array<Record<string, unknown>> = [];
    for (const { ind } of defs) {
      const atual = grade.get(ind.id) ?? [];
      const antes = original.get(ind.id) ?? [];
      for (const mes of MESES) {
        const t = atual[mes - 1] ?? "";
        if (t === (antes[mes - 1] ?? "")) continue;
        const n = lerNumero(t);
        if (Number.isNaN(n)) {
          setErro(`Valor inválido em ${ind.nome} / ${MESES_LONGOS[mes - 1]}: use números como 1.234,56.`);
          return;
        }
        itens.push({ participanteId: participante.id, indicadorId: ind.id, mes, meta: n });
      }
    }
    if (itens.length === 0) {
      onClose();
      return;
    }
    setGravando(true);
    setErro(null);
    try {
      await axios.put(`/api/metas-comercial/anos/${config.ano}/lancamentos`, { itens });
      mostrar(`Metas de ${participante.nome} salvas.`, "success");
      onSalvo();
      onClose();
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível salvar as metas."));
    } finally {
      setGravando(false);
    }
  }

  const total = (iid: number) => (grade.get(iid) ?? []).reduce((s, t) => { const n = lerNumero(t); return s + (typeof n === "number" && !Number.isNaN(n) ? n : 0); }, 0);

  return (
    <Modal open={aberto} onClose={onClose} title={`Metas mensais — ${participante.nome}`} subtitulo={`${config.ano} · a meta que vale é a que estiver na grade ao salvar`} className="max-w-7xl">
      <div className="space-y-4 p-4">
        {defs.length === 0 ? (
          <p className="text-sm text-muted">Esta pessoa ainda não tem indicadores. Edite a pessoa e marque os que ela acompanha.</p>
        ) : (
          <>
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <p className="mb-2 text-[12.5px] font-medium text-foreground">Assistente de preenchimento</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="ass-ind" className="mb-1 block text-[12px] text-muted">Indicador</label>
                  <select id="ass-ind" value={indAss} onChange={(e) => setIndAss(Number(e.target.value))} className={`${campo} w-auto`}>
                    {defs.map(({ pi, ind }) => (
                      <option key={ind.id} value={ind.id}>{pi.rotulo?.trim() || ind.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ass-modo" className="mb-1 block text-[12px] text-muted">Partir de</label>
                  <select id="ass-modo" value={modo} onChange={(e) => setModo(e.target.value as "valor" | "percentual")} className={`${campo} w-auto`}>
                    <option value="valor">Um valor (total do período)</option>
                    <option value="percentual">% da meta anual da empresa</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ass-valor" className="mb-1 block text-[12px] text-muted">{modo === "valor" ? "Valor" : "Percentual"}</label>
                  <input id="ass-valor" inputMode="decimal" value={valorAss} onChange={(e) => setValorAss(e.target.value)} placeholder={modo === "valor" ? "ex.: 43.200" : "ex.: 49,2"} className={`${campo} w-32 text-right tabular-nums`} />
                </div>
                <div>
                  <label htmlFor="ass-de" className="mb-1 block text-[12px] text-muted">De</label>
                  <select id="ass-de" value={de} onChange={(e) => setDe(Number(e.target.value))} className={`${campo} w-auto`}>
                    {MESES.map((m) => <option key={m} value={m}>{MESES_LONGOS[m - 1]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ass-ate" className="mb-1 block text-[12px] text-muted">Até</label>
                  <select id="ass-ate" value={ate} onChange={(e) => setAte(Number(e.target.value))} className={`${campo} w-auto`}>
                    {MESES.map((m) => <option key={m} value={m}>{MESES_LONGOS[m - 1]}</option>)}
                  </select>
                </div>
                <button type="button" onClick={distribuir} className={botaoSecundario}>
                  Preencher a linha
                </button>
              </div>
              <p className="mt-2 text-[12px] text-muted">Reparte pelos pesos do ano (nos indicadores de posição, repete o valor). Substitui a linha inteira; depois você ainda pode ajustar qualquer mês.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                    <th className="min-w-[10rem] py-1.5 pr-3 font-medium">Indicador</th>
                    {MESES_CURTOS.map((m) => (
                      <th key={m} className="px-1 py-1.5 text-right font-medium">{m}</th>
                    ))}
                    <th className="pl-3 py-1.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {defs.map(({ pi, ind }) => (
                    <tr key={ind.id} className="border-b border-border/60">
                      <td className="py-1.5 pr-3 text-foreground">
                        {pi.rotulo?.trim() || ind.nome}
                        <span className="ml-1.5 text-[11px] text-muted">{ind.unidade === "BRL" ? "R$" : ind.unidade === "HORAS" ? "h" : "un."}</span>
                      </td>
                      {MESES.map((mes) => (
                        <td key={mes} className="px-0.5 py-1.5">
                          <input
                            inputMode="decimal"
                            aria-label={`${pi.rotulo?.trim() || ind.nome} — ${MESES_LONGOS[mes - 1]}`}
                            value={grade.get(ind.id)?.[mes - 1] ?? ""}
                            onChange={(e) =>
                              setGrade((atual) => {
                                const n = new Map(atual);
                                const linha = [...(n.get(ind.id) ?? new Array(12).fill(""))];
                                linha[mes - 1] = e.target.value;
                                n.set(ind.id, linha);
                                return n;
                              })
                            }
                            className={`${campo} min-w-[4.4rem] !px-1 text-[13px] text-right tabular-nums`}
                          />
                        </td>
                      ))}
                      <td className="whitespace-nowrap pl-3 py-1.5 text-right tabular-nums text-muted">
                        {ind.acumulacao === "SALDO" ? "—" : fmtValor(ind.unidade, total(ind.id))}
                        {ind.acumulacao === "SOMA" && metaEmpresa(ind.id) != null && (
                          <span className="block text-[11px]">empresa: {fmtValor(ind.unidade, metaEmpresa(ind.id))}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {erro && <Aviso>{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={botaoSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={gravando || defs.length === 0} className={botaoPrimario}>
            {gravando ? "Salvando…" : "Salvar metas"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
