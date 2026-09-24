import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { HistoricoContextual } from "../../components/auditoria/HistoricoContextual";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { RoteiroViagem } from "../../components/solicitacoes/RoteiroViagem";
import { StatusViagemBadge } from "../../components/solicitacoes/StatusViagemBadge";
import {
  classeBotaoPerigo,
  classeBotaoPrimario,
  classeBotaoSecundario,
  classeCampo,
  classeRotulo,
} from "../../components/solicitacoes/campos";
import {
  FINALIDADE_ROTULO,
  FLUXO,
  STATUS_ROTULO,
  TIPO_ROTULO,
  formatarCpfExibicao,
  formatarDia,
  formatarMoeda,
  formatarPeriodo,
  mensagemDeErro,
  type Finalidade,
  type StatusViagem,
  type TipoItem,
} from "../../utils/solicitacoesViagem";

interface ViajanteDet {
  id: number;
  userId: number | null;
  nome: string;
  cpf: string;
}
interface ItemDet {
  id: number;
  tipo: TipoItem;
  viajantes: number[];
  cidade: string | null;
  origem: string | null;
  destino: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  horaInicio: string | null;
  horaFim: string | null;
  tipoAcomodacao: string | null;
  hotelPreferencia: string | null;
  necessidades: string | null;
  flexibilidadeHorario: string | null;
  bagagem: string | null;
  companhiaPreferencia: string | null;
  localRetirada: string | null;
  localDevolucao: string | null;
  categoriaVeiculo: string | null;
  observacoes: string | null;
  fornecedor: string | null;
  localizador: string | null;
  valorReservado: number | null;
}
interface CotacaoDet {
  id: number;
  itemId: number | null;
  fornecedor: string;
  descricao: string | null;
  valor: number;
  validadeAte: string | null;
  selecionada: boolean;
  autorNome: string | null;
}
interface AnexoDet {
  id: number;
  itemId: number | null;
  categoria: string;
  nomeArquivo: string;
  tamanhoBytes: number;
  autorNome: string;
  criadoEm: string;
}
interface Detalhe {
  id: number;
  status: StatusViagem;
  finalidade: Finalidade;
  motivo: string;
  solicitante: { id: number; nome: string } | null;
  atendimento: { id: number; nome: string } | null;
  aprovador: { id: number; nome: string } | null;
  cliente: { codcli: number; nomcli: string; apecli: string } | null;
  propostaRotulo: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  cidadesDestino: string;
  observacoes: string | null;
  roteiroObservacao: string | null;
  valorAprovado: number | null;
  valorProposto: number;
  valorReservado: number;
  aprovadoEm: string | null;
  observacaoDecisao: string | null;
  motivoCancelamento: string | null;
  criadoEm: string;
  viajantes: ViajanteDet[];
  itens: ItemDet[];
  cotacoes: CotacaoDet[];
  anexos: AnexoDet[];
  pode: {
    editar: boolean;
    assumir: boolean;
    cotar: boolean;
    enviarAprovacao: boolean;
    decidir: boolean;
    reservar: boolean;
    finalizar: boolean;
    cancelar: boolean;
    anexar: boolean;
  };
}

const CATEGORIAS_ANEXO = [
  { valor: "cotacao", rotulo: "Cotação" },
  { valor: "comprovante", rotulo: "Comprovante" },
  { valor: "voucher", rotulo: "Voucher / bilhete" },
  { valor: "outro", rotulo: "Outro" },
];

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function tamanho(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Secao({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</p>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11.5px] text-muted">{rotulo}</p>
      <p className="text-sm text-foreground">{valor || "—"}</p>
    </div>
  );
}

