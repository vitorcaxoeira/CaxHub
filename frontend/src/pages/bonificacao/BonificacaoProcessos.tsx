import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, classeRotulo } from "../../components/gestao5s/campos";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { RegraModal, type RegraDto } from "./RegraModal";
import { classeFiltro, descreverFaixas, fmtCompetencia, fmtData, fmtMoeda, mensagemDe, Selo, useProcessos } from "./comum";

// Gestão de Bonificação › Processos (só admin e administrativo): o cadastro do programa — dados e vigência, indicadores com suas regras por
// vigência (faixas → pontos × valor base) e os consultores enquadrados (com os times Kyria que lideram/atendem, usados na apuração).

interface IndicadorDto {
  id: number;
  chave: string;
  nome: string;
  descricao: string | null;
  fonte: string;
  fonteRotulo: string;
  unidade: string;
  unidadeRotulo: string;
  sentido: string;
  sentidoRotulo: string;
  ordem: number;
  ativo: boolean;
  regras: RegraDto[];
}
interface EnquadramentoDto {
  id: number;
  codfor: number;
  consultor: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  observacao: string | null;
  times: { id: string; nome: string }[];
}
interface ProcessoDetalhe {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  compoeNota: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  indicadores: IndicadorDto[];
  enquadramentos: EnquadramentoDto[];
}
interface TimeKyria {
  id: string;
  name: string;
}

type Aba = "indicadores" | "enquadramento";

const FONTES = [
  { valor: "manual", rotulo: "Lançamento manual (no fechamento)" },
  { valor: "kyria_capacidade", rotulo: "Kyria · fila das sextas (média de chamados em fila/aguardando retorno)" },
  { valor: "kyria_eficiencia", rotulo: "Kyria · % dos chamados abertos no mês que já fecharam" },
  { valor: "kyria_pct_ponto", rotulo: "Kyria + ponto HCM · % do ponto apontado em chamado" },
  { valor: "kyria_chamados_antigos", rotulo: "Kyria · chamados em aberto há mais de N meses" },
];

const hojeIso = () => new Date().toISOString().slice(0, 10);

