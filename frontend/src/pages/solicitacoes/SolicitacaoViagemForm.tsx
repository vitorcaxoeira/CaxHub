import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AutocompleteRemoto } from "../../components/ui/AutocompleteRemoto";
import { useToast } from "../../components/ui/Toast";
import { RoteiroViagem } from "../../components/solicitacoes/RoteiroViagem";
import {
  classeBotaoPrimario,
  classeBotaoSecundario,
  classeCampo,
  classeRotulo,
} from "../../components/solicitacoes/campos";
import {
  FINALIDADE_DICA,
  FINALIDADE_ROTULO,
  TIPO_ROTULO,
  cpfValido,
  itemVazio,
  mascararCpfDigitado,
  mensagemDeErro,
  soDigitos,
  type Finalidade,
  type ItemViagem,
  type TipoItem,
  type Viajante,
} from "../../utils/solicitacoesViagem";

interface ClienteOpcao {
  codcli: number;
  nomcli: string;
  apecli: string;
}
interface PropostaOpcao {
  codemp: number;
  codpro: number;
  despro: string | null;
  codcli: number;
  clienteNome: string;
}
interface UsuarioOpcao {
  id: number;
  nome: string;
}

const ETAPAS = ["Serviços", "Dados gerais", "Viajantes", "Detalhes", "Revisão"] as const;
const TIPOS: TipoItem[] = ["hospedagem", "aereo", "carro"];
const FINALIDADES = Object.keys(FINALIDADE_ROTULO) as Finalidade[];

// Quando a viagem já foi aprovada, a estrutura (quem, o quê, onde) fica travada: só datas,
// horários e observação dos itens existentes podem ser ajustados (remarcação) — o backend
// recusa o resto, aqui a tela só não oferece.
const STATUS_AJUSTE = ["aprovada", "reservada"];

