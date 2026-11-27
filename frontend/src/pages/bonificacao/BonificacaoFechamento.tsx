import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../components/gestao5s/campos";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import {
  classeFiltro,
  competenciaPadrao,
  descreverFaixas,
  fmtCompetencia,
  fmtDataHora,
  fmtMoeda,
  fmtNumero,
  fmtPontos,
  fmtValorIndicador,
  mensagemDe,
  ModalJustificativa,
  Selo,
  useAcessoBonificacao,
  useProcessos,
  type Faixa,
} from "./comum";

// Gestão de Bonificação › Fechamento mensal: a grade do processo na competência (consultor x indicador). Quem administra apura (Kyria/HCM),
// lança o que é manual, ajusta e fecha o mês; gestor e consultor só veem o que já está fechado, dentro do seu escopo.

interface ResultadoCelula {
  id: number;
  valorApurado: number | null;
  valorInformado: number | null;
  pontos: number | null;
  valorBase: number | null;
  valor: number | null;
  detalhe: Record<string, unknown> | null;
  observacao: string | null;
}
interface IndicadorCol {
  id: number;
  chave: string;
  nome: string;
  fonte: string;
  fonteRotulo: string;
  unidade: string;
  sentido: string;
  regra: { id: number; valorBase: number; idadeMeses: number | null; faixas: Faixa[] } | null;
}
interface LinhaConsultor {
  codfor: number;
  consultor: string;
  resultados: Record<string, ResultadoCelula>;
  totalPontos: number;
  totalValor: number;
  pendentes: number;
  /** O valor deste consultor vai para a nota fiscal dele (processo compõe a nota E contrato Fixo/Hora vigente). */
  vaiParaNota: boolean;
  contrato: "fixo" | "hora" | null;
  contratoRotulo: string | null;
  /** Quando não vai: o porquê. */
  motivoNota: string | null;
}
interface DetalheFechamento {
  processo: { id: number; nome: string };
  competencia: string;
  administra: boolean;
  /** O valor deste fechamento soma à nota fiscal dos consultores (fechado: a flag copiada ao fechar; aberto: a do processo). */
  compoeNota: boolean;
  /** Consultores cujo desconto da competência já fechou depois desta bonificação (a base deles já a inclui). */
  descontosJaFechados: number;
  fechamento: { id: number; situacao: "aberto" | "fechado"; situacaoRotulo: string; apuradoEm: string | null; fechadoEm: string | null } | null;
  enquadrados: number | null;
  indicadores: IndicadorCol[];
  linhas: LinhaConsultor[];
  totais: { valor: number; pontos: number; pendentes: number; naNota: number };
}