export function BonificacaoProcessos() {
  const { mostrar } = useToast();
  const [recarga, setRecarga] = useState(0);
  const processos = useProcessos(recarga);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<ProcessoDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("indicadores");
  const [editandoProcesso, setEditandoProcesso] = useState<"novo" | "editar" | null>(null);
  const [indicadorModal, setIndicadorModal] = useState<IndicadorDto | "novo" | null>(null);
  const [regraModal, setRegraModal] = useState<{ indicador: IndicadorDto; regra: RegraDto | null } | null>(null);
  const [enqModal, setEnqModal] = useState<EnquadramentoDto | "novo" | null>(null);

  useEffect(() => {
    if (selecionado == null && processos.length) setSelecionado(processos[0].id);
  }, [processos, selecionado]);

  const carregar = useCallback(() => {
    if (selecionado == null) return;
    axios
      .get<{ processo: ProcessoDetalhe }>(`/api/bonificacao/processos/${selecionado}`)
      .then(({ data }) => {
        setDetalhe(data.processo);
        setErro(null);
      })
      .catch((e) => setErro(mensagemDe(e, "Falha ao carregar o processo")));
  }, [selecionado]);
  useEffect(carregar, [carregar]);

  const atualizar = () => {
    setRecarga((n) => n + 1);
    carregar();
  };

  async function acao(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      mostrar(ok, "success");
      atualizar();
    } catch (e) {
      mostrar(mensagemDe(e, "Não foi possível concluir a ação"), "destructive");
    }
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Bonificação</p>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Processos de bonificação</h1>
          <p className="mt-1 text-sm text-muted">Cada processo tem seus indicadores, regras por vigência e os consultores enquadrados.</p>
        </div>
        <button type="button" onClick={() => setEditandoProcesso("novo")} className={classeBotaoPrimario}>
          Novo processo
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Processo" className={classeFiltro} value={selecionado ?? ""} onChange={(e) => setSelecionado(Number(e.target.value))}>
          {processos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {p.ativo ? "" : " (inativo)"}
            </option>
          ))}
        </select>
        {detalhe && (
          <>
            <Selo texto={detalhe.ativo ? "Ativo" : "Inativo"} tone={detalhe.ativo ? "success" : "neutral"} />
            <span className="text-xs text-muted">
              Vigência {fmtData(detalhe.vigenciaInicio)} {detalhe.vigenciaFim ? `a ${fmtData(detalhe.vigenciaFim)}` : "em diante"}
            </span>
            {detalhe.compoeNota && <Selo texto="Compõe a nota" tone="success" />}
            <button type="button" onClick={() => setEditandoProcesso("editar")} className={classeBotaoSecundario}>
              Editar processo
            </button>
          </>
        )}
      </div>
      {detalhe?.descricao && <p className="mb-3 text-[12.5px] text-muted">{detalhe.descricao}</p>}
      {erro && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

      {!detalhe ? (
        selecionado != null && !erro ? <Skeleton className="h-40 w-full" /> : <p className="text-sm text-muted">Nenhum processo cadastrado.</p>
      ) : (
        <>
          <div className="mb-3 flex gap-1 border-b border-border" role="tablist">
            {(
              [
                ["indicadores", `Indicadores e regras (${detalhe.indicadores.length})`],
                ["enquadramento", `Consultores enquadrados (${detalhe.enquadramentos.length})`],
              ] as const
            ).map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={aba === id}
                onClick={() => setAba(id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${aba === id ? "border-primary font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {aba === "indicadores" && (
            <div className="space-y-3">
              {detalhe.indicadores.map((i) => (
                <section key={i.id} className="rounded-lg border border-border bg-surface">
                  <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">
                        {i.nome} {!i.ativo && <Selo texto="Inativo" tone="neutral" />}
                      </h2>
                      <p className="mt-0.5 text-[12.5px] text-muted">
                        {i.fonteRotulo} · {i.unidadeRotulo} · {i.sentidoRotulo}
                      </p>
                      {i.descricao && <p className="mt-0.5 text-[12.5px] text-muted">{i.descricao}</p>}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <button type="button" onClick={() => setIndicadorModal(i)} className="text-primary hover:underline">
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => window.confirm(`Excluir o indicador "${i.nome}"?`) && acao(() => axios.delete(`/api/bonificacao/indicadores/${i.id}`), "Indicador excluído.")}
                        className="text-destructive hover:underline"
                      >
                        Excluir
                      </button>
                    </div>
                  </header>
                  <div className="px-4 py-3">
                    {i.regras.length === 0 ? (
                      <p className="text-[12.5px] text-warning">Sem regra cadastrada: o indicador fica pendente em todo fechamento.</p>
                    ) : (
                      <ul className="space-y-2">
                        {i.regras.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                            <div>
                              <p className="text-foreground">
                                {fmtCompetencia(r.vigenciaInicio)} {r.vigenciaFim ? `a ${fmtCompetencia(r.vigenciaFim)}` : "em diante"} · <span className="font-mono">{fmtMoeda(r.valorBase)}</span>
                                {r.idadeMeses != null && <span className="text-muted"> · chamado antigo: mais de {r.idadeMeses} meses</span>}
                                {r.observacao && <span className="text-muted"> · {r.observacao}</span>}
                              </p>
                              <p className="text-[12.5px] text-muted">{descreverFaixas(r.faixas, i.sentido, i.unidade)}</p>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                              <button type="button" onClick={() => setRegraModal({ indicador: i, regra: r })} className="text-primary hover:underline">
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => window.confirm("Excluir esta regra?") && acao(() => axios.delete(`/api/bonificacao/regras/${r.id}`), "Regra excluída.")}
                                className="text-destructive hover:underline"
                              >
                                Excluir
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={() => setRegraModal({ indicador: i, regra: null })}
                      className="mt-3 text-xs text-primary hover:underline"
                    >
                      + Nova regra (nova vigência)
                    </button>
                  </div>
                </section>
              ))}
              <button type="button" onClick={() => setIndicadorModal("novo")} className={classeBotaoSecundario}>
                + Novo indicador
              </button>
            </div>
          )}

          {aba === "enquadramento" && (
            <div>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5">Consultor</th>
                      <th className="px-3 py-2.5">Vigência</th>
                      <th className="px-3 py-2.5">Times Kyria</th>
                      <th className="px-3 py-2.5">Observação</th>
                      <th className="px-4 py-2.5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhe.enquadramentos.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-muted">
                          Nenhum consultor enquadrado. Enquadre para que ele entre no fechamento mensal.
                        </td>
                      </tr>
                    )}
                    {detalhe.enquadramentos.map((e) => (
                      <tr key={e.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 font-medium text-foreground">{e.consultor}</td>
                        <td className="px-3 py-2.5 font-mono text-[12.5px] text-muted">
                          {fmtData(e.vigenciaInicio)} {e.vigenciaFim ? `a ${fmtData(e.vigenciaFim)}` : "em diante"}
                        </td>
                        <td className="px-3 py-2.5 text-[12.5px] text-foreground">{e.times.length ? e.times.map((t) => t.nome).join(", ") : <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-2.5 text-[12.5px] text-muted">{e.observacao ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                          <button type="button" onClick={() => setEnqModal(e)} className="mr-3 text-primary hover:underline">
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => window.confirm(`Remover ${e.consultor} do processo?`) && acao(() => axios.delete(`/api/bonificacao/enquadramentos/${e.id}`), "Enquadramento removido.")}
                            className="text-destructive hover:underline"
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => setEnqModal("novo")} className={`${classeBotaoSecundario} mt-3`}>
                + Enquadrar consultor
              </button>
              <p className="mt-2 text-[12px] text-muted">
                Os times Kyria definem o que cada indicador do Kyria mede (fila, abertos x fechados, chamados antigos). Quem tem o mesmo time recebe o mesmo resultado nesses indicadores. Excluir só é possível sem resultados; depois, encerre a vigência.
              </p>
            </div>
          )}
        </>
      )}

      {editandoProcesso && (
        <ModalProcesso
          processo={editandoProcesso === "editar" ? detalhe : null}
          onFechar={() => setEditandoProcesso(null)}
          onSalvo={(id) => {
            setEditandoProcesso(null);
            if (id != null) setSelecionado(id);
            mostrar("Processo salvo.", "success");
            atualizar();
          }}
        />
      )}
      {indicadorModal && detalhe && (
        <ModalIndicador
          processoId={detalhe.id}
          indicador={indicadorModal === "novo" ? null : indicadorModal}
          onFechar={() => setIndicadorModal(null)}
          onSalvo={() => {
            setIndicadorModal(null);
            mostrar("Indicador salvo.", "success");
            atualizar();
          }}
        />
      )}
      {regraModal && (
        <RegraModal
          indicador={regraModal.indicador}
          regra={regraModal.regra}
          sugestaoInicio={sugestaoDeInicio(regraModal.indicador)}
          onFechar={() => setRegraModal(null)}
          onSalvo={() => {
            setRegraModal(null);
            mostrar("Regra salva.", "success");
            atualizar();
          }}
        />
      )}
      {enqModal && detalhe && (
        <ModalEnquadramento
          processoId={detalhe.id}
          enquadramento={enqModal === "novo" ? null : enqModal}
          onFechar={() => setEnqModal(null)}
          onSalvo={() => {
            setEnqModal(null);
            mostrar("Enquadramento salvo.", "success");
            atualizar();
          }}
        />
      )}
    </div>
  );
}

/** Nova regra começa no mês seguinte ao fim da última (ou no mês corrente, se não há regra). */
function sugestaoDeInicio(i: IndicadorDto): string {
  const ordenadas = [...i.regras].sort((a, b) => a.vigenciaInicio.localeCompare(b.vigenciaInicio));
  const ultima = ordenadas[ordenadas.length - 1];
  if (ultima?.vigenciaFim) {
    const d = new Date(`${ultima.vigenciaFim}T00:00:00.000Z`);
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
    return d.toISOString().slice(0, 10);
  }
  return `${hojeIso().slice(0, 7)}-01`;
}

function Rodape({ erro, salvando, onFechar, onSalvar, rotulo = "Salvar", desabilitado = false }: { erro: string | null; salvando: boolean; onFechar: () => void; onSalvar: () => void; rotulo?: string; desabilitado?: boolean }) {
  return (
    <>
      {erro && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onFechar} disabled={salvando} className={classeBotaoSecundario}>
          Cancelar
        </button>
        <button type="button" onClick={onSalvar} disabled={salvando || desabilitado} className={classeBotaoPrimario}>
          {salvando ? "Salvando…" : rotulo}
        </button>
      </div>
    </>
  );
}

function ModalProcesso({ processo, onFechar, onSalvo }: { processo: ProcessoDetalhe | null; onFechar: () => void; onSalvo: (id: number | null) => void }) {
  const [nome, setNome] = useState(processo?.nome ?? "");
  const [descricao, setDescricao] = useState(processo?.descricao ?? "");
  const [inicio, setInicio] = useState(processo?.vigenciaInicio.slice(0, 10) ?? `${new Date().getFullYear()}-01-01`);
  const [fim, setFim] = useState(processo?.vigenciaFim?.slice(0, 10) ?? "");
  const [ativo, setAtivo] = useState(processo?.ativo ?? true);
  const [compoeNota, setCompoeNota] = useState(processo?.compoeNota ?? false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const corpo = { nome, descricao: descricao || null, vigenciaInicio: inicio, vigenciaFim: fim || null, ativo, compoeNota };
    try {
      if (processo) {
        await axios.put(`/api/bonificacao/processos/${processo.id}`, corpo);
        onSalvo(processo.id);
      } else {
        const { data } = await axios.post<{ processo: { id: number } }>("/api/bonificacao/processos", corpo);
        onSalvo(data.processo.id);
      }
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível salvar o processo"));
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title={processo ? "Editar processo" : "Novo processo de bonificação"} fecharPorFora={false}>
      <div className="space-y-3 text-sm">
        <div>
          <label className={classeRotulo} htmlFor="proc-nome">
            Nome
          </label>
          <input id="proc-nome" className={classeCampo} maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </div>
        <div>
          <label className={classeRotulo} htmlFor="proc-desc">
            Descrição
          </label>
          <textarea id="proc-desc" className={classeCampo} rows={2} maxLength={500} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={classeRotulo} htmlFor="proc-ini">
              Vigência — início
            </label>
            <input id="proc-ini" type="date" className={classeCampo} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div>
            <label className={classeRotulo} htmlFor="proc-fim">
              Vigência — fim (opcional)
            </label>
            <input id="proc-fim" type="date" className={classeCampo} value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-foreground">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Processo ativo (inativo não apura)
        </label>
        <div className="rounded-md border border-border p-3">
          <label className="flex items-center gap-2 font-medium text-foreground">
            <input type="checkbox" checked={compoeNota} onChange={(e) => setCompoeNota(e.target.checked)} /> Compõe o valor da nota fiscal
          </label>
          <p className="mt-1 text-[12px] text-muted">
            Ao <strong>fechar</strong> uma competência deste processo, o valor de cada consultor soma ao valor da nota fiscal dele naquela competência (Relatório de Produtividade, base dos
            descontos e Home, com o detalhe de cada bonificação). Vale para os fechamentos feitos daqui para frente: competências já fechadas não mudam; para aplicar numa delas, reabra e feche de novo.
          </p>
        </div>
        <Rodape erro={erro} salvando={salvando} onFechar={onFechar} onSalvar={salvar} desabilitado={!nome.trim() || !inicio} />
      </div>
    </Modal>
  );
}

function ModalIndicador({ processoId, indicador, onFechar, onSalvo }: { processoId: number; indicador: IndicadorDto | null; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(indicador?.nome ?? "");
  const [descricao, setDescricao] = useState(indicador?.descricao ?? "");
  const [fonte, setFonte] = useState(indicador?.fonte ?? "manual");
  const [unidade, setUnidade] = useState(indicador?.unidade ?? "quantidade");
  const [sentido, setSentido] = useState(indicador?.sentido ?? "menor_melhor");
  const [ordem, setOrdem] = useState(String(indicador?.ordem ?? ""));
  const [ativo, setAtivo] = useState(indicador?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      if (indicador) await axios.put(`/api/bonificacao/indicadores/${indicador.id}`, { nome, descricao: descricao || null, ordem, ativo });
      else await axios.post(`/api/bonificacao/processos/${processoId}/indicadores`, { nome, descricao: descricao || null, fonte, unidade, sentido });
      onSalvo();
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível salvar o indicador"));
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title={indicador ? "Editar indicador" : "Novo indicador"} fecharPorFora={false}>
      <div className="space-y-3 text-sm">
        <div>
          <label className={classeRotulo} htmlFor="ind-nome">
            Nome
          </label>
          <input id="ind-nome" className={classeCampo} maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </div>
        <div>
          <label className={classeRotulo} htmlFor="ind-desc">
            Descrição
          </label>
          <input id="ind-desc" className={classeCampo} maxLength={500} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        {indicador ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={classeRotulo} htmlFor="ind-ordem">
                Ordem
              </label>
              <input id="ind-ordem" className={classeCampo} inputMode="numeric" value={ordem} onChange={(e) => setOrdem(e.target.value)} />
            </div>
            <label className="mt-6 flex items-center gap-2 text-foreground">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Indicador ativo
            </label>
            <p className="col-span-2 text-[12px] text-muted">Fonte, unidade e sentido não mudam depois de criados (as regras dependem deles): crie outro indicador se precisar.</p>
          </div>
        ) : (
          <>
            <div>
              <label className={classeRotulo} htmlFor="ind-fonte">
                De onde vem o valor
              </label>
              <select id="ind-fonte" className={classeCampo} value={fonte} onChange={(e) => setFonte(e.target.value)}>
                {FONTES.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={classeRotulo} htmlFor="ind-unidade">
                  Unidade
                </label>
                <select id="ind-unidade" className={classeCampo} value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                  <option value="quantidade">Quantidade</option>
                  <option value="percentual">Percentual (0 a 100)</option>
                  <option value="horas">Horas</option>
                </select>
              </div>
              <div>
                <label className={classeRotulo} htmlFor="ind-sentido">
                  Sentido
                </label>
                <select id="ind-sentido" className={classeCampo} value={sentido} onChange={(e) => setSentido(e.target.value)}>
                  <option value="menor_melhor">Quanto menor, melhor (até X)</option>
                  <option value="maior_melhor">Quanto maior, melhor (a partir de X)</option>
                </select>
              </div>
            </div>
          </>
        )}
        <Rodape erro={erro} salvando={salvando} onFechar={onFechar} onSalvar={salvar} desabilitado={!nome.trim()} />
      </div>
    </Modal>
  );
}

function ModalEnquadramento({ processoId, enquadramento, onFechar, onSalvo }: { processoId: number; enquadramento: EnquadramentoDto | null; onFechar: () => void; onSalvo: () => void }) {
  const [consultores, setConsultores] = useState<{ codfor: number; nome: string }[]>([]);
  const [times, setTimes] = useState<TimeKyria[]>([]);
  const [codfor, setCodfor] = useState(enquadramento ? String(enquadramento.codfor) : "");
  const [inicio, setInicio] = useState(enquadramento?.vigenciaInicio.slice(0, 10) ?? `${new Date().getFullYear()}-01-01`);
  const [fim, setFim] = useState(enquadramento?.vigenciaFim?.slice(0, 10) ?? "");
  const [obs, setObs] = useState(enquadramento?.observacao ?? "");
  const [timesSel, setTimesSel] = useState<Set<string>>(new Set(enquadramento?.times.map((t) => t.id) ?? []));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    axios.get<{ consultores: { codfor: number; nome: string }[] }>("/api/bonificacao/consultores").then(({ data }) => setConsultores(data.consultores)).catch(() => undefined);
    axios.get<{ times: TimeKyria[] }>("/api/bonificacao/times-kyria").then(({ data }) => setTimes(data.times)).catch(() => undefined);
  }, []);

  const alternar = (id: string) =>
    setTimesSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const corpo = { codfor: Number(codfor), vigenciaInicio: inicio, vigenciaFim: fim || null, observacao: obs || null, timesIds: [...timesSel] };
    try {
      if (enquadramento) await axios.put(`/api/bonificacao/enquadramentos/${enquadramento.id}`, corpo);
      else await axios.post(`/api/bonificacao/processos/${processoId}/enquadramentos`, corpo);
      onSalvo();
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível salvar o enquadramento"));
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title={enquadramento ? `Editar enquadramento · ${enquadramento.consultor}` : "Enquadrar consultor"} fecharPorFora={false}>
      <div className="space-y-3 text-sm">
        {!enquadramento && (
          <div>
            <label className={classeRotulo} htmlFor="enq-cons">
              Consultor
            </label>
            <select id="enq-cons" className={classeCampo} value={codfor} onChange={(e) => setCodfor(e.target.value)}>
              <option value="">Selecione…</option>
              {consultores.map((c) => (
                <option key={c.codfor} value={c.codfor}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={classeRotulo} htmlFor="enq-ini">
              Vigência — início
            </label>
            <input id="enq-ini" type="date" className={classeCampo} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div>
            <label className={classeRotulo} htmlFor="enq-fim">
              Vigência — fim (opcional)
            </label>
            <input id="enq-fim" type="date" className={classeCampo} value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} />
          </div>
        </div>
        <div>
          <p className={classeRotulo}>Times do Kyria que a pessoa lidera / atende</p>
          <div className="max-h-44 overflow-y-auto rounded-md border border-border p-2">
            {times.length === 0 && <p className="text-xs text-muted">Nenhum time ativo sincronizado.</p>}
            {times.map((t) => (
              <label key={t.id} className="flex items-center gap-2 py-0.5 text-foreground">
                <input type="checkbox" checked={timesSel.has(t.id)} onChange={() => alternar(t.id)} /> {t.name}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11.5px] text-muted">Usados nos indicadores do Kyria (fila, abertos x fechados, chamados antigos). O % do ponto apontado usa o vínculo do consultor com o Kyria.</p>
        </div>
        <div>
          <label className={classeRotulo} htmlFor="enq-obs">
            Observação
          </label>
          <input id="enq-obs" className={classeCampo} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} />
        </div>
        <Rodape erro={erro} salvando={salvando} onFechar={onFechar} onSalvar={salvar} desabilitado={!codfor || !inicio} />
      </div>
    </Modal>
  );
}
