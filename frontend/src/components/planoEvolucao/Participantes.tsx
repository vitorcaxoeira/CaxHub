import axios from "axios";
import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { CiclosResposta, ParticipanteDto, ParticipantesResposta, brl2, dataBr } from "../../lib/planoEvolucao";
import { Cartao, Chip, Vazio } from "../eficiencia/comum";

const campo =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const botaoSecundario =
  "rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const botaoPrimario =
  "rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

const normalizar = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

type Dialogo = { tipo: "aderir" } | { tipo: "valor"; p: ParticipanteDto } | { tipo: "encerrar"; p: ParticipanteDto } | null;

// Quem está no plano, com adesão, 1º ciclo e (só para o admin) o Valor Hora Base e o histórico dele. O gestor vê só o time dele, sem valores.
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
        {!mostraValores && <p className="mt-3 text-[12px] text-muted">Valor hora é dado sensível e só o administrador vê.</p>}
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

function ModalAdesao({ onFechar, onSalvo }: { onFechar: () => void; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [opcoes, setOpcoes] = useState<{ codfor: number; nome: string; departamento: string | null }[] | null>(null);
  const [busca, setBusca] = useState("");
  const [codfor, setCodfor] = useState<number | "">("");
  const [dataAdesao, setDataAdesao] = useState("");
  const [valor, setValor] = useState("");
  const [anteriores, setAnteriores] = useState("0");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get<{ opcoes: { codfor: number; nome: string; departamento: string | null }[] }>("/api/plano-evolucao/participantes/opcoes")
      .then(({ data }) => setOpcoes(data.opcoes))
      .catch((e) => setErro(mensagemDe(e, "Não foi possível carregar os consultores.")));
  }, []);

  const filtradas = useMemo(() => (opcoes ?? []).filter((o) => normalizar(`${o.nome} ${o.departamento ?? ""}`).includes(normalizar(busca))).slice(0, 80), [opcoes, busca]);
  const valorNum = Number(valor.replace(",", "."));
  const invalido = codfor === "" || !/^\d{4}-\d{2}-\d{2}$/.test(dataAdesao) || !(valorNum > 0);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (invalido || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await axios.post("/api/plano-evolucao/participantes", { codfor, dataAdesao, valorHoraBase: valor, ciclosConsecutivosAntes: anteriores });
      mostrar("Adesão registrada.", "success");
      onSalvo();
    } catch (e2) {
      setErro(mensagemDe(e2, "Não foi possível registrar a adesão."));
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onFechar} title="Registrar adesão ao plano" subtitulo="Termo de Ciência e Comprometimento assinado" fecharPorFora={false}>
      <form onSubmit={enviar} className="space-y-4">
        <div>
          <label htmlFor="ad-busca" className="mb-1 block text-[13px] font-medium text-foreground">Consultor</label>
          <input id="ad-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou departamento…" className={`${campo} mb-1.5`} autoFocus />
          <select id="ad-consultor" size={6} value={codfor} onChange={(e) => setCodfor(e.target.value === "" ? "" : Number(e.target.value))} className={campo} aria-label="Consultor" required>
            {opcoes == null && <option disabled>Carregando…</option>}
            {filtradas.map((o) => (
              <option key={o.codfor} value={o.codfor}>
                {o.nome}
                {o.departamento ? ` · ${o.departamento}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="ad-data" className="mb-1 block text-[13px] font-medium text-foreground">Assinatura do termo</label>
            <input id="ad-data" type="date" value={dataAdesao} onChange={(e) => setDataAdesao(e.target.value)} className={campo} required />
          </div>
          <div>
            <label htmlFor="ad-valor" className="mb-1 block text-[13px] font-medium text-foreground">Valor Hora Base (R$)</label>
            <input id="ad-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ex.: 150,00" className={campo} required />
          </div>
          <div>
            <label htmlFor="ad-ant" className="mb-1 block text-[13px] font-medium text-foreground">Ciclos já cumpridos</label>
            <input id="ad-ant" inputMode="numeric" value={anteriores} onChange={(e) => setAnteriores(e.target.value)} className={campo} />
          </div>
        </div>
        <p className="text-[12px] text-muted">
          O 1º ciclo começa em 01/01/2027 para quem assina até essa data; depois, no primeiro dia do semestre seguinte. "Ciclos já cumpridos" só vale para histórico trazido de fora do CaxHub (normalmente 0).
        </p>
        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{erro}</p>}
        <Rodape enviando={enviando} invalido={invalido} rotulo="Registrar adesão" onFechar={onFechar} />
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
