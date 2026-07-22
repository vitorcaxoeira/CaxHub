import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatHoras, horasParaMinutos, minutosParaInputHoras } from "../../utils/horas";

interface AlocacaoConsultor {
  id: number;
  codfor: number;
  consultorNome: string;
  qtdhor: number | null;
  fasid: number;
  faseDes: string;
  dataPrevistaInicio: string | null;
  dataPrevistaFim: string | null;
  seqati: string | null;
}

interface ItemDetalhe {
  seqite: number;
  codser: string;
  despro: string | null;
  depexe: number | null;
  depexeLabel: string;
  qtdhorItem: number | null;
  horasAlocadas: number;
  saldo: number | null;
  podeAlocar: boolean;
  alocacoes: AlocacaoConsultor[];
}

interface PropostaHeader {
  codemp: number;
  codpro: number;
  numprj: number;
  cliente: string;
  sitpro: number | null;
  sitproLabel: string;
  sitproTone: "success" | "warning" | "destructive" | "neutral";
}

interface ConsultorElegivel {
  codfor: number;
  nome: string;
}

interface Fase {
  fasid: number;
  fasdes: string;
}

type ModalState = { tipo: "criar"; item: ItemDetalhe } | { tipo: "editar"; item: ItemDetalhe; alocacao: AlocacaoConsultor } | null;

const toneBadge: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

function formatPeriodo(inicio: string | null, fim: string | null): string | null {
  if (!inicio && !fim) return null;
  const ini = inicio ? dateFormatter.format(new Date(inicio)) : "?";
  const f = fim ? dateFormatter.format(new Date(fim)) : "?";
  return `${ini} - ${f}`;
}

function paraInputDate(valor: string | null): string {
  if (!valor) return "";
  return valor.slice(0, 10);
}

