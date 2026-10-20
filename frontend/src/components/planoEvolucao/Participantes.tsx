import axios from "axios";
import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Avatar } from "../ui/Avatar";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { CiclosResposta, OpcoesAdesao, ParticipanteDto, ParticipantesResposta, brl2, dataBr } from "../../lib/planoEvolucao";
import { Cartao, Chip, Vazio } from "../eficiencia/comum";

const campo =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const botaoSecundario =
  "rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const botaoPrimario =
  "rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

const normalizar = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

type Dialogo = { tipo: "aderir" } | { tipo: "valor"; p: ParticipanteDto } | { tipo: "encerrar"; p: ParticipanteDto } | null;

// Quem está no plano, com adesão, 1º ciclo, Valor Hora Base e histórico. Admin e gestores da Consultoria ERP e HCM veem e mantêm tudo.
export function Participantes({ dados, podeEditar, motivosValorBase, onMudou }: { dados: ParticipantesResposta; podeEditar: boolean; motivosValorBase: CiclosResposta["motivosValorBase"]; onMudou: () => void }) {
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [aberto, setAberto] = useState<number | null>(null);
  const fechar = () => setDialogo(null);
  const mostraValores = dados.mostraValores;
  const ativos = dados.participantes.filter((p) => p.status === "ativo").length;

  return (
    <div className="space-y-5">
      <Cartao
        titulo="Participantes do plano"
        nota={`${ativos} ativo${ativos === 1 ? "" : "s"} · ${dados.participantes.length - ativos} encerrado${dados.participantes.length - ativos === 1 ? "" : "s"}`}
        acao={
          podeEditar ? (
            <button type="button" onClick={() => setDialogo({ tipo: "aderir" })} className={botaoPrimario}>
              Registrar adesão
            </button>
          ) : undefined
        }
      >
        {dados.participantes.length === 0 ? (
          <Vazio>{podeEditar ? "Ninguém aderiu ainda. Registre a assinatura do Termo de Ciência de cada consultor PJ." : "Nenhum consultor do seu time está no plano."}</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm [&_td]:px-2 [&_th]:px-2">
              <thead>
                <tr className="text-left font-mono text-[10.5px] uppercase tracking-wider text-muted">
                  <th className="py-2 font-medium">Consultor</th>
                  <th className="py-2 font-medium">Adesão</th>
                  <th className="py-2 font-medium">1º ciclo</th>
                  <th className="py-2 text-right font-medium">Ciclos já cumpridos</th>
                  {mostraValores && <th className="py-2 text-right font-medium">Valor Hora Base</th>}
                  <th className="py-2 font-medium">Situação</th>
                  {podeEditar && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {dados.participantes.map((p) => (
                  <Fragment key={p.id}>
                    <tr className={`border-t border-border/60 ${p.status === "encerrado" ? "opacity-60" : ""}`}>
                      <td className="px-2.5 py-2">
                        <span className="block font-medium text-foreground">{p.nome}</span>
                        <span className="block text-[11.5px] text-muted">{p.departamento ?? "—"}</span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2 font-mono text-[12.5px]">{dataBr(p.dataAdesao)}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 font-mono text-[12.5px]">{dataBr(p.primeiroCicloInicio)}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{p.ciclosConsecutivosAntes}</td>
                      {mostraValores && <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{brl2(p.valorHoraBase)}</td>}
                      <td className="px-2.5 py-2">
                        <Chip tom={p.status === "ativo" ? "ok" : "off"}>{p.status === "ativo" ? "ativo" : "encerrado"}</Chip>
                        {p.motivoEncerramento && <span className="block max-w-[200px] truncate text-[11px] text-muted" title={p.motivoEncerramento}>{p.motivoEncerramento}</span>}
                      </td>
                      {podeEditar && (
                        <td className="whitespace-nowrap px-2.5 py-2 text-right">
                          <button type="button" onClick={() => setAberto(aberto === p.id ? null : p.id)} aria-expanded={aberto === p.id} className="mr-3 text-[12.5px] font-medium text-primary hover:underline">
                            Histórico
                          </button>
                          {p.status === "ativo" && (
                            <>
                              <button type="button" onClick={() => setDialogo({ tipo: "valor", p })} className="mr-3 text-[12.5px] font-medium text-primary hover:underline">
                                Novo valor base
                              </button>
                              <button type="button" onClick={() => setDialogo({ tipo: "encerrar", p })} className="text-[12.5px] font-medium text-destructive hover:underline">
                                Encerrar
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                    {aberto === p.id && p.historicoBase && (
                      <tr className="bg-surface-2/50">
                        <td colSpan={7} className="px-4 py-3">
                          <p className="mb-1.5 text-[12px] font-medium text-foreground">Histórico do Valor Hora Base (nunca reescrito: cada mudança é uma linha nova)</p>
                          <ul className="space-y-1 text-[12.5px]">
                            {p.historicoBase.map((h) => (
                              <li key={h.id} className="flex flex-wrap gap-x-4 text-muted">
                                <span className="font-mono text-foreground">{brl2(h.valorHoraBase)}</span>
                                <span>desde {dataBr(h.desde)}</span>
                                <span>{h.motivoRotulo}</span>
                                {h.observacao && <span>— {h.observacao}</span>}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!mostraValores && <p className="mt-3 text-[12px] text-muted">Valor hora é dado sensível: só o administrador e os gestores da Consultoria ERP e HCM veem.</p>}
      </Cartao>

      {dialogo?.tipo === "aderir" && <ModalAdesao onFechar={fechar} onSalvo={() => (fechar(), onMudou())} />}
      {dialogo?.tipo === "valor" && <ModalValorBase p={dialogo.p} motivos={motivosValorBase} onFechar={fechar} onSalvo={() => (fechar(), onMudou())} />}
      {dialogo?.tipo === "encerrar" && <ModalEncerrar p={dialogo.p} onFechar={fechar} onSalvo={() => (fechar(), onMudou())} />}
    </div>
  );
}

function Rodape({ enviando, invalido, rotulo, onFechar }: { enviando: boolean; invalido: boolean; rotulo: string; onFechar: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onFechar} disabled={enviando} className={botaoSecundario}>
        Cancelar
      </button>
      <button type="submit" disabled={invalido || enviando} className={botaoPrimario}>
        {enviando ? "Salvando…" : rotulo}
      </button>
    </div>
  );
}

const mensagemDe = (e: unknown, padrao: string) => (axios.isAxiosError(e) ? e.response?.data?.error ?? padrao : padrao);

// Adesão em lote, no espírito da alocação de consultores: escolhe o departamento (só os da área do ciclo atual), marca vários
// integrantes ativos (a marcação ACUMULA entre departamentos) e salva uma vez. Data de assinatura e ciclos já cumpridos valem para todos;
// o Valor Hora Base é de cada um. Quem já está no plano aparece desabilitado. O POST /participantes/lote é tudo ou nada.
type Marcado = { nome: string; valor: string };

// "1.234,56" e "150,5" no formato brasileiro; sem vírgula, o ponto é decimal ("150.50").
const valorDe = (texto: string) => {
  const t = texto.replace(/R\$\s*/i, "").trim();
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
};

function ModalAdesao({ onFechar, onSalvo }: { onFechar: () => void; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [opcoes, setOpcoes] = useState<OpcoesAdesao | null>(null);
  const [depexe, setDepexe] = useState<number | "">("");
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Record<number, Marcado>>({});
  const [dataAdesao, setDataAdesao] = useState("");
  const [anteriores, setAnteriores] = useState("0");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get<OpcoesAdesao>("/api/plano-evolucao/participantes/opcoes")
      .then(({ data }) => setOpcoes(data))
      .catch((e) => setErro(mensagemDe(e, "Não foi possível carregar os departamentos.")));
  }, []);

  const departamento = opcoes?.departamentos.find((d) => d.depexe === depexe) ?? null;
  const filtradas = useMemo(() => (departamento?.integrantes ?? []).filter((o) => normalizar(o.nome).includes(normalizar(busca))), [departamento, busca]);
  const semCiclo = opcoes != null && opcoes.ciclo == null;
  const lista = Object.entries(marcados).map(([codfor, m]) => ({ codfor: Number(codfor), ...m }));
  const semValor = lista.filter((m) => !(valorDe(m.valor) > 0));
  const invalido = semCiclo || lista.length === 0 || semValor.length > 0 || !/^\d{4}-\d{2}-\d{2}$/.test(dataAdesao);

  function alternar(codfor: number, nome: string) {
    setMarcados((atual) => {
      const novo = { ...atual };
      if (novo[codfor]) delete novo[codfor];
      else novo[codfor] = { nome, valor: "" };
      return novo;
    });
  }

  // "Aplicar valor a todos": copia o primeiro valor preenchido para todas as linhas marcadas (o papel do "Distribuir igualmente").
  function aplicarATodos() {
    const base = lista.find((m) => valorDe(m.valor) > 0)?.valor;
    if (!base) return;
    setMarcados((atual) => Object.fromEntries(Object.entries(atual).map(([k, m]) => [k, { ...m, valor: base }])));
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (invalido || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const { data } = await axios.post<{ criados: unknown[] }>("/api/plano-evolucao/participantes/lote", {
        dataAdesao,
        ciclosConsecutivosAntes: anteriores,
        itens: lista.map((m) => ({ codfor: m.codfor, valorHoraBase: valorDe(m.valor) })),
      });
      mostrar(data.criados.length === 1 ? "Adesão registrada." : `${data.criados.length} adesões registradas.`, "success");
      onSalvo();
    } catch (e2) {
      setErro(mensagemDe(e2, "Não foi possível registrar as adesões."));
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title="Registrar adesão ao plano" subtitulo="Termo de Ciência e Comprometimento assinado" fecharPorFora={false}>
      <form onSubmit={enviar} className="space-y-4">
        {semCiclo ? (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-foreground">
            Cadastre um ciclo (aba Ciclos e parâmetros) antes de registrar adesões: os departamentos vêm da área do ciclo.
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="ad-departamento" className="mb-1 block text-[13px] font-medium text-foreground">Departamento</label>
              <select
                id="ad-departamento"
                value={depexe}
                onChange={(e) => {
                  setDepexe(e.target.value === "" ? "" : Number(e.target.value));
                  setBusca("");
                }}
                className={campo}
                disabled={opcoes == null}
                autoFocus
              >
                <option value="">{opcoes == null ? "Carregando…" : "Escolha o departamento"}</option>
                {opcoes?.departamentos.map((d) => (
                  <option key={d.depexe} value={d.depexe}>
                    {d.rotulo} · {d.integrantes.length} integrante{d.integrantes.length === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              {opcoes?.ciclo && <p className="mt-1 text-[11.5px] text-muted">Departamentos da área do ciclo {opcoes.ciclo.rotulo}; só integrantes ativos do time.</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ad-data" className="mb-1 block text-[13px] font-medium text-foreground">Assinatura do termo</label>
                <input id="ad-data" type="date" value={dataAdesao} onChange={(e) => setDataAdesao(e.target.value)} className={campo} required />
              </div>
              <div>
                <label htmlFor="ad-ant" className="mb-1 block text-[13px] font-medium text-foreground">Ciclos já cumpridos</label>
                <input id="ad-ant" inputMode="numeric" value={anteriores} onChange={(e) => setAnteriores(e.target.value)} className={campo} />
              </div>
            </div>

            {departamento && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <p className="text-[11.5px] font-medium text-muted">
                    Consultores do time
                    {/* Contador da seleção ACUMULADA: quem marcou gente em outro departamento não vê esses nomes na lista à vista. */}
                    {lista.length > 0 && <span className="ml-1.5 text-primary">· {lista.length} selecionado{lista.length === 1 ? "" : "s"}</span>}
                  </p>
                  <button
                    type="button"
                    onClick={aplicarATodos}
                    disabled={lista.length < 2 || !lista.some((m) => valorDe(m.valor) > 0)}
                    className="text-[11.5px] font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                  >
                    Aplicar valor a todos
                  </button>
                </div>
                {departamento.integrantes.length > 6 && (
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={`Buscar em ${departamento.rotulo}…`} aria-label="Buscar consultor" className={`${campo} mb-1.5`} />
                )}
                {departamento.integrantes.length === 0 ? (
                  <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-muted">Nenhum integrante ativo em {departamento.rotulo}.</p>
                ) : (
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
                    {filtradas.map((o) => {
                      const m = marcados[o.codfor];
                      return (
                        <label key={o.codfor} className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 transition ${o.jaNoPlano ? "opacity-60" : m ? "bg-primary/5" : "hover:bg-surface-2"}`}>
                          <input type="checkbox" checked={!!m || o.jaNoPlano} disabled={o.jaNoPlano} onChange={() => alternar(o.codfor, o.nome)} className="h-4 w-4 flex-none accent-primary" />
                          <Avatar nome={o.nome} fotoUrl={o.fotoUrl} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{o.nome}</span>
                          {o.jaNoPlano ? (
                            <span className="flex-none text-[11.5px] text-muted">já no plano</span>
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="R$ 0,00"
                              aria-label={`Valor Hora Base de ${o.nome}`}
                              value={m?.valor ?? ""}
                              disabled={!m}
                              onChange={(e) => setMarcados((atual) => ({ ...atual, [o.codfor]: { ...atual[o.codfor], valor: e.target.value } }))}
                              className="w-24 flex-none rounded-md border border-border bg-surface px-2 py-1 text-right font-mono text-[12.5px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
                {lista.length > 0 && semValor.length > 0 && <p className="mt-1.5 text-[12px] text-muted">Falta o Valor Hora Base de {semValor.map((m) => m.nome).join(", ")}.</p>}
              </div>
            )}
          </>
        )}
        <p className="text-[12px] text-muted">
          O 1º ciclo começa em 01/01/2027 para quem assina até essa data; depois, no primeiro dia do semestre seguinte. "Ciclos já cumpridos" só vale para histórico trazido de fora do CaxHub (normalmente 0).
        </p>
        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{erro}</p>}
        <Rodape enviando={enviando} invalido={invalido} rotulo={lista.length > 1 ? `Registrar ${lista.length} adesões` : "Registrar adesão"} onFechar={onFechar} />
      </form>
    </Modal>
  );
}

function ModalValorBase({ p, motivos, onFechar, onSalvo }: { p: ParticipanteDto; motivos: CiclosResposta["motivosValorBase"]; onFechar: () => void; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [valor, setValor] = useState("");
  const [desde, setDesde] = useState("");
  const [motivo, setMotivo] = useState("reajuste");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const invalido = !(Number(valor.replace(",", ".")) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(desde);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (invalido || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await axios.post(`/api/plano-evolucao/participantes/${p.id}/valor-base`, { valorHoraBase: valor, desde, motivo, observacao: observacao.trim() || undefined });
      mostrar("Novo Valor Hora Base lançado.", "success");
      onSalvo();
    } catch (e2) {
      setErro(mensagemDe(e2, "Não foi possível lançar o valor."));
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title="Novo Valor Hora Base" subtitulo={`${p.nome} · hoje ${brl2(p.valorHoraBase)}`} fecharPorFora={false}>
      <form onSubmit={enviar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="vb-valor" className="mb-1 block text-[13px] font-medium text-foreground">Novo valor (R$)</label>
            <input id="vb-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className={campo} required autoFocus />
          </div>
          <div>
            <label htmlFor="vb-desde" className="mb-1 block text-[13px] font-medium text-foreground">Vale desde</label>
            <input id="vb-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={campo} required />
          </div>
          <div>
            <label htmlFor="vb-motivo" className="mb-1 block text-[13px] font-medium text-foreground">Motivo</label>
            <select id="vb-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo}>
              {motivos.map((m) => (
                <option key={m.chave} value={m.chave}>
                  {m.rotulo}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="vb-obs" className="mb-1 block text-[13px] font-medium text-foreground">Observação <span className="text-muted">(opcional)</span></label>
          <input id="vb-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={300} className={campo} />
        </div>
        <p className="text-[12px] text-muted">O histórico nunca é reescrito: o valor anterior continua registrado e a mudança entra na auditoria.</p>
        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{erro}</p>}
        <Rodape enviando={enviando} invalido={invalido} rotulo="Lançar valor" onFechar={onFechar} />
      </form>
    </Modal>
  );
}

function ModalEncerrar({ p, onFechar, onSalvo }: { p: ParticipanteDto; onFechar: () => void; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim() === "" || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await axios.post(`/api/plano-evolucao/participantes/${p.id}/encerrar`, { motivo: motivo.trim() });
      mostrar("Participação encerrada.", "success");
      onSalvo();
    } catch (e2) {
      setErro(mensagemDe(e2, "Não foi possível encerrar."));
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title="Encerrar a participação" subtitulo={p.nome} fecharPorFora={false}>
      <form onSubmit={enviar} className="space-y-4">
        <p className="text-[13px] text-muted">O encerramento do contrato encerra a participação e extingue os percentuais ainda não efetivados (regulamento, item 14).</p>
        <div>
          <label htmlFor="enc-motivo" className="mb-1 block text-[13px] font-medium text-foreground">Motivo</label>
          <textarea id="enc-motivo" rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`${campo} resize-y`} required autoFocus />
        </div>
        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{erro}</p>}
        <Rodape enviando={enviando} invalido={motivo.trim() === ""} rotulo="Encerrar participação" onFechar={onFechar} />
      </form>
    </Modal>
  );
}