export function BonificacaoFechamento() {
  const { mostrar } = useToast();
  const acesso = useAcessoBonificacao();
  const processos = useProcessos();
  const [processoId, setProcessoId] = useState("");
  const [competencia, setCompetencia] = useState(competenciaPadrao());
  const [dados, setDados] = useState<DetalheFechamento | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [celula, setCelula] = useState<{ linha: LinhaConsultor; indicador: IndicadorCol } | null>(null);
  const [reabrindo, setReabrindo] = useState(false);

  useEffect(() => {
    if (!processoId && processos.length) setProcessoId(String(processos.find((p) => p.ativo)?.id ?? processos[0].id));
  }, [processos, processoId]);

  const carregar = useCallback(() => {
    if (!processoId || !/^\d{4}-\d{2}$/.test(competencia)) return;
    setCarregando(true);
    axios
      .get<DetalheFechamento>(`/api/bonificacao/fechamentos/${processoId}/${competencia}`)
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((e) => setErro(mensagemDe(e, "Falha ao carregar o fechamento")))
      .finally(() => setCarregando(false));
  }, [processoId, competencia]);

  useEffect(carregar, [carregar]);

  const aberto = dados?.fechamento?.situacao === "aberto";
  const fechado = dados?.fechamento?.situacao === "fechado";
  const administra = !!acesso?.administra;

  async function apurar() {
    setOcupado(true);
    try {
      const { data } = await axios.post<{ consultores: number; resultados: number; pendentes: number }>("/api/bonificacao/fechamentos/apurar", { processoId: Number(processoId), competencia });
      mostrar(`${fmtCompetencia(competencia)}: ${data.consultores} consultor(es) apurado(s), ${data.pendentes} indicador(es) pendente(s).`, data.pendentes ? "warning" : "success");
      carregar();
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível apurar"), "destructive");
    } finally {
      setOcupado(false);
    }
  }

  async function fechar() {
    if (!dados?.fechamento) return;
    const avisoNota = dados.compoeNota ? " O valor de cada consultor passa a compor a nota fiscal dele nesta competência (Relatório de Produtividade, descontos e Home)." : "";
    if (!window.confirm(`Fechar ${fmtCompetencia(competencia)} de "${dados.processo.nome}"?${avisoNota} Depois de fechado, só se altera reabrindo (com justificativa).`)) return;
    setOcupado(true);
    try {
      await axios.post(`/api/bonificacao/fechamentos/${dados.fechamento.id}/fechar`);
      mostrar("Competência fechada.", "success");
      carregar();
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível fechar"), "destructive");
    } finally {
      setOcupado(false);
    }
  }

  async function capturarFila() {
    setOcupado(true);
    try {
      const { data } = await axios.post<{ data: string; times: number }>("/api/bonificacao/fila-semanal/capturar");
      mostrar(`Foto da fila de hoje gravada (${data.times} times).`, "success");
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível tirar a foto da fila"), "destructive");
    } finally {
      setOcupado(false);
    }
  }

  const colunas = dados?.indicadores ?? [];
  const processoAtual = useMemo(() => processos.find((p) => String(p.id) === processoId), [processos, processoId]);

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Bonificação</p>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Fechamento mensal</h1>
          <p className="mt-1 text-sm text-muted">Pontuação e valor de cada consultor por indicador, na competência escolhida.</p>
        </div>
        {administra && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={capturarFila} disabled={ocupado} className={classeBotaoSecundario} title="O Kyria só guarda o status atual: a foto da fila das sextas é tirada automaticamente às 18h. Use se precisar tirar fora do horário.">
              Tirar foto da fila agora
            </button>
            {!fechado && (
              <button type="button" onClick={apurar} disabled={ocupado || !processoId} className={classeBotaoSecundario}>
                {ocupado ? "Aguarde…" : dados?.fechamento ? "Recalcular" : "Apurar"}
              </button>
            )}
            {aberto && (
              <button type="button" onClick={fechar} disabled={ocupado} className={classeBotaoPrimario}>
                Fechar competência
              </button>
            )}
            {fechado && (
              <button type="button" onClick={() => setReabrindo(true)} disabled={ocupado} className={classeBotaoSecundario}>
                Reabrir
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Processo" className={classeFiltro} value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
          {processos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {p.ativo ? "" : " (inativo)"}
            </option>
          ))}
        </select>
        <input type="month" aria-label="Competência" className={classeFiltro} value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        {dados?.fechamento && <Selo texto={dados.fechamento.situacaoRotulo} tone={fechado ? "success" : "warning"} />}
        {dados?.compoeNota && <Selo texto="Compõe a nota" tone="success" />}
        {dados?.fechamento?.apuradoEm && <span className="text-xs text-muted">Apurado em {fmtDataHora(dados.fechamento.apuradoEm)}</span>}
        {dados?.fechamento?.fechadoEm && <span className="text-xs text-muted">· Fechado em {fmtDataHora(dados.fechamento.fechadoEm)}</span>}
      </div>

      {processoAtual?.descricao && <p className="mb-3 text-[12.5px] text-muted">{processoAtual.descricao}</p>}
      {erro && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

      {carregando && !dados ? (
        <Skeleton className="h-40 w-full" />
      ) : dados && dados.linhas.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-5 py-10 text-center text-sm text-muted">
          {administra ? (
            dados.fechamento ? (
              "Nenhum consultor enquadrado neste mês. Enquadre consultores em Processos."
            ) : (
              <>
                Competência ainda não apurada
                {dados.enquadrados != null ? ` (${dados.enquadrados} consultor(es) enquadrado(s) no mês)` : ""}. Clique em <strong>Apurar</strong> para calcular os indicadores automáticos.
              </>
            )
          ) : (
            "Nada fechado para você nesta competência."
          )}
        </div>
      ) : dados ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left">
                <th className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Consultor</th>
                {colunas.map((c) => (
                  <th key={c.id} className="px-3 py-2.5 text-right text-[11.5px] font-semibold text-muted" title={c.fonteRotulo}>
                    <span className="block uppercase tracking-wide">{c.nome}</span>
                    <span className="block font-mono text-[10.5px] font-normal normal-case">{c.regra ? `base ${fmtMoeda(c.regra.valorBase)}` : "sem regra vigente"}</span>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right text-[11.5px] font-semibold uppercase tracking-wide text-muted">Pontos</th>
                <th className="px-4 py-2.5 text-right text-[11.5px] font-semibold uppercase tracking-wide text-muted">Total</th>
                <th className="px-3 py-2.5 text-center text-[11.5px] font-semibold uppercase tracking-wide text-muted" title="Só incide na nota fiscal quem tem contrato Fixo ou Hora, em processo que compõe a nota">
                  Vai para a nota?
                </th>
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((l) => (
                <tr key={l.codfor} className="border-b border-border last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5 font-medium text-foreground">{l.consultor}</td>
                  {colunas.map((c) => {
                    const r = l.resultados[c.id];
                    if (!r) return <td key={c.id} className="px-3 py-2.5 text-right text-muted">—</td>;
                    const efetivo = r.valorInformado ?? r.valorApurado;
                    return (
                      <td key={c.id} className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setCelula({ linha: l, indicador: c })}
                          className="rounded px-1.5 py-1 text-right hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title="Ver como foi calculado"
                        >
                          <span className="block font-mono tabular-nums text-foreground">{r.valor == null ? <span className="text-warning">pendente</span> : fmtMoeda(r.valor)}</span>
                          <span className="block font-mono text-[11px] text-muted">
                            {fmtValorIndicador(efetivo, c.unidade)}
                            {r.pontos != null ? ` · ${fmtPontos(r.pontos)} pt` : ""}
                            {r.valorInformado != null ? " · informado" : ""}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">{fmtPontos(l.totalPontos)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-primary">
                    {fmtMoeda(l.totalValor)}
                    {l.pendentes > 0 && <span className="block text-[11px] font-normal text-warning">{l.pendentes} pendente(s)</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center" title={l.vaiParaNota ? "O valor soma à nota fiscal deste consultor nesta competência" : (l.motivoNota ?? undefined)}>
                    <Selo texto={l.vaiParaNota ? "Sim" : "Não"} tone={l.vaiParaNota ? "success" : "neutral"} />
                    <span className="mt-0.5 block text-[10.5px] text-muted">{l.contratoRotulo ?? "Sem contrato"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-surface-2/60">
                <td className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted" colSpan={colunas.length + 1}>
                  Total do processo
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">{fmtPontos(dados.totais.pontos)}</td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-foreground">{fmtMoeda(dados.totais.valor)}</td>
                <td className="px-3 py-2.5 text-center font-mono text-[12px] font-semibold tabular-nums text-success" title="Soma do que vai para a nota fiscal dos consultores com contrato Fixo/Hora">
                  {fmtMoeda(dados.totais.naNota)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {celula && dados && (
        <ModalResultado
          linha={celula.linha}
          indicador={celula.indicador}
          editavel={administra && aberto}
          onFechar={() => setCelula(null)}
          onSalvo={() => {
            setCelula(null);
            carregar();
          }}
        />
      )}
      {reabrindo && dados?.fechamento && (
        <ModalJustificativa
          titulo="Reabrir competência"
          descricao={
            `Reabrir ${fmtCompetencia(competencia)} de "${dados.processo.nome}" libera ajustes e nova apuração. O motivo fica registrado no histórico.` +
            (dados.compoeNota ? " Enquanto estiver aberta, o valor SAI da nota fiscal dos consultores; volta quando fechar de novo." : "") +
            (dados.descontosJaFechados > 0
              ? ` Atenção: o desconto de ${dados.descontosJaFechados} consultor(es) já fechou com esta bonificação na base e NÃO será refeito.`
              : "")
          }
          rotuloConfirmar="Reabrir"
          perigo={false}
          onFechar={() => setReabrindo(false)}
          onConfirmar={async (justificativa) => {
            await axios.post(`/api/bonificacao/fechamentos/${dados.fechamento!.id}/reabrir`, { justificativa });
            setReabrindo(false);
            mostrar("Competência reaberta.", "success");
            carregar();
          }}
        />
      )}
    </div>
  );
}

function ModalResultado({
  linha,
  indicador,
  editavel,
  onFechar,
  onSalvo,
}: {
  linha: LinhaConsultor;
  indicador: IndicadorCol;
  editavel: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { mostrar } = useToast();
  const r = linha.resultados[indicador.id];
  const [valor, setValor] = useState(r.valorInformado == null ? "" : String(r.valorInformado).replace(".", ","));
  const [obs, setObs] = useState(r.observacao ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(limpar: boolean) {
    setSalvando(true);
    setErro(null);
    try {
      await axios.put(`/api/bonificacao/resultados/${r.id}`, { valorInformado: limpar ? null : valor, observacao: obs || null });
      mostrar("Resultado atualizado.", "success");
      onSalvo();
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível salvar"));
      setSalvando(false);
    }
  }

  const rotuloUnidade = indicador.unidade === "percentual" ? "(%)" : indicador.unidade === "horas" ? "(horas)" : "(quantidade)";
  return (
    <Modal open onClose={onFechar} title={`${indicador.nome} · ${linha.consultor}`} fecharPorFora={false}>
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
          <dt className="text-muted">Fonte</dt>
          <dd className="text-foreground">{indicador.fonteRotulo}</dd>
          <dt className="text-muted">Valor apurado</dt>
          <dd className="font-mono text-foreground">{fmtValorIndicador(r.valorApurado, indicador.unidade)}</dd>
          <dt className="text-muted">Valor informado</dt>
          <dd className="font-mono text-foreground">{fmtValorIndicador(r.valorInformado, indicador.unidade)}</dd>
          <dt className="text-muted">Pontos × base</dt>
          <dd className="font-mono text-foreground">
            {fmtPontos(r.pontos)} × {fmtMoeda(r.valorBase)} = <strong>{fmtMoeda(r.valor)}</strong>
          </dd>
        </dl>
        {indicador.regra && (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
            <span className="font-medium text-foreground">Regra vigente:</span> {descreverFaixas(indicador.regra.faixas, indicador.sentido, indicador.unidade)}
          </p>
        )}
        {r.detalhe && Object.keys(r.detalhe).length > 0 && (
          <div>
            <p className={classeRotulo}>Memória de cálculo</p>
            <DetalheCalculo detalhe={r.detalhe} />
          </div>
        )}
        {editavel ? (
          <div className="space-y-2 border-t border-border pt-3">
            <div>
              <label className={classeRotulo} htmlFor="bonif-valor">
                Valor informado {rotuloUnidade}
              </label>
              <input id="bonif-valor" className={classeCampo} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={indicador.fonte === "manual" ? "Lance o valor do mês" : "Vazio = usa o valor apurado"} autoFocus />
              <p className="mt-1 text-[11.5px] text-muted">O valor informado vale no lugar do apurado. Deixe vazio (ou use "Usar o apurado") para voltar ao cálculo automático.</p>
            </div>
            <div>
              <label className={classeRotulo} htmlFor="bonif-obs">
                Observação
              </label>
              <input id="bonif-obs" className={classeCampo} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} />
            </div>
          </div>
        ) : (
          r.observacao && <p className="text-[12.5px] text-muted">Observação: {r.observacao}</p>
        )}
        {erro && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} disabled={salvando} className={classeBotaoSecundario}>
            {editavel ? "Cancelar" : "Fechar"}
          </button>
          {editavel && (
            <>
              {r.valorInformado != null && (
                <button type="button" onClick={() => salvar(true)} disabled={salvando} className={classeBotaoSecundario}>
                  Usar o apurado
                </button>
              )}
              <button type="button" onClick={() => salvar(false)} disabled={salvando} className={classeBotaoPrimario}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

const ROTULO_DETALHE: Record<string, string> = {
  motivo: "Motivo",
  semanas: "Sextas com foto da fila",
  sextasNoMes: "Sextas no mês",
  sextasComFoto: "Sextas com foto",
  abertos: "Chamados abertos no mês",
  fechados: "Já fechados",
  idadeMeses: "Idade (meses)",
  abertosAntes: "Abertos antes de",
  abertosAntesDe: "Abertos antes de",
  quantidade: "Quantidade",
  chamados: "Chamados",
  minutosKyria: "Minutos no Kyria",
  horasKyria: "Horas no Kyria",
  minutosPonto: "Minutos no ponto",
  horasPonto: "Horas no ponto",
  saldoBancoMinutos: "Saldo do banco de horas no mês (min)",
  bancoDeHoras: "Banco de horas",
  minutosExtras: "Extras no cálculo (min)",
  minutosTotal: "Total do mês (min)",
  horasTotal: "Total do mês (h)",
  membrosKyria: "Membro(s) Kyria",
  porTime: "Por time do chamado",
  data: "Data",
  emFila: "Em fila",
  aguardandoRetorno: "Aguardando retorno",
  total: "Total",
  codigo: "Código",
  titulo: "Título",
  aberto: "Aberto em",
  status: "Status",
  time: "Time",
  minutos: "Minutos",
  sextasDoMes: "Sextas do mês",
};

/** Mostra o JSON da apuração de forma legível: textos e números em lista, listas de objetos em tabelinha. */
function DetalheCalculo({ detalhe }: { detalhe: Record<string, unknown> }) {
  const escalares = Object.entries(detalhe).filter(([, v]) => v == null || typeof v !== "object");
  const listas = Object.entries(detalhe).filter(([, v]) => Array.isArray(v));
  return (
    <div className="space-y-2 rounded-md border border-border p-3 text-[12.5px]">
      {escalares.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          {escalares.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className={k === "motivo" ? "text-warning" : "text-muted"}>{ROTULO_DETALHE[k] ?? k}</dt>
              <dd className="font-mono text-foreground">{typeof v === "number" ? fmtNumero(v) : String(v ?? "—")}</dd>
            </div>
          ))}
        </dl>
      )}
      {listas.map(([k, v]) => {
        const itens = v as unknown[];
        if (itens.length === 0) return null;
        if (typeof itens[0] !== "object" || itens[0] == null) {
          return (
            <p key={k}>
              <span className="text-muted">{ROTULO_DETALHE[k] ?? k}:</span> <span className="font-mono text-foreground">{itens.join(", ")}</span>
            </p>
          );
        }
        const cols = Object.keys(itens[0] as Record<string, unknown>);
        return (
          <div key={k}>
            <p className="mb-1 text-muted">{ROTULO_DETALHE[k] ?? k}</p>
            <div className="max-h-48 overflow-auto rounded border border-border">
              <table className="w-full text-left">
                <thead className="bg-surface-2">
                  <tr>
                    {cols.map((c) => (
                      <th key={c} className="px-2 py-1 font-medium text-muted">
                        {ROTULO_DETALHE[c] ?? c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it, i) => (
                    <tr key={i} className="border-t border-border">
                      {cols.map((c) => {
                        const x = (it as Record<string, unknown>)[c];
                        return (
                          <td key={c} className="px-2 py-1 font-mono text-foreground">
                            {typeof x === "number" ? fmtNumero(x) : String(x ?? "—")}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