export function SolicitacaoViagemForm() {
  const { id } = useParams();
  const editando = id !== undefined;
  const navigate = useNavigate();
  const toast = useToast();

  const [etapa, setEtapa] = useState(0);
  const [carregando, setCarregando] = useState(editando);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [statusAtual, setStatusAtual] = useState<string | null>(null);

  const [finalidade, setFinalidade] = useState<Finalidade>("projeto");
  const [motivo, setMotivo] = useState("");
  const [cliente, setCliente] = useState<ClienteOpcao | null>(null);
  const [proposta, setProposta] = useState<PropostaOpcao | null>(null);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [cidadesDestino, setCidadesDestino] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [roteiroObservacao, setRoteiroObservacao] = useState("");
  const [viajantes, setViajantes] = useState<Viajante[]>([{ userId: null, nome: "", cpf: "" }]);
  const [itens, setItens] = useState<ItemViagem[]>([]);

  const modoAjuste = statusAtual !== null && STATUS_AJUSTE.includes(statusAtual);
  const servicos = useMemo(() => Object.fromEntries(TIPOS.map((t) => [t, itens.some((i) => i.tipo === t)])) as Record<TipoItem, boolean>, [itens]);

  // Edição: carrega a solicitação e converte os ids de viajante dos itens em índices da lista.
  useEffect(() => {
    if (!editando) return;
    axios
      .get(`/api/solicitacoes-viagem/${id}`)
      .then(({ data }) => {
        const s = data.solicitacao;
        setStatusAtual(s.status);
        setFinalidade(s.finalidade);
        setMotivo(s.motivo);
        setCliente(s.cliente ? { codcli: s.cliente.codcli, nomcli: s.cliente.nomcli, apecli: s.cliente.apecli } : null);
        setProposta(
          s.codpro != null
            ? { codemp: s.codemp, codpro: s.codpro, despro: null, codcli: s.codcli, clienteNome: s.cliente ? s.cliente.apecli || s.cliente.nomcli : "" }
            : null
        );
        setDataInicio(s.dataInicio ?? "");
        setDataFim(s.dataFim ?? "");
        setCidadesDestino(s.cidadesDestino);
        setObservacoes(s.observacoes ?? "");
        setRoteiroObservacao(s.roteiroObservacao ?? "");
        const vs: Viajante[] = s.viajantes.map((v: { id: number; userId: number | null; nome: string; cpf: string }) => ({
          id: v.id,
          userId: v.userId,
          nome: v.nome,
          // O servidor mascara o CPF pra quem não pode ver inteiro; nesse caso a edição é bloqueada pelo backend.
          cpf: v.cpf,
        }));
        setViajantes(vs);
        setItens(
          s.itens.map((i: Record<string, unknown> & { viajantes: number[] }) => ({
            ...itemVazio(i.tipo as TipoItem),
            ...Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v ?? ""])),
            viajantes: i.viajantes.map((vid) => vs.findIndex((v) => v.id === vid)).filter((ix) => ix >= 0),
          }))
        );
      })
      .catch((err) => setErro(mensagemDeErro(err, "Não foi possível carregar a solicitação")))
      .finally(() => setCarregando(false));
  }, [editando, id]);

  // ---------- serviços ----------

  function alternarServico(tipo: TipoItem) {
    if (servicos[tipo]) {
      setItens((atual) => atual.filter((i) => i.tipo !== tipo));
    } else {
      setItens((atual) => [...atual, novoItem(tipo)]);
    }
  }

  function novoItem(tipo: TipoItem): ItemViagem {
    const base = itemVazio(tipo);
    // Carro tem um só responsável; os demais começam com todo mundo marcado (o caso comum).
    base.viajantes = tipo === "carro" ? (viajantes.length ? [0] : []) : viajantes.map((_, ix) => ix);
    if (tipo === "hospedagem" || tipo === "carro") {
      base.dataInicio = dataInicio;
      base.dataFim = dataFim;
    } else {
      base.dataInicio = dataInicio;
    }
    return base;
  }

  // ---------- viajantes ----------

  function atualizarViajante(ix: number, parcial: Partial<Viajante>) {
    setViajantes((atual) => atual.map((v, i) => (i === ix ? { ...v, ...parcial } : v)));
  }

  function adicionarViajante() {
    setViajantes((atual) => [...atual, { userId: null, nome: "", cpf: "" }]);
  }

  // Remover um viajante desloca os índices que os itens guardam — remapeia, e descarta o
  // vínculo com quem saiu.
  function removerViajante(ix: number) {
    setViajantes((atual) => atual.filter((_, i) => i !== ix));
    setItens((atual) =>
      atual.map((i) => ({ ...i, viajantes: i.viajantes.filter((v) => v !== ix).map((v) => (v > ix ? v - 1 : v)) }))
    );
  }

  // ---------- itens ----------

  function atualizarItem(ix: number, parcial: Partial<ItemViagem>) {
    setItens((atual) => atual.map((i, k) => (k === ix ? { ...i, ...parcial } : i)));
  }

  function alternarViajanteDoItem(ix: number, viajanteIx: number, unico: boolean) {
    setItens((atual) =>
      atual.map((i, k) => {
        if (k !== ix) return i;
        if (unico) return { ...i, viajantes: [viajanteIx] };
        return { ...i, viajantes: i.viajantes.includes(viajanteIx) ? i.viajantes.filter((v) => v !== viajanteIx) : [...i.viajantes, viajanteIx] };
      })
    );
  }

  // ---------- validação (espelha o backend; ele continua sendo quem decide) ----------

  function validarEtapa(alvo: number): string | null {
    if (alvo >= 0 && itens.length === 0) return "Marque ao menos um serviço (hospedagem, passagem aérea ou carro)";
    if (alvo >= 1) {
      if (!motivo.trim()) return "Informe o motivo da viagem";
      if (finalidade === "projeto" && !proposta) return "Para viagem de projeto, informe a proposta";
      if (finalidade === "comercial" && !proposta && !cliente) return "Para visita comercial, informe o cliente";
      if (!dataInicio || !dataFim) return "Informe o período da viagem";
      if (dataFim < dataInicio) return "O término da viagem é anterior ao início";
      if (!cidadesDestino.trim()) return "Informe a(s) cidade(s) de destino";
    }
    if (alvo >= 2) {
      for (const [ix, v] of viajantes.entries()) {
        if (!v.nome.trim()) return `Viajante ${ix + 1}: informe o nome completo`;
        if (soDigitos(v.cpf) !== "" && !cpfValido(v.cpf)) return `Viajante ${ix + 1}: CPF inválido`;
      }
    }
    if (alvo >= 3) {
      for (const i of itens) {
        const rot = `${TIPO_ROTULO[i.tipo]} ${itens.filter((x) => x.tipo === i.tipo).indexOf(i) + 1}`;
        if (i.viajantes.length === 0) return `${rot}: escolha quem viaja`;
        if (i.dataFim && i.dataInicio && i.dataFim < i.dataInicio) return `${rot}: a data final é anterior à inicial`;
        if (i.tipo === "hospedagem" && (!i.cidade.trim() || !i.dataInicio || !i.dataFim)) return `${rot}: informe cidade, check-in e check-out`;
        if (i.tipo === "aereo" && (!i.origem.trim() || !i.destino.trim() || !i.dataInicio)) return `${rot}: informe origem, destino e data de ida`;
        if (i.tipo === "carro" && (!i.localRetirada.trim() || !i.localDevolucao.trim() || !i.dataInicio || !i.dataFim)) return `${rot}: informe retirada, devolução e datas`;
      }
    }
    return null;
  }

  function avancar() {
    const msg = validarEtapa(etapa);
    if (msg) return setErro(msg);
    setErro(null);
    setEtapa((e) => Math.min(ETAPAS.length - 1, e + 1));
  }

  async function salvar() {
    const msg = modoAjuste ? null : validarEtapa(3);
    if (msg) return setErro(msg);
    setSalvando(true);
    setErro(null);
    try {
      if (modoAjuste) {
        await axios.put(`/api/solicitacoes-viagem/${id}`, {
          itens: itens.map((i) => ({ id: i.id, dataInicio: i.dataInicio, dataFim: i.dataFim, horaInicio: i.horaInicio, horaFim: i.horaFim, observacoes: i.observacoes })),
        });
        toast.mostrar("Datas e horários atualizados", "success");
        return navigate(`/solicitacoes/${id}`);
      }
      const corpo = {
        finalidade,
        motivo,
        codcli: proposta ? proposta.codcli : cliente?.codcli,
        codemp: proposta?.codemp,
        codpro: proposta?.codpro,
        dataInicio,
        dataFim,
        cidadesDestino,
        observacoes,
        roteiroObservacao,
        viajantes: viajantes.map((v) => ({ id: v.id, userId: v.userId, nome: v.nome, cpf: soDigitos(v.cpf) })),
        itens,
      };
      if (editando) {
        await axios.put(`/api/solicitacoes-viagem/${id}`, corpo);
        toast.mostrar("Solicitação atualizada", "success");
        navigate(`/solicitacoes/${id}`);
      } else {
        const { data } = await axios.post("/api/solicitacoes-viagem", corpo);
        toast.mostrar(`Solicitação #${data.id} enviada`, "success");
        navigate(`/solicitacoes/${data.id}`);
      }
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível salvar a solicitação"));
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <p className="text-sm text-muted">Carregando...</p>;

  const roteiroViajantes = viajantes.map((v, ix) => ({ chave: ix, nome: v.nome || `Viajante ${ix + 1}` }));
  const ultima = etapa === ETAPAS.length - 1;

  return (
    <div className="max-w-4xl">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Gestão de Solicitações · Viagens</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-foreground">{editando ? `Editar solicitação #${id}` : "Nova solicitação de viagem"}</h1>
      {modoAjuste && (
        <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-foreground">
          Esta solicitação já foi aprovada: só é possível ajustar datas, horários e observações dos itens existentes. Para mudar quem viaja ou o tipo de serviço, cancele e abra uma nova.
        </p>
      )}

      {!modoAjuste && (
        <ol className="mt-4 flex flex-wrap gap-2">
          {ETAPAS.map((nome, ix) => (
            <li key={nome}>
              <button
                type="button"
                onClick={() => {
                  // Voltar é sempre livre; avançar só passando pela validação de cada etapa no caminho.
                  if (ix <= etapa) return setEtapa(ix);
                  const msg = validarEtapa(ix - 1);
                  if (msg) return setErro(msg);
                  setErro(null);
                  setEtapa(ix);
                }}
                className={`rounded-md px-3 py-1 text-[12.5px] font-medium ${
                  ix === etapa ? "bg-primary text-primary-foreground" : ix < etapa ? "border border-primary/50 text-foreground" : "border border-border text-muted hover:bg-surface-2"
                }`}
              >
                {ix + 1}. {nome}
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 rounded-lg border border-border bg-surface p-5">
        {/* ---------- 1. Serviços ---------- */}
        {!modoAjuste && etapa === 0 && (
          <section>
            <p className="text-base font-semibold text-foreground">O que você precisa reservar?</p>
            <p className="mt-1 text-sm text-muted">Só os campos dos serviços marcados aparecem nas próximas etapas.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {TIPOS.map((t) => (
                <label
                  key={t}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm ${servicos[t] ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted hover:bg-surface-2"}`}
                >
                  <input type="checkbox" checked={servicos[t]} onChange={() => alternarServico(t)} className="h-4 w-4" />
                  {TIPO_ROTULO[t]}
                </label>
              ))}
            </div>
          </section>
        )}

        {/* ---------- 2. Dados gerais ---------- */}
        {!modoAjuste && etapa === 1 && (
          <section className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={classeRotulo}>Finalidade da viagem</label>
                <select value={finalidade} onChange={(e) => setFinalidade(e.target.value as Finalidade)} className={classeCampo}>
                  {FINALIDADES.map((f) => (
                    <option key={f} value={f}>
                      {FINALIDADE_ROTULO[f]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11.5px] text-muted">{FINALIDADE_DICA[finalidade]}</p>
              </div>
              <div>
                <label className={classeRotulo}>Cidade(s) de destino</label>
                <input value={cidadesDestino} onChange={(e) => setCidadesDestino(e.target.value)} className={classeCampo} maxLength={500} placeholder="Ex.: São Paulo, Curitiba" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {finalidade !== "projeto" && (
                <div>
                  <label className={classeRotulo}>Cliente{finalidade === "comercial" ? " *" : " (opcional)"}</label>
                  <AutocompleteRemoto<ClienteOpcao>
                    valor={proposta ? { codcli: proposta.codcli, nomcli: proposta.clienteNome, apecli: proposta.clienteNome } : cliente}
                    onChange={setCliente}
                    url="/api/solicitacoes-viagem/apoio/clientes"
                    chaveLista="clientes"
                    rotulo={(c) => c.apecli || c.nomcli}
                    detalhe={(c) => c.nomcli}
                    chave={(c) => c.codcli}
                    placeholder="Buscar cliente"
                    desabilitado={!!proposta}
                  />
                  {proposta && <p className="mt-1 text-[11.5px] text-muted">O cliente vem da proposta escolhida.</p>}
                </div>
              )}
              <div>
                <label className={classeRotulo}>Proposta{finalidade === "projeto" ? " *" : " (opcional)"}</label>
                <AutocompleteRemoto<PropostaOpcao>
                  valor={proposta}
                  onChange={setProposta}
                  url="/api/solicitacoes-viagem/apoio/propostas"
                  chaveLista="propostas"
                  params={{ codcli: cliente?.codcli }}
                  rotulo={(p) => `Proposta ${p.codpro}${p.despro ? ` · ${p.despro}` : ""}`}
                  detalhe={(p) => p.clienteNome}
                  chave={(p) => `${p.codemp}-${p.codpro}`}
                  placeholder="Buscar por número, descrição ou cliente"
                />
                {proposta && finalidade === "projeto" && <p className="mt-1 text-[11.5px] text-muted">Cliente: {proposta.clienteNome}</p>}
              </div>
            </div>

            <div>
              <label className={classeRotulo}>Motivo da viagem</label>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={1000} className={`${classeCampo} resize-none`} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={classeRotulo}>Início da viagem (chegada)</label>
                <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className={classeCampo} />
              </div>
              <div>
                <label className={classeRotulo}>Término da viagem (saída)</label>
                <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className={classeCampo} />
              </div>
            </div>

            <div>
              <label className={classeRotulo}>Observações gerais</label>
              <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className={`${classeCampo} resize-none`} />
            </div>
          </section>
        )}

        {/* ---------- 3. Viajantes ---------- */}
        {!modoAjuste && etapa === 2 && (
          <section className="space-y-3">
            <p className="text-sm text-muted">Quem vai viajar. Escolha alguém do CaxHub ou informe uma pessoa externa (convidado, cliente).</p>
            {viajantes.map((v, ix) => (
              <div key={ix} className="rounded-md border border-border bg-surface-2/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[12.5px] font-medium text-foreground">Viajante {ix + 1}</p>
                  {viajantes.length > 1 && (
                    <button type="button" onClick={() => removerViajante(ix)} className="text-[12px] text-destructive hover:underline">
                      Remover
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_11rem]">
                  <div>
                    <label className={classeRotulo}>Usuário do CaxHub (opcional)</label>
                    <AutocompleteRemoto<UsuarioOpcao>
                      valor={v.userId != null ? { id: v.userId, nome: v.nome } : null}
                      onChange={(u) => atualizarViajante(ix, u ? { userId: u.id, nome: u.nome } : { userId: null })}
                      url="/api/solicitacoes-viagem/apoio/usuarios"
                      chaveLista="usuarios"
                      rotulo={(u) => u.nome}
                      chave={(u) => u.id}
                      placeholder="Pessoa externa"
                    />
                  </div>
                  <div>
                    <label className={classeRotulo}>Nome completo</label>
                    <input value={v.nome} onChange={(e) => atualizarViajante(ix, { nome: e.target.value, userId: null })} maxLength={150} className={classeCampo} />
                  </div>
                  <div>
                    <label className={classeRotulo}>CPF (opcional)</label>
                    <input
                      value={v.cpf.includes("*") ? v.cpf : mascararCpfDigitado(v.cpf)}
                      onChange={(e) => atualizarViajante(ix, { cpf: mascararCpfDigitado(e.target.value) })}
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      className={`${classeCampo} font-mono ${v.cpf && !v.cpf.includes("*") && soDigitos(v.cpf).length === 11 && !cpfValido(v.cpf) ? "border-destructive" : ""}`}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={adicionarViajante} className={classeBotaoSecundario}>
              + Adicionar viajante
            </button>
          </section>
        )}

        {/* ---------- 4. Detalhes de cada serviço ---------- */}
        {(modoAjuste || etapa === 3) && (
          <section className="space-y-4">
            {itens.map((i, ix) => (
              <BlocoItem
                key={i.id ?? `novo-${ix}`}
                item={i}
                numero={itens.filter((x) => x.tipo === i.tipo).indexOf(i) + 1}
                viajantes={viajantes}
                somenteAjuste={modoAjuste}
                onChange={(p) => atualizarItem(ix, p)}
                onAlternarViajante={(vix) => alternarViajanteDoItem(ix, vix, i.tipo === "carro")}
                onRemover={itens.filter((x) => x.tipo === i.tipo).length > 1 ? () => setItens((a) => a.filter((_, k) => k !== ix)) : undefined}
              />
            ))}
            {!modoAjuste && (
              <div className="flex flex-wrap gap-2">
                {TIPOS.filter((t) => servicos[t]).map((t) => (
                  <button key={t} type="button" onClick={() => setItens((a) => [...a, novoItem(t)])} className={classeBotaoSecundario}>
                    + Outra {t === "aereo" ? "passagem" : t === "carro" ? "locação de carro" : "hospedagem"}
                  </button>
                ))}
              </div>
            )}
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">Roteiro por viajante</p>
              <RoteiroViagem viajantes={roteiroViajantes} itens={itens} />
            </div>
            {!modoAjuste && (
              <div>
                <label className={classeRotulo}>Observações sobre o roteiro (opcional)</label>
                <textarea value={roteiroObservacao} onChange={(e) => setRoteiroObservacao(e.target.value)} rows={3} className={`${classeCampo} resize-none`} placeholder="Ex.: João volta de Curitiba de carro; Maria segue para Florianópolis." />
              </div>
            )}
          </section>
        )}

        {/* ---------- 5. Revisão ---------- */}
        {!modoAjuste && etapa === 4 && (
          <section className="space-y-3 text-sm">
            <Linha rotulo="Finalidade" valor={FINALIDADE_ROTULO[finalidade]} />
            <Linha rotulo="Cliente" valor={proposta ? proposta.clienteNome : cliente ? cliente.apecli || cliente.nomcli : "—"} />
            <Linha rotulo="Proposta" valor={proposta ? `Proposta ${proposta.codpro}` : "—"} />
            <Linha rotulo="Motivo" valor={motivo} />
            <Linha rotulo="Período" valor={`${dataInicio.split("-").reverse().join("/")} a ${dataFim.split("-").reverse().join("/")}`} />
            <Linha rotulo="Destino(s)" valor={cidadesDestino} />
            <Linha rotulo="Viajantes" valor={viajantes.map((v) => v.nome).join(", ")} />
            <Linha rotulo="Serviços" valor={TIPOS.filter((t) => servicos[t]).map((t) => `${TIPO_ROTULO[t]} (${itens.filter((i) => i.tipo === t).length})`).join(" · ")} />
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">Roteiro</p>
              <RoteiroViagem viajantes={roteiroViajantes} itens={itens} />
            </div>
          </section>
        )}
      </div>

      {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link to={editando ? `/solicitacoes/${id}` : "/solicitacoes/minhas"} className={classeBotaoSecundario}>
          Cancelar
        </Link>
        {!modoAjuste && etapa > 0 && (
          <button type="button" onClick={() => setEtapa((e) => e - 1)} className={classeBotaoSecundario}>
            Voltar
          </button>
        )}
        {!modoAjuste && !ultima && (
          <button type="button" onClick={avancar} className={classeBotaoPrimario}>
            Continuar
          </button>
        )}
        {(modoAjuste || ultima) && (
          <button type="button" onClick={salvar} disabled={salvando} className={classeBotaoPrimario}>
            {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Enviar solicitação"}
          </button>
        )}
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="flex gap-3">
      <span className="w-24 flex-none text-muted">{rotulo}</span>
      <span className="text-foreground">{valor || "—"}</span>
    </p>
  );
}

interface BlocoItemProps {
  item: ItemViagem;
  numero: number;
  viajantes: Viajante[];
  somenteAjuste: boolean;
  onChange: (parcial: Partial<ItemViagem>) => void;
  onAlternarViajante: (viajanteIx: number) => void;
  onRemover?: () => void;
}

function BlocoItem({ item, numero, viajantes, somenteAjuste, onChange, onAlternarViajante, onRemover }: BlocoItemProps) {
  const dis = somenteAjuste; // campos fora de data/hora/observação ficam travados no ajuste
  const campo = (rotulo: string, chave: keyof ItemViagem, opts: { type?: string; placeholder?: string; travar?: boolean } = {}) => (
    <div>
      <label className={classeRotulo}>{rotulo}</label>
      <input
        type={opts.type ?? "text"}
        value={(item[chave] as string) ?? ""}
        onChange={(e) => onChange({ [chave]: e.target.value } as Partial<ItemViagem>)}
        placeholder={opts.placeholder}
        disabled={opts.travar ?? dis}
        className={classeCampo}
      />
    </div>
  );
  const unico = item.tipo === "carro";

  return (
    <div className="rounded-md border border-border bg-surface-2/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">
          {TIPO_ROTULO[item.tipo]} {numero}
        </p>
        {onRemover && !somenteAjuste && (
          <button type="button" onClick={onRemover} className="text-[12px] text-destructive hover:underline">
            Remover
          </button>
        )}
      </div>

      <div className="mb-3">
        <p className={classeRotulo}>{unico ? "Responsável pela reserva" : item.tipo === "aereo" ? "Passageiros" : "Hóspedes"}</p>
        <div className="flex flex-wrap gap-2">
          {viajantes.map((v, vix) => (
            <label key={vix} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px] ${dis ? "opacity-60" : "cursor-pointer"} ${item.viajantes.includes(vix) ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted"}`}>
              <input type={unico ? "radio" : "checkbox"} checked={item.viajantes.includes(vix)} disabled={dis} onChange={() => onAlternarViajante(vix)} />
              {v.nome || `Viajante ${vix + 1}`}
            </label>
          ))}
        </div>
      </div>

      {item.tipo === "hospedagem" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {campo("Cidade da hospedagem", "cidade")}
          {campo("Check-in", "dataInicio", { type: "date", travar: false })}
          {campo("Check-out", "dataFim", { type: "date", travar: false })}
          {campo("Horário previsto de chegada", "horaInicio", { type: "time", travar: false })}
          <div>
            <label className={classeRotulo}>Tipo de acomodação</label>
            <select value={item.tipoAcomodacao} onChange={(e) => onChange({ tipoAcomodacao: e.target.value })} disabled={dis} className={classeCampo}>
              <option value="individual">Quarto individual</option>
              <option value="compartilhado">Quarto compartilhado / grupo</option>
            </select>
          </div>
          {campo("Hotel de preferência / sugestão", "hotelPreferencia")}
          <div className="sm:col-span-3">{campo("Necessidades ou preferências específicas", "necessidades")}</div>
        </div>
      )}

      {item.tipo === "aereo" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {campo("Origem (cidade/aeroporto)", "origem")}
          {campo("Destino (cidade/aeroporto)", "destino")}
          {campo("Horário preferencial", "horaInicio", { type: "time", travar: false })}
          {campo("Data de ida", "dataInicio", { type: "date", travar: false })}
          {campo("Data de retorno (se houver)", "dataFim", { type: "date", travar: false })}
          {campo("Preferência de companhia", "companhiaPreferencia")}
          {campo("Flexibilidade de horário", "flexibilidadeHorario", { placeholder: "Ex.: ±2h" })}
          {campo("Bagagem necessária", "bagagem", { placeholder: "Ex.: 1 despachada de 23kg" })}
        </div>
      )}

      {item.tipo === "carro" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {campo("Local de retirada", "localRetirada")}
          {campo("Data de retirada", "dataInicio", { type: "date", travar: false })}
          {campo("Horário de retirada", "horaInicio", { type: "time", travar: false })}
          {campo("Local de devolução", "localDevolucao")}
          {campo("Data de devolução", "dataFim", { type: "date", travar: false })}
          {campo("Horário de devolução", "horaFim", { type: "time", travar: false })}
          <div className="sm:col-span-3">{campo("Categoria / tipo de veículo", "categoriaVeiculo", { placeholder: "Ex.: econômico, SUV" })}</div>
        </div>
      )}

      <div className="mt-3">{campo("Observações", "observacoes", { travar: false })}</div>
    </div>
  );
}