// Mestre-detalhe: itens da proposta à esquerda (uma linha por seqite), alocações do
// item selecionado à direita — em vez de duas grades soltas que obrigam cruzar pelo
// número de sequência (como no sistema desktop), a seleção já faz esse vínculo.
export function AlocacaoPropostaDetalhe() {
  const { codemp, codpro } = useParams<{ codemp: string; codpro: string }>();
  const navigate = useNavigate();
  const [proposta, setProposta] = useState<PropostaHeader | null>(null);
  const [itens, setItens] = useState<ItemDetalhe[]>([]);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [fases, setFases] = useState<Fase[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Modo de alocação da proposta inteira: "item" (fluxo direto, de sempre) ou
  // "estrutura" (EAP — pastas + atividades-folha). null = ainda não escolhido, mostra
  // o modal de decisão antes de qualquer outra coisa. Escolhido uma vez, trava depois
  // da primeira alocação (ver backend/src/routes/alocacao.ts).
  const [modo, setModo] = useState<"item" | "estrutura" | null | "carregando">("carregando");
  const [definindoModo, setDefinindoModo] = useState(false);
  const [erroModo, setErroModo] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>(null);
  const [consultoresElegiveis, setConsultoresElegiveis] = useState<ConsultorElegivel[]>([]);
  const [codforSelecionado, setCodforSelecionado] = useState("");
  const [fasidSelecionado, setFasidSelecionado] = useState("");
  const [horasForm, setHorasForm] = useState("");
  const [inicioForm, setInicioForm] = useState("");
  const [fimForm, setFimForm] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    axios
      .get(`/api/alocacao/propostas/${codemp}/${codpro}/itens`)
      .then(({ data }) => {
        setProposta(data.proposta);
        setItens(data.itens);
        setErro(null);
        setSelecionado((atual) => atual ?? data.itens[0]?.seqite ?? null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar itens da proposta"))
      .finally(() => setLoading(false));
  }

  function carregarModo() {
    axios
      .get(`/api/alocacao/propostas/${codemp}/${codpro}/modo`)
      .then(({ data }) => setModo(data.modo))
      .catch(() => setModo(null));
  }

  useEffect(() => {
    carregar();
    carregarModo();
    axios
      .get("/api/alocacao/fases")
      .then(({ data }) => setFases(data.fases))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codemp, codpro]);

  // Modo "estrutura" não usa a divisão em 2 telas (lista de itens à esquerda + detalhe
  // à direita) — é uma página única com todos os itens da proposta já carregados, então
  // assim que o modo resolve pra "estrutura" já manda direto pra lá.
  useEffect(() => {
    if (modo === "estrutura") {
      navigate(`/projetos/alocacao/${codemp}/${codpro}/cronograma`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  async function escolherModo(escolha: "item" | "estrutura") {
    setDefinindoModo(true);
    setErroModo(null);
    try {
      await axios.post(`/api/alocacao/propostas/${codemp}/${codpro}/modo`, { modo: escolha });
      setModo(escolha);
    } catch (err: any) {
      setErroModo(err.response?.data?.error ?? "Falha ao definir o modo de alocação");
    } finally {
      setDefinindoModo(false);
    }
  }

  const itemSelecionado = itens.find((i) => i.seqite === selecionado) ?? null;

  function abrirCriar(item: ItemDetalhe) {
    setModal({ tipo: "criar", item });
    setCodforSelecionado("");
    setFasidSelecionado(item.alocacoes[0] ? String(item.alocacoes[0].fasid) : "");
    setHorasForm("");
    setInicioForm("");
    setFimForm("");
    setErroModal(null);
    axios
      .get("/api/alocacao/consultores-elegiveis", { params: { depexe: item.depexe } })
      .then(({ data }) => setConsultoresElegiveis(data.consultores))
      .catch(() => setConsultoresElegiveis([]));
  }

  function abrirEditar(item: ItemDetalhe, alocacao: AlocacaoConsultor) {
    setModal({ tipo: "editar", item, alocacao });
    setHorasForm(minutosParaInputHoras(alocacao.qtdhor));
    setInicioForm(paraInputDate(alocacao.dataPrevistaInicio));
    setFimForm(paraInputDate(alocacao.dataPrevistaFim));
    setErroModal(null);
  }

  function fecharModal() {
    setModal(null);
  }

  async function salvarCriacao() {
    if (!modal || modal.tipo !== "criar") return;
    const minutos = horasParaMinutos(horasForm);
    if (!codforSelecionado || !fasidSelecionado || minutos == null) {
      setErroModal("Preencha consultor, fase e horas no formato hh:mm (maior que zero)");
      return;
    }
    if (inicioForm && fimForm && inicioForm > fimForm) {
      setErroModal("Data de início não pode ser depois da data de fim");
      return;
    }
    setSalvando(true);
    setErroModal(null);
    try {
      const { item } = modal;
      await axios.post(`/api/alocacao/itens/${codemp}/${codpro}/${item.seqite}/alocacoes`, {
        codfor: Number(codforSelecionado),
        qtdhor: minutos,
        fasid: Number(fasidSelecionado),
        dataPrevistaInicio: inicioForm || null,
        dataPrevistaFim: fimForm || null,
      });
      setModal(null);
      carregar();
    } catch (err: any) {
      setErroModal(err.response?.data?.error ?? "Falha ao alocar consultor");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao() {
    if (!modal || modal.tipo !== "editar") return;
    const minutos = horasParaMinutos(horasForm);
    if (minutos == null) {
      setErroModal("Informe horas no formato hh:mm (maior que zero)");
      return;
    }
    if (inicioForm && fimForm && inicioForm > fimForm) {
      setErroModal("Data de início não pode ser depois da data de fim");
      return;
    }
    setSalvando(true);
    setErroModal(null);
    try {
      await axios.patch(`/api/alocacao/alocacoes/${modal.alocacao.id}`, {
        qtdhor: minutos,
        dataPrevistaInicio: inicioForm || null,
        dataPrevistaFim: fimForm || null,
      });
      setModal(null);
      carregar();
    } catch (err: any) {
      setErroModal(err.response?.data?.error ?? "Falha ao editar alocação");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirAlocacao(alocacao: AlocacaoConsultor) {
    if (!window.confirm(`Remover a alocação de "${alocacao.consultorNome}"?`)) return;
    try {
      await axios.delete(`/api/alocacao/alocacoes/${alocacao.id}`);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao remover alocação");
    }
  }

  if (loading && !proposta) {
    return <p className="text-sm text-muted">Carregando...</p>;
  }

  if (erro && !proposta) {
    return (
      <div>
        <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
          ← Voltar pra lista de propostas
        </button>
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
        ← Voltar pra lista de propostas
      </button>

      {proposta && (
        <div className="mb-6 mt-3">
          <p className="flex items-center gap-2 font-display text-2xl font-bold text-foreground">
            Proposta {proposta.codpro} · Projeto {proposta.numprj}
            <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium ${toneBadge[proposta.sitproTone]}`}>
              {proposta.sitproLabel}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted">{proposta.cliente}</p>
        </div>
      )}

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {modo === null && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-2 font-display text-lg font-bold text-foreground">Como esta proposta será alocada?</h2>
            <p className="mb-4 text-sm text-muted">
              Essa escolha vale pra proposta inteira e trava assim que a primeira alocação for feita — não dá pra trocar depois.
            </p>

            {erroModo && (
              <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erroModo}
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                onClick={() => escolherModo("item")}
                disabled={definindoModo}
                className="rounded-lg border border-border p-4 text-left transition hover:border-primary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <p className="font-medium text-foreground">Por item</p>
                <p className="mt-1 text-[12.5px] text-muted">
                  Aloca horas de consultor direto em cada item da proposta — o fluxo de sempre.
                </p>
              </button>
              <button
                onClick={() => escolherModo("estrutura")}
                disabled={definindoModo}
                className="rounded-lg border border-border p-4 text-left transition hover:border-primary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <p className="font-medium text-foreground">Estrutura de pastas e atividades</p>
                <p className="mt-1 text-[12.5px] text-muted">
                  Quebra um item em pastas e atividades-folha (EAP) antes de alocar consultores em cada atividade.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {modo === "item" && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="bg-surface-2 px-3 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Seq
                  </th>
                  <th className="bg-surface-2 px-3 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Item
                  </th>
                  <th className="bg-surface-2 px-3 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr
                    key={item.seqite}
                    onClick={() => setSelecionado(item.seqite)}
                    className={`cursor-pointer border-t border-border/60 transition ${
                      item.seqite === selecionado ? "bg-primary/10" : "hover:bg-surface-2"
                    }`}
                  >
                    <td className="px-3 py-2.5 font-mono text-sm tabular-nums text-muted">
                      {String(item.seqite).padStart(3, "0")}
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5">
                      <p className="truncate text-[12.5px] font-medium text-foreground" title={item.despro ?? undefined}>
                        {item.despro ?? item.codser}
                      </p>
                      <span className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-medium ${toneBadge.neutral}`}>
                        {item.depexeLabel}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono text-[12.5px] tabular-nums ${
                        item.saldo != null && item.saldo < 0 ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {item.qtdhorItem != null && item.saldo != null ? formatHoras(item.saldo / 60) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-border bg-surface p-5">
          {!itemSelecionado ? (
            <p className="text-sm text-muted">Selecione um item à esquerda.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
                    Item {String(itemSelecionado.seqite).padStart(3, "0")} · {itemSelecionado.codser}
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">{itemSelecionado.despro}</p>
                </div>
                <div className="flex-none whitespace-nowrap text-right">
                  <p className="font-mono text-sm tabular-nums text-foreground">
                    {itemSelecionado.qtdhorItem != null ? formatHoras(itemSelecionado.qtdhorItem / 60) : "sem horas definidas"}
                  </p>
                  <p
                    className={`font-mono text-[12px] tabular-nums ${
                      itemSelecionado.saldo != null && itemSelecionado.saldo < 0 ? "text-destructive" : "text-muted"
                    }`}
                  >
                    {itemSelecionado.saldo != null ? `saldo: ${formatHoras(itemSelecionado.saldo / 60)}` : "—"}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                {itemSelecionado.alocacoes.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
                    <div className="text-sm text-foreground">
                      {a.consultorNome}{" "}
                      <span className="text-[11px] text-muted">
                        · {a.qtdhor != null ? formatHoras(a.qtdhor / 60) : "—"} · {a.faseDes}
                        {formatPeriodo(a.dataPrevistaInicio, a.dataPrevistaFim) &&
                          ` · ${formatPeriodo(a.dataPrevistaInicio, a.dataPrevistaFim)}`}
                      </span>
                    </div>
                    {itemSelecionado.podeAlocar && (
                      <div className="flex flex-none gap-3">
                        <button
                          onClick={() => abrirEditar(itemSelecionado, a)}
                          className="text-[12px] text-primary hover:underline"
                        >
                          Editar
                        </button>
                        <button onClick={() => excluirAlocacao(a)} className="text-[12px] text-destructive hover:underline">
                          Remover
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {itemSelecionado.alocacoes.length === 0 && (
                  <p className="text-[12.5px] text-muted">Ninguém alocado ainda.</p>
                )}
              </div>

              {itemSelecionado.podeAlocar && itemSelecionado.qtdhorItem != null && (
                <button
                  onClick={() => abrirCriar(itemSelecionado)}
                  disabled={itemSelecionado.saldo != null && itemSelecionado.saldo <= 0}
                  title={
                    itemSelecionado.saldo != null && itemSelecionado.saldo <= 0
                      ? "Sem saldo — todas as horas do item já foram alocadas"
                      : undefined
                  }
                  className="mt-3 rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  + Alocar consultor
                </button>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-display text-lg font-bold text-foreground">
              {modal.tipo === "criar" ? "Alocar consultor" : "Editar horas alocadas"}
            </h2>

            {erroModal && (
              <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erroModal}
              </p>
            )}

            <div className="space-y-3">
              {modal.tipo === "criar" ? (
                <>
                  <div>
                    <label className="mb-1 block text-[11.5px] text-muted">Consultor</label>
                    <select
                      value={codforSelecionado}
                      onChange={(e) => setCodforSelecionado(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Selecione...</option>
                      {consultoresElegiveis.map((c) => (
                        <option key={c.codfor} value={c.codfor}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11.5px] text-muted">Fase</label>
                    <select
                      value={fasidSelecionado}
                      onChange={(e) => setFasidSelecionado(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Selecione...</option>
                      {fases.map((f) => (
                        <option key={f.fasid} value={f.fasid}>
                          {f.fasdes}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted">{modal.alocacao.consultorNome}</p>
              )}
              <div>
                <label className="mb-1 block text-[11.5px] text-muted">Horas (hh:mm)</label>
                <input
                  type="text"
                  placeholder="ex: 8:00 ou 160:30"
                  value={horasForm}
                  onChange={(e) => setHorasForm(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-[11.5px] text-muted">Início previsto</label>
                  <input
                    type="date"
                    value={inicioForm}
                    onChange={(e) => setInicioForm(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[11.5px] text-muted">Fim previsto</label>
                  <input
                    type="date"
                    value={fimForm}
                    onChange={(e) => setFimForm(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={fecharModal}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                onClick={modal.tipo === "criar" ? salvarCriacao : salvarEdicao}
                disabled={salvando}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