export function SolicitacaoViagemDetalhe() {
  const { id } = useParams();
  const toast = useToast();
  const [s, setS] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versaoHistorico, setVersaoHistorico] = useState(0);

  const [modalDecisao, setModalDecisao] = useState<"aprovar" | "reprovar" | "devolver" | null>(null);
  const [modalCancelar, setModalCancelar] = useState(false);
  const [textoModal, setTextoModal] = useState("");
  const [valorModal, setValorModal] = useState("");

  const carregar = useCallback(async () => {
    try {
      const { data } = await axios.get(`/api/solicitacoes-viagem/${id}`);
      setS(data.solicitacao);
      setErro(null);
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível abrir a solicitação"));
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Toda ação devolve a solicitação atualizada; o histórico é remontado pra mostrar o evento novo.
  async function acao(chamada: () => Promise<{ data: { solicitacao: Detalhe; revalidacao?: boolean } }>, sucesso: string) {
    setOcupado(true);
    try {
      const { data } = await chamada();
      setS(data.solicitacao);
      setVersaoHistorico((v) => v + 1);
      if (data.revalidacao) toast.mostrar("O valor reservado passou do aprovado — voltou para aprovação", "warning");
      else toast.mostrar(sucesso, "success");
    } catch (err) {
      toast.mostrar(mensagemDeErro(err, "Não foi possível concluir a ação"), "destructive");
    } finally {
      setOcupado(false);
    }
  }

  const base = `/api/solicitacoes-viagem/${id}`;

  if (erro) return <p className="text-sm text-destructive">{erro}</p>;
  if (!s) return <p className="text-sm text-muted">Carregando...</p>;

  const nomeViajante = (vid: number) => s.viajantes.find((v) => v.id === vid)?.nome ?? "—";
  const indiceFluxo = FLUXO.indexOf(s.status);
  const encerradaFora = s.status === "reprovada" || s.status === "cancelada";

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Gestão de Solicitações · Viagens</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold text-foreground">Solicitação #{s.id}</h1>
            <StatusViagemBadge status={s.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/solicitacoes/minhas" className={classeBotaoSecundario}>
              Voltar
            </Link>
            {s.pode.editar && (
              <Link to={`/solicitacoes/${s.id}/editar`} className={classeBotaoSecundario}>
                {s.status === "aprovada" || s.status === "reservada" ? "Ajustar datas" : "Editar"}
              </Link>
            )}
            {s.pode.assumir && (
              <button disabled={ocupado} onClick={() => acao(() => axios.post(`${base}/assumir`), "Solicitação assumida")} className={classeBotaoPrimario}>
                Assumir cotação
              </button>
            )}
            {s.pode.enviarAprovacao && (
              <button disabled={ocupado} onClick={() => acao(() => axios.post(`${base}/enviar-aprovacao`), "Enviada para aprovação")} className={classeBotaoPrimario}>
                Enviar para aprovação
              </button>
            )}
            {s.pode.decidir && (
              <>
                <button
                  disabled={ocupado}
                  onClick={() => {
                    setTextoModal("");
                    setValorModal(String(s.valorProposto || s.valorAprovado || ""));
                    setModalDecisao("aprovar");
                  }}
                  className={classeBotaoPrimario}
                >
                  Aprovar
                </button>
                <button disabled={ocupado} onClick={() => { setTextoModal(""); setModalDecisao("devolver"); }} className={classeBotaoSecundario}>
                  Devolver p/ cotação
                </button>
                <button disabled={ocupado} onClick={() => { setTextoModal(""); setModalDecisao("reprovar"); }} className={classeBotaoPerigo}>
                  Reprovar
                </button>
              </>
            )}
            {s.pode.reservar && s.status === "aprovada" && (
              <button disabled={ocupado} onClick={() => acao(() => axios.post(`${base}/reservar`), "Reserva concluída")} className={classeBotaoPrimario}>
                Concluir reserva
              </button>
            )}
            {s.pode.finalizar && (
              <button disabled={ocupado} onClick={() => acao(() => axios.post(`${base}/finalizar`), "Solicitação finalizada")} className={classeBotaoPrimario}>
                Finalizar
              </button>
            )}
            {s.pode.cancelar && (
              <button disabled={ocupado} onClick={() => { setTextoModal(""); setModalCancelar(true); }} className={classeBotaoPerigo}>
                Cancelar
              </button>
            )}
          </div>
        </div>

        {!encerradaFora && (
          <ol className="mt-4 flex flex-wrap items-center gap-1.5">
            {FLUXO.map((f, ix) => (
              <li key={f} className="flex items-center gap-1.5">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                    ix === indiceFluxo ? "bg-primary text-primary-foreground" : ix < indiceFluxo ? "bg-success/15 text-success" : "border border-border text-muted"
                  }`}
                >
                  {STATUS_ROTULO[f]}
                </span>
                {ix < FLUXO.length - 1 && <span className="text-muted">›</span>}
              </li>
            ))}
          </ol>
        )}
        {s.status === "reprovada" && s.observacaoDecisao && <p className="mt-3 text-sm text-destructive">Reprovada: {s.observacaoDecisao}</p>}
        {s.status === "cancelada" && s.motivoCancelamento && <p className="mt-3 text-sm text-destructive">Cancelada: {s.motivoCancelamento}</p>}
        {s.status === "em_cotacao" && s.observacaoDecisao && <p className="mt-3 text-sm text-warning">Devolvida pelo aprovador: {s.observacaoDecisao}</p>}
      </div>

      <Secao titulo="Dados gerais">
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Solicitante" valor={s.solicitante?.nome ?? "Usuário removido"} />
          <Campo rotulo="Finalidade" valor={FINALIDADE_ROTULO[s.finalidade]} />
          <Campo rotulo="Atendimento" valor={s.atendimento?.nome} />
          <Campo rotulo="Cliente" valor={s.cliente ? s.cliente.apecli || s.cliente.nomcli : null} />
          <Campo rotulo="Proposta" valor={s.propostaRotulo} />
          <Campo rotulo="Solicitada em" valor={dataHora.format(new Date(s.criadoEm))} />
          <Campo rotulo="Período" valor={formatarPeriodo(s.dataInicio, s.dataFim)} />
          <Campo rotulo="Destino(s)" valor={s.cidadesDestino} />
          <Campo rotulo="Viajantes" valor={s.viajantes.length} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Motivo" valor={s.motivo} />
          <Campo rotulo="Observações" valor={s.observacoes} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Valor cotado (selecionadas)" valor={formatarMoeda(s.valorProposto)} />
          <Campo rotulo={`Valor aprovado${s.aprovador ? ` por ${s.aprovador.nome}` : ""}`} valor={formatarMoeda(s.valorAprovado)} />
          <Campo rotulo="Valor reservado" valor={formatarMoeda(s.valorReservado || null)} />
        </div>
      </Secao>

      <Secao titulo="Viajantes">
        <ul className="grid gap-2 sm:grid-cols-2">
          {s.viajantes.map((v) => (
            <li key={v.id} className="rounded-md border border-border px-3 py-2 text-sm">
              <span className="text-foreground">{v.nome}</span>
              <span className="ml-2 font-mono text-[12px] text-muted">{formatarCpfExibicao(v.cpf)}</span>
              {v.userId != null && <span className="ml-2 text-[11px] text-muted">(usuário CaxHub)</span>}
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="Serviços">
        <div className="space-y-3">
          {s.itens.map((i) => (
            <ItemCard key={i.id} item={i} nomeViajante={nomeViajante} podeReservar={s.pode.reservar} ocupado={ocupado} onSalvarReserva={(dados) => acao(() => axios.put(`${base}/itens/${i.id}/reserva`, dados), "Reserva registrada")} />
          ))}
        </div>
      </Secao>

      <Secao titulo="Roteiro">
        <RoteiroViagem viajantes={s.viajantes.map((v) => ({ chave: v.id, nome: v.nome }))} itens={s.itens} />
        {s.roteiroObservacao && <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{s.roteiroObservacao}</p>}
      </Secao>

      <Cotacoes s={s} ocupado={ocupado} base={base} acao={acao} />

      <Anexos s={s} base={base} onMudou={(novo) => { setS(novo); setVersaoHistorico((v) => v + 1); }} />

      <Secao titulo="Histórico">
        <HistoricoContextual key={versaoHistorico} entidadeTipo="solicitacao_viagem" entidadeId={s.id} />
      </Secao>

      <Modal
        open={modalDecisao !== null}
        onClose={() => setModalDecisao(null)}
        fecharPorFora={false}
        title={modalDecisao === "aprovar" ? "Aprovar solicitação" : modalDecisao === "reprovar" ? "Reprovar solicitação" : "Devolver para nova cotação"}
        subtitulo={`Solicitação #${s.id}`}
      >
        <div className="space-y-3 p-4">
          {modalDecisao === "aprovar" && (
            <div>
              <label className={classeRotulo}>Valor aprovado (R$)</label>
              <input value={valorModal} onChange={(e) => setValorModal(e.target.value)} inputMode="decimal" className={classeCampo} />
              <p className="mt-1 text-[11.5px] text-muted">Já vem com a soma das cotações selecionadas ({formatarMoeda(s.valorProposto)}). Reservar acima deste valor exige nova aprovação.</p>
            </div>
          )}
          <div>
            <label className={classeRotulo}>{modalDecisao === "aprovar" ? "Observação (opcional)" : "Motivo"}</label>
            <textarea value={textoModal} onChange={(e) => setTextoModal(e.target.value)} rows={3} maxLength={1000} className={`${classeCampo} resize-none`} />
          </div>
          <div className="flex justify-end gap-2">
            <button className={classeBotaoSecundario} onClick={() => setModalDecisao(null)}>
              Voltar
            </button>
            <button
              disabled={ocupado || (modalDecisao !== "aprovar" && !textoModal.trim())}
              className={modalDecisao === "reprovar" ? classeBotaoPerigo : classeBotaoPrimario}
              onClick={async () => {
                const decisao = modalDecisao!;
                const valor = Number(valorModal.replace(",", "."));
                if (decisao === "aprovar" && valorModal.trim() && !Number.isFinite(valor)) return toast.mostrar("Valor inválido", "destructive");
                await acao(
                  () =>
                    axios.post(`${base}/decidir`, {
                      acao: decisao,
                      observacao: textoModal,
                      valorAprovado: decisao === "aprovar" && valorModal.trim() ? valor : undefined,
                    }),
                  decisao === "aprovar" ? "Solicitação aprovada" : decisao === "reprovar" ? "Solicitação reprovada" : "Devolvida para cotação"
                );
                setModalDecisao(null);
              }}
            >
              Confirmar
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={modalCancelar} onClose={() => setModalCancelar(false)} fecharPorFora={false} title="Cancelar solicitação" subtitulo={`Solicitação #${s.id}`}>
        <div className="space-y-3 p-4">
          <div>
            <label className={classeRotulo}>Motivo do cancelamento</label>
            <textarea value={textoModal} onChange={(e) => setTextoModal(e.target.value)} rows={3} maxLength={1000} className={`${classeCampo} resize-none`} />
          </div>
          <div className="flex justify-end gap-2">
            <button className={classeBotaoSecundario} onClick={() => setModalCancelar(false)}>
              Voltar
            </button>
            <button
              disabled={ocupado || !textoModal.trim()}
              className={classeBotaoPerigo}
              onClick={async () => {
                await acao(() => axios.post(`${base}/cancelar`, { motivo: textoModal }), "Solicitação cancelada");
                setModalCancelar(false);
              }}
            >
              Cancelar solicitação
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ItemCard({
  item,
  nomeViajante,
  podeReservar,
  ocupado,
  onSalvarReserva,
}: {
  item: ItemDet;
  nomeViajante: (id: number) => string;
  podeReservar: boolean;
  ocupado: boolean;
  onSalvarReserva: (dados: { fornecedor: string; localizador: string; valorReservado: number }) => void;
}) {
  const [fornecedor, setFornecedor] = useState(item.fornecedor ?? "");
  const [localizador, setLocalizador] = useState(item.localizador ?? "");
  const [valor, setValor] = useState(item.valorReservado != null ? String(item.valorReservado) : "");
  const toast = useToast();

  const linhas: [string, string | null][] =
    item.tipo === "hospedagem"
      ? [
          ["Cidade", item.cidade],
          ["Check-in / check-out", formatarPeriodo(item.dataInicio, item.dataFim)],
          ["Chegada prevista", item.horaInicio],
          ["Acomodação", item.tipoAcomodacao === "compartilhado" ? "Quarto compartilhado / grupo" : "Quarto individual"],
          ["Hotel de preferência", item.hotelPreferencia],
          ["Necessidades", item.necessidades],
        ]
      : item.tipo === "aereo"
        ? [
            ["Trecho", `${item.origem ?? "?"} → ${item.destino ?? "?"}`],
            ["Ida", `${formatarDia(item.dataInicio)}${item.horaInicio ? ` às ${item.horaInicio}` : ""}`],
            ["Retorno", item.dataFim ? formatarDia(item.dataFim) : null],
            ["Flexibilidade", item.flexibilidadeHorario],
            ["Bagagem", item.bagagem],
            ["Companhia", item.companhiaPreferencia],
          ]
        : [
            ["Retirada", `${item.localRetirada ?? "?"} · ${formatarDia(item.dataInicio)}${item.horaInicio ? ` ${item.horaInicio}` : ""}`],
            ["Devolução", `${item.localDevolucao ?? "?"} · ${formatarDia(item.dataFim)}${item.horaFim ? ` ${item.horaFim}` : ""}`],
            ["Categoria", item.categoriaVeiculo],
          ];

  return (
    <div className="rounded-md border border-border p-4">
      <p className="text-sm font-semibold text-foreground">
        {TIPO_ROTULO[item.tipo]} <span className="font-normal text-muted">· {item.viajantes.map(nomeViajante).join(", ")}</span>
      </p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {linhas
          .filter(([, v]) => v)
          .map(([r, v]) => (
            <div key={r} className="flex gap-2">
              <dt className="w-36 flex-none text-muted">{r}</dt>
              <dd className="text-foreground">{v}</dd>
            </div>
          ))}
        {item.observacoes && (
          <div className="flex gap-2 sm:col-span-2">
            <dt className="w-36 flex-none text-muted">Observações</dt>
            <dd className="text-foreground">{item.observacoes}</dd>
          </div>
        )}
      </dl>

      {(item.localizador || podeReservar) && (
        <div className="mt-3 rounded-md bg-surface-2/60 p-3">
          <p className="mb-2 text-[11.5px] font-medium text-muted">Reserva</p>
          {podeReservar ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
              <div>
                <label className={classeRotulo}>Fornecedor</label>
                <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className={classeCampo} />
              </div>
              <div>
                <label className={classeRotulo}>Localizador / nº da reserva</label>
                <input value={localizador} onChange={(e) => setLocalizador(e.target.value)} className={classeCampo} />
              </div>
              <div>
                <label className={classeRotulo}>Valor (R$)</label>
                <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className={classeCampo} />
              </div>
              <button
                disabled={ocupado}
                className={classeBotaoSecundario}
                onClick={() => {
                  const n = Number(valor.replace(",", "."));
                  if (!localizador.trim()) return toast.mostrar("Informe o localizador", "destructive");
                  if (!Number.isFinite(n)) return toast.mostrar("Valor inválido", "destructive");
                  onSalvarReserva({ fornecedor, localizador, valorReservado: n });
                }}
              >
                Salvar
              </button>
            </div>
          ) : (
            <p className="text-sm text-foreground">
              {item.fornecedor} · <span className="font-mono">{item.localizador}</span> · {formatarMoeda(item.valorReservado)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Cotacoes({
  s,
  ocupado,
  base,
  acao,
}: {
  s: Detalhe;
  ocupado: boolean;
  base: string;
  acao: (chamada: () => Promise<{ data: { solicitacao: Detalhe } }>, sucesso: string) => Promise<void>;
}) {
  const [fornecedor, setFornecedor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [validade, setValidade] = useState("");
  const [itemId, setItemId] = useState("");
  const toast = useToast();

  if (s.cotacoes.length === 0 && !s.pode.cotar) return null;

  const rotuloItem = (id: number | null) => {
    const i = s.itens.find((x) => x.id === id);
    return i ? TIPO_ROTULO[i.tipo] : "Geral";
  };

  return (
    <Secao titulo="Cotações">
      {s.cotacoes.length === 0 ? (
        <p className="text-[12.5px] text-muted">Nenhuma cotação registrada.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-[11.5px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Escolhida</th>
                <th className="py-2 pr-3 font-medium">Fornecedor</th>
                <th className="py-2 pr-3 font-medium">Serviço</th>
                <th className="py-2 pr-3 font-medium">Descrição</th>
                <th className="py-2 pr-3 font-medium">Validade</th>
                <th className="py-2 pr-3 text-right font-medium">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.cotacoes.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={c.selecionada}
                      disabled={!s.pode.cotar || ocupado}
                      onChange={(e) => acao(() => axios.post(`${base}/cotacoes/${c.id}/selecionar`, { selecionada: e.target.checked }), "Cotação atualizada")}
                    />
                  </td>
                  <td className="py-2 pr-3 text-foreground">{c.fornecedor}</td>
                  <td className="py-2 pr-3 text-muted">{rotuloItem(c.itemId)}</td>
                  <td className="py-2 pr-3 text-muted">{c.descricao ?? "—"}</td>
                  <td className="py-2 pr-3 text-muted">{c.validadeAte ? formatarDia(c.validadeAte) : "—"}</td>
                  <td className="py-2 pr-3 text-right font-mono text-foreground">{formatarMoeda(c.valor)}</td>
                  <td className="py-2 text-right">
                    {s.pode.cotar && (
                      <button disabled={ocupado} onClick={() => acao(() => axios.delete(`${base}/cotacoes/${c.id}`), "Cotação removida")} className="text-[12px] text-destructive hover:underline">
                        Excluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="pt-2 text-right text-[12px] text-muted">
                  Total das escolhidas
                </td>
                <td className="pt-2 text-right font-mono font-semibold text-foreground">{formatarMoeda(s.valorProposto)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {s.pode.cotar && (
        <div className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label className={classeRotulo}>Fornecedor</label>
            <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className={classeCampo} />
          </div>
          <div>
            <label className={classeRotulo}>Serviço</label>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={classeCampo}>
              <option value="">Geral</option>
              {s.itens.map((i) => (
                <option key={i.id} value={i.id}>
                  {TIPO_ROTULO[i.tipo]} #{i.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={classeRotulo}>Valor (R$)</label>
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className={classeCampo} />
          </div>
          <div>
            <label className={classeRotulo}>Válida até</label>
            <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className={classeCampo} />
          </div>
          <div className="flex items-end">
            <button
              disabled={ocupado}
              className={`${classeBotaoSecundario} w-full`}
              onClick={async () => {
                const n = Number(valor.replace(",", "."));
                if (!fornecedor.trim()) return toast.mostrar("Informe o fornecedor", "destructive");
                if (!Number.isFinite(n)) return toast.mostrar("Valor inválido", "destructive");
                await acao(() => axios.post(`${base}/cotacoes`, { fornecedor, descricao, valor: n, validadeAte: validade || null, itemId: itemId || null }), "Cotação adicionada");
                setFornecedor("");
                setDescricao("");
                setValor("");
                setValidade("");
              }}
            >
              Adicionar
            </button>
          </div>
          <div className="sm:col-span-6">
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (ex.: voo 10h20, tarifa flex)" className={classeCampo} />
          </div>
        </div>
      )}
    </Secao>
  );
}

function Anexos({ s, base, onMudou }: { s: Detalhe; base: string; onMudou: (novo: Detalhe) => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [categoria, setCategoria] = useState("cotacao");
  const [enviando, setEnviando] = useState(false);

  async function enviar(arquivo: File) {
    setEnviando(true);
    const form = new FormData();
    form.append("arquivo", arquivo);
    form.append("categoria", categoria);
    try {
      const { data } = await axios.post(`${base}/anexos`, form);
      onMudou(data.solicitacao);
      toast.mostrar("Anexo enviado", "success");
    } catch (err) {
      toast.mostrar(mensagemDeErro(err, "Falha ao enviar o anexo"), "destructive");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function baixar(a: AnexoDet) {
    try {
      const { data } = await axios.get(`${base}/anexos/${a.id}/download`, { responseType: "blob" });
      const url = window.URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.nomeArquivo;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.mostrar("Não foi possível baixar o anexo", "destructive");
    }
  }

  async function excluir(a: AnexoDet) {
    try {
      await axios.delete(`${base}/anexos/${a.id}`);
      const { data } = await axios.get(base);
      onMudou(data.solicitacao);
    } catch (err) {
      toast.mostrar(mensagemDeErro(err, "Falha ao excluir o anexo"), "destructive");
    }
  }

  return (
    <Secao titulo="Anexos e comprovantes">
      <div className="space-y-1.5">
        {s.anexos.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
            <button onClick={() => baixar(a)} className="truncate text-sm text-primary hover:underline">
              {a.nomeArquivo}
            </button>
            <div className="flex flex-none items-center gap-3 text-[11.5px] text-muted">
              <span>{CATEGORIAS_ANEXO.find((c) => c.valor === a.categoria)?.rotulo ?? a.categoria}</span>
              <span>{tamanho(a.tamanhoBytes)}</span>
              <span>{a.autorNome}</span>
              {s.pode.anexar && (
                <button onClick={() => excluir(a)} className="text-destructive hover:underline">
                  Excluir
                </button>
              )}
            </div>
          </div>
        ))}
        {s.anexos.length === 0 && <p className="text-[12.5px] text-muted">Sem anexos.</p>}
      </div>
      {s.pode.anexar && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={`${classeCampo} w-auto`}>
            {CATEGORIAS_ANEXO.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.rotulo}
              </option>
            ))}
          </select>
          <input
            ref={inputRef}
            type="file"
            disabled={enviando}
            onChange={(e) => e.target.files?.[0] && enviar(e.target.files[0])}
            className="text-[12.5px] text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          />
        </div>
      )}
    </Secao>
  );
}
