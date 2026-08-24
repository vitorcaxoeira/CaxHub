import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../components/ui/Toast";
import { toneBadge } from "../../components/ui/badges";
import {
  AtividadeDetalhe,
  SolicitacaoApontamento,
  SolicitacaoExcedente,
} from "../../components/projetos/AtividadeDetalhe";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { formatHoras, horasParaMinutos, minutosParaInputHoras } from "../../utils/horas";
import { paraInputData, paraInputHora } from "../../utils/inputsDataHora";

// Cabeçalho da atividade devolvido por GET /atividades/:id/detalhe — os mesmos campos que
// o painel consome, igual ao que Meus Apontamentos já faz pra abrir o drawer sem ter o
// card à mão.
interface AtividadeDetalheDados {
  id: number;
  codemp: number;
  codpro: number;
  numprj: number | null;
  dataPrevistaInicio: string | null;
  dataPrevistaFim: string | null;
  itemDescricao: string | null;
  itemQtdhor: number | null;
  itemAlocado: number;
  itemRealizado: number;
  estruturaNome: string | null;
  estruturaPercentual: number | null;
  podeVerCronograma: boolean;
  qtdhorPrevisto: number | null;
  horasExcedentes: number;
  horasRealizadas: number;
  podeAutorizarExcedente: boolean;
  souOExecutor: boolean;
}

type Aba = "excedentes" | "apontamentos" | "ajustes";

// Correção de horário de um apontamento já confirmado. Enquanto o pedido está pendente, o
// envio ao Senior fica retido (ver RetidoPorAjusteError no backend) — é o que permite
// corrigir sem nunca alterar nada do lado do ERP.
export interface SolicitacaoAjuste {
  id: number;
  sessaoId: number;
  atividadeId: number;
  status: "pendente" | "aprovada" | "reprovada";
  inicioAtual: string;
  fimAtual: string | null;
  inicioSolicitado: string;
  fimSolicitado: string;
  motivo: string;
  inicioAprovado: string | null;
  fimAprovado: string | null;
  inicioAnterior: string | null;
  fimAnterior: string | null;
  observacaoDecisao: string | null;
  criadoEm: string;
  decididoEm: string | null;
  solicitanteNome: string;
  decisorNome: string | null;
  codemp: number;
  codpro: number;
  seqite: number;
  depexe: number | null;
  depexeLabel: string;
  gestorNome: string | null;
  modproLabel: string;
  clienteNome: string | null;
  despro: string | null;
  podeDecidir: boolean;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const FILTROS: { valor: string; rotulo: string }[] = [
  { valor: "pendente", rotulo: "Pendentes" },
  { valor: "aprovada", rotulo: "Aprovadas" },
  { valor: "reprovada", rotulo: "Reprovadas" },
  { valor: "", rotulo: "Todas" },
];

const TOM_STATUS: Record<string, string> = {
  pendente: "bg-warning/15 text-warning",
  aprovada: "bg-success/15 text-success",
  reprovada: "bg-destructive/15 text-destructive",
};

// "03/08 09:00 – 10:30" a partir de dois ISO.
function intervalo(inicio: string, fim: string): string {
  return `${dateTimeFormatter.format(new Date(inicio))} – ${dateTimeFormatter.format(new Date(fim))}`;
}

const classeBotao = {
  neutro: "rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50",
  primario: "rounded-md bg-primary px-3 py-1 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50",
  destrutivo:
    "rounded-md border border-destructive/40 px-2.5 py-1 text-[12.5px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50",
};

const classeCampo =
  "rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Cabeçalho comum às três listas: id, status, quem pediu, onde, o link pra atividade e a
// data. `clienteNome`/`despro` são opcionais e só quem chama passando os dois (hoje só
// ListaApontamentos) ganha o cabeçalho estendido — Excedentes/Ajustes continuam no formato
// de 1 linha de sempre.
function CabecalhoLinha({
  id,
  status,
  solicitanteNome,
  codemp,
  codpro,
  seqite,
  depexeLabel,
  gestorNome,
  modproLabel,
  atividadeId,
  criadoEm,
  onVerAtividade,
  clienteNome,
  despro,
}: {
  id: number;
  status: string;
  solicitanteNome: string;
  codemp: number;
  codpro: number;
  seqite: number;
  depexeLabel: string;
  gestorNome: string | null;
  modproLabel: string;
  atividadeId: number;
  criadoEm: string;
  onVerAtividade: (id: number) => void;
  clienteNome?: string | null;
  despro?: string | null;
}) {
  const navigate = useNavigate();
  const cabecalhoEstendido = clienteNome !== undefined || despro !== undefined;

  const linhaId = (
    <>
      {/* Id da SOLICITAÇÃO, não da atividade — é por ele que se conversa sobre um pedido
          específico. Cada aba tem a numeração da sua própria tabela, então #4 em Horas
          Excedentes e #4 em Apontamentos são registros diferentes. */}
      <span className="font-mono text-[11.5px] text-muted">#{id}</span>
      <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] uppercase ${TOM_STATUS[status] ?? ""}`}>{status}</span>
      <span className="text-sm font-medium text-foreground">{solicitanteNome}</span>
    </>
  );

  // Abre a proposta numa aba/rota própria — diferente de "Ver atividade", que abre o painel
  // aqui mesmo sem navegar.
  const linkProposta = (
    <button
      onClick={() => navigate(`/projetos/proposta/${codemp}/${codpro}`)}
      className="font-mono text-[12.5px] font-medium text-primary hover:underline"
    >
      {codpro}
    </button>
  );

  // Badge de modalidade da proposta — mesmo componente (mesmo estilo pill, toneBadge.neutral)
  // da coluna Modalidade em Alocacao.tsx, reaproveitado igual ao badge de departamento abaixo.
  const badgeModalidade = (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>
      {modproLabel}
    </span>
  );

  // Badge de departamento — mesmo estilo da coluna Departamento em Alocacao.tsx
  // (toneBadge.neutral), com mais destaque que o texto corrido ao redor: é o dado que
  // decide QUEM (qual gestor) deveria estar olhando esta solicitação.
  const badgeDepartamento = (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>
      {depexeLabel}
    </span>
  );

  // Badge do gestor do departamento — mesma lógica de apresentação do badge de
  // departamento acima (mesmo pill, mesmo tom), badge PRÓPRIO (elemento separado) porque são
  // duas informações distintas. Prefixo "Gestor:" pra não ficar ambíguo com dois pills cinza
  // iguais lado a lado (mesma convenção "Label: valor" usada logo abaixo em "Cliente: ...").
  // Sem gestor cadastrado pro departamento = sem badge, em vez de um pill vazio.
  const badgeGestor = gestorNome ? (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge.neutral}`}>
      Gestor: {gestorNome}
    </span>
  ) : null;

  if (!cabecalhoEstendido) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {linhaId}
        <span className="text-[12.5px] text-muted">
          Proposta {linkProposta} · Item {String(seqite).padStart(2, "0")}
        </span>
        {badgeDepartamento}
        {badgeGestor}
        <button onClick={() => onVerAtividade(atividadeId)} className="text-[12.5px] font-medium text-primary hover:underline">
          Ver atividade
        </button>
        <span className="ml-auto font-mono text-[12.5px] text-muted">{dateTimeFormatter.format(new Date(criadoEm))}</span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {linhaId}
        <span className="ml-auto font-mono text-[12.5px] text-muted">{dateTimeFormatter.format(new Date(criadoEm))}</span>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
        <span>Proposta {linkProposta}</span>
        {badgeModalidade}
        {clienteNome && (
          <span>
            Cliente: <span className="text-foreground">{clienteNome}</span>
          </span>
        )}
      </p>
      {despro && <p className="text-[12.5px] text-muted">Descrição da Proposta: {despro}</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[12.5px] text-muted">Item {String(seqite).padStart(2, "0")}</span>
        {badgeDepartamento}
        {badgeGestor}
        {/* Abre o painel AQUI, sem navegar: quem decide está no meio de uma fila de pedidos,
            e ir pra tela de Atividades carregaria quadro, KPIs e filtros inteiros só pra
            mostrar um painel lateral — e na volta o filtro e a rolagem já se perderam. */}
        <button onClick={() => onVerAtividade(atividadeId)} className="text-[12.5px] font-medium text-primary hover:underline">
          Ver atividade
        </button>
      </div>
    </div>
  );
}

function ListaExcedentes({
  status,
  onVerAtividade,
  onMudou,
}: {
  status: string;
  onVerAtividade: (id: number) => void;
  onMudou: () => void;
}) {
  const toast = useToast();
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoExcedente[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [decidindoId, setDecidindoId] = useState<number | null>(null);
  const [horasInput, setHorasInput] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Filtro de consultor: valores são os nomes que já aparecem nos pedidos carregados, não uma
  // lista de todos os consultores do sistema — é só pra recortar o que já está na tela.
  const [consultorFiltro, setConsultorFiltro] = useState<string[]>([]);
  const [processandoLote, setProcessandoLote] = useState(false);

  const carregar = useCallback(() => {
    setLoading(true);
    axios
      .get("/api/solicitacoes-excedente", { params: status ? { status } : {} })
      .then(({ data }) => {
        setSolicitacoes(data.solicitacoes);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar as solicitações"))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(carregar, [carregar]);

  const consultoresDisponiveis = useMemo<MultiSelectOption<string>[]>(
    () =>
      [...new Set(solicitacoes.map((s) => s.solicitanteNome))]
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map((nome) => ({ value: nome, label: nome })),
    [solicitacoes]
  );

  const solicitacoesFiltradas = useMemo(
    () => (consultorFiltro.length === 0 ? solicitacoes : solicitacoes.filter((s) => consultorFiltro.includes(s.solicitanteNome))),
    [solicitacoes, consultorFiltro]
  );

  // Só os pendentes que ESTE gestor pode decidir, dentro do filtro atual — é exatamente o
  // conjunto que "Aprovar todos"/"Reprovar todos" atinge.
  const pendentesDecidiveis = useMemo(
    () => solicitacoesFiltradas.filter((s) => s.status === "pendente" && s.podeDecidir),
    [solicitacoesFiltradas]
  );

  async function decidirEmLote(aprovar: boolean) {
    const confirmado = window.confirm(
      aprovar
        ? `Aprovar ${pendentesDecidiveis.length} pedido(s) de horas excedentes, liberando exatamente o que foi solicitado? Essa ação não pode ser desfeita.`
        : `Reprovar ${pendentesDecidiveis.length} pedido(s) de horas excedentes? Essa ação não pode ser desfeita.`
    );
    if (!confirmado) return;

    setProcessandoLote(true);
    try {
      const { data } = await axios.post("/api/solicitacoes-excedente/decidir-lote", {
        ids: pendentesDecidiveis.map((s) => s.id),
        aprovar,
      });
      const totalSucesso = data.sucesso.length as number;
      const falhas = data.falhas as { id: number; erro: string }[];
      toast.mostrar(
        falhas.length === 0
          ? `${totalSucesso} pedido(s) ${aprovar ? "aprovado(s)" : "reprovado(s)"}.`
          : `${totalSucesso} pedido(s) ${aprovar ? "aprovado(s)" : "reprovado(s)"}, ${falhas.length} falha(s): ${falhas
              .map((f) => `#${f.id} — ${f.erro}`)
              .join("; ")}`,
        falhas.length === 0 ? (aprovar ? "success" : "neutral") : "destructive"
      );
      carregar();
      onMudou();
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? `Falha ao ${aprovar ? "aprovar" : "reprovar"} em lote`, "destructive");
    } finally {
      setProcessandoLote(false);
    }
  }

  async function decidir(s: SolicitacaoExcedente, aprovar: boolean) {
    const minutos = aprovar ? horasParaMinutos(horasInput) : null;
    if (aprovar && minutos == null) {
      toast.mostrar("Informe as horas aprovadas no formato H:MM (ex.: 4:00).", "destructive");
      return;
    }
    setEnviando(true);
    try {
      const { data } = await axios.post(`/api/solicitacoes-excedente/${s.id}/decidir`, {
        aprovar,
        ...(aprovar ? { horasAprovadas: minutos } : {}),
        observacao,
      });
      toast.mostrar(
        aprovar
          ? `Aprovado. O teto da atividade agora tem ${formatHoras(data.horasExcedentes / 60)} de excedente.`
          : "Solicitação reprovada.",
        aprovar ? "success" : "neutral"
      );
      setDecidindoId(null);
      carregar();
      onMudou();
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? "Falha ao registrar a decisão", "destructive");
      // Recarrega mesmo no erro: um 409 quer dizer que outra pessoa já decidiu, e a tela
      // precisa parar de oferecer os botões.
      carregar();
    } finally {
      setEnviando(false);
    }
  }

  if (loading) return <p className="mt-6 text-sm text-muted">Carregando...</p>;
  if (erro)
    return <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>;

  return (
    <div className="mt-4">
      {solicitacoes.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <MultiSelectDropdown
            opcoes={consultoresDisponiveis}
            selecionados={consultorFiltro}
            onChange={setConsultorFiltro}
            labelTodos="Todos os consultores"
            labelSufixo="consultores"
          />
          {status === "pendente" && pendentesDecidiveis.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => decidirEmLote(false)} disabled={processandoLote} className={classeBotao.destrutivo}>
                Reprovar todos ({pendentesDecidiveis.length})
              </button>
              <button onClick={() => decidirEmLote(true)} disabled={processandoLote} className={classeBotao.primario}>
                {processandoLote ? "Processando..." : `Aprovar todos (${pendentesDecidiveis.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {solicitacoesFiltradas.length === 0 ? (
        <p className="mt-2 rounded-md border border-border bg-surface-2/40 px-4 py-3 text-sm text-muted">
          {solicitacoes.length === 0
            ? "Nenhuma solicitação de horas excedentes por aqui."
            : "Nenhuma solicitação com esse filtro de consultor."}
        </p>
      ) : (
        <div className="space-y-2">
          {solicitacoesFiltradas.map((s) => (
            <div key={s.id} className="rounded-md border border-border bg-surface px-3.5 py-3">
              <CabecalhoLinha {...s} onVerAtividade={onVerAtividade} criadoEm={s.criadoEm} />

              <p className="mt-1.5 font-mono text-[12px] text-muted">
                Pediu <span className="text-warning">{formatHoras(s.horasSolicitadas / 60)}</span>
                {s.horasAprovadas != null && (
                  <>
                    {" · Aprovado "}
                    <span className="text-success">{formatHoras(s.horasAprovadas / 60)}</span>
                  </>
                )}
                {" · Alocado "}
                {formatHoras((s.qtdhor ?? 0) / 60)}
                {" · Excedente atual "}
                {formatHoras(s.horasExcedentesAtuais / 60)}
              </p>

              <p className="mt-1.5 text-[13px] text-foreground">
                <span className="text-muted">Motivo: </span>
                {s.motivo}
              </p>

              {s.status !== "pendente" && (
            <p className="mt-1 text-[12px] text-muted">
              {s.decisorNome} decidiu em {s.decididoEm ? dateTimeFormatter.format(new Date(s.decididoEm)) : "—"}
              {s.observacaoDecisao && ` — "${s.observacaoDecisao}"`}
            </p>
          )}

          {s.status === "pendente" &&
            s.podeDecidir &&
            (decidindoId === s.id ? (
              <div className="mt-2 space-y-2 rounded-md border border-border bg-surface-2/40 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`aprovadas-${s.id}`} className="text-[12px] text-muted">
                    Horas a liberar
                  </label>
                  <input
                    id={`aprovadas-${s.id}`}
                    autoFocus
                    value={horasInput}
                    onChange={(e) => setHorasInput(e.target.value)}
                    placeholder="4:00"
                    className={`w-24 ${classeCampo}`}
                  />
                  <span className="text-[11.5px] text-muted">soma ao excedente que a atividade já tem</span>
                </div>
                <input
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Observação (opcional) — vai junto no aviso ao consultor"
                  className={`w-full ${classeCampo}`}
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button onClick={() => setDecidindoId(null)} disabled={enviando} className={classeBotao.neutro}>
                    Cancelar
                  </button>
                  <button onClick={() => decidir(s, false)} disabled={enviando} className={classeBotao.destrutivo}>
                    Reprovar
                  </button>
                  <button onClick={() => decidir(s, true)} disabled={enviando} className={classeBotao.primario}>
                    {enviando ? "Salvando..." : "Aprovar"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setDecidindoId(s.id);
                  // Já nasce com o que foi pedido: aprovar integral é o caminho comum.
                  setHorasInput(minutosParaInputHoras(s.horasSolicitadas));
                  setObservacao("");
                }}
                className={`mt-2 ${classeBotao.neutro}`}
              >
                Decidir
              </button>
            ))}
        </div>
      ))}
        </div>
      )}
    </div>
  );
}

function ListaApontamentos({
  status,
  onVerAtividade,
  onMudou,
}: {
  status: string;
  onVerAtividade: (id: number) => void;
  onMudou: () => void;
}) {
  const toast = useToast();
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoApontamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [decidindoId, setDecidindoId] = useState<number | null>(null);
  // O gestor pode corrigir antes de aprovar; nascem com o que foi pedido. Uma data só,
  // como no formulário do consultor — o fim assume o dia do início.
  const [data, setData] = useState("");
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFim, setHoraFim] = useState("");
  const [descricao, setDescricao] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Filtro de consultor: valores são os nomes que já aparecem nos pedidos carregados, não uma
  // lista de todos os consultores do sistema — é só pra recortar o que já está na tela.
  const [consultorFiltro, setConsultorFiltro] = useState<string[]>([]);
  const [processandoLote, setProcessandoLote] = useState(false);

  const carregar = useCallback(() => {
    setLoading(true);
    axios
      .get("/api/solicitacoes-apontamento", { params: status ? { status } : {} })
      .then(({ data }) => {
        setSolicitacoes(data.solicitacoes);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar as solicitações"))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(carregar, [carregar]);

  const consultoresDisponiveis = useMemo<MultiSelectOption<string>[]>(
    () =>
      [...new Set(solicitacoes.map((s) => s.solicitanteNome))]
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map((nome) => ({ value: nome, label: nome })),
    [solicitacoes]
  );

  const solicitacoesFiltradas = useMemo(
    () => (consultorFiltro.length === 0 ? solicitacoes : solicitacoes.filter((s) => consultorFiltro.includes(s.solicitanteNome))),
    [solicitacoes, consultorFiltro]
  );

  // Só os pendentes que ESTE gestor pode decidir, dentro do filtro atual — é exatamente o
  // conjunto que "Aprovar todos"/"Reprovar todos" atinge.
  const pendentesDecidiveis = useMemo(
    () => solicitacoesFiltradas.filter((s) => s.status === "pendente" && s.podeDecidir),
    [solicitacoesFiltradas]
  );

  async function decidirEmLote(aprovar: boolean) {
    const acao = aprovar ? "aprovar" : "reprovar";
    const confirmado = window.confirm(
      aprovar
        ? `Aprovar ${pendentesDecidiveis.length} pedido(s) de apontamento, exatamente como solicitados? Essa ação não pode ser desfeita.`
        : `Reprovar ${pendentesDecidiveis.length} pedido(s) de apontamento? Essa ação não pode ser desfeita.`
    );
    if (!confirmado) return;

    setProcessandoLote(true);
    try {
      const { data } = await axios.post("/api/solicitacoes-apontamento/decidir-lote", {
        ids: pendentesDecidiveis.map((s) => s.id),
        aprovar,
      });
      const totalSucesso = data.sucesso.length as number;
      const falhas = data.falhas as { id: number; erro: string }[];
      toast.mostrar(
        falhas.length === 0
          ? `${totalSucesso} pedido(s) ${aprovar ? "aprovado(s)" : "reprovado(s)"}.`
          : `${totalSucesso} pedido(s) ${aprovar ? "aprovado(s)" : "reprovado(s)"}, ${falhas.length} falha(s): ${falhas
              .map((f) => `#${f.id} — ${f.erro}`)
              .join("; ")}`,
        falhas.length === 0 ? (aprovar ? "success" : "neutral") : "destructive"
      );
      carregar();
      onMudou();
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? `Falha ao ${acao} em lote`, "destructive");
    } finally {
      setProcessandoLote(false);
    }
  }

  async function decidir(s: SolicitacaoApontamento, aprovar: boolean) {
    if (aprovar && (!data || !horaInicio || !horaFim)) {
      toast.mostrar("Informe a data, a hora inicial e a hora final.", "destructive");
      return;
    }
    if (aprovar && horaFim <= horaInicio) {
      toast.mostrar("A hora final precisa ser depois da inicial.", "destructive");
      return;
    }
    setEnviando(true);
    try {
      await axios.post(`/api/solicitacoes-apontamento/${s.id}/decidir`, {
        aprovar,
        ...(aprovar
          ? {
              inicio: new Date(`${data}T${horaInicio}`).toISOString(),
              fim: new Date(`${data}T${horaFim}`).toISOString(),
              descricao,
            }
          : {}),
        observacao,
      });
      toast.mostrar(
        aprovar
          ? "Aprovado. O apontamento foi para o consultor confirmar em Meus Apontamentos."
          : "Solicitação reprovada.",
        aprovar ? "success" : "neutral"
      );
      setDecidindoId(null);
      carregar();
      onMudou();
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      // Conflito de horário e estouro de teto chegam aqui: são recusas com explicação, e a
      // solicitação continua pendente pro gestor resolver antes de tentar de novo.
      toast.mostrar(mensagem ?? "Falha ao registrar a decisão", "destructive");
      carregar();
    } finally {
      setEnviando(false);
    }
  }

  if (loading) return <p className="mt-6 text-sm text-muted">Carregando...</p>;
  if (erro)
    return <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>;

  return (
    <div className="mt-4">
      {solicitacoes.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <MultiSelectDropdown
            opcoes={consultoresDisponiveis}
            selecionados={consultorFiltro}
            onChange={setConsultorFiltro}
            labelTodos="Todos os consultores"
            labelSufixo="consultores"
          />
          {/* Só faz sentido decidir em lote na aba Pendentes — nas outras os pedidos já
              foram decididos ou misturam situações diferentes. */}
          {status === "pendente" && pendentesDecidiveis.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => decidirEmLote(false)} disabled={processandoLote} className={classeBotao.destrutivo}>
                Reprovar todos ({pendentesDecidiveis.length})
              </button>
              <button onClick={() => decidirEmLote(true)} disabled={processandoLote} className={classeBotao.primario}>
                {processandoLote ? "Processando..." : `Aprovar todos (${pendentesDecidiveis.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {solicitacoesFiltradas.length === 0 ? (
        <p className="mt-2 rounded-md border border-border bg-surface-2/40 px-4 py-3 text-sm text-muted">
          {solicitacoes.length === 0 ? "Nenhuma solicitação de apontamento por aqui." : "Nenhuma solicitação com esse filtro de consultor."}
        </p>
      ) : (
        <div className="space-y-2">
          {solicitacoesFiltradas.map((s) => (
            <div key={s.id} className="rounded-md border border-border bg-surface px-3.5 py-3">
              <CabecalhoLinha {...s} onVerAtividade={onVerAtividade} criadoEm={s.criadoEm} />

              <p className="mt-1.5 font-mono text-[12px] text-muted">
                Pediu <span className="text-warning">{intervalo(s.inicioSolicitado, s.fimSolicitado)}</span>
            {s.inicioAprovado && s.fimAprovado && (
              <>
                {" · Aprovado "}
                <span className="text-success">{intervalo(s.inicioAprovado, s.fimAprovado)}</span>
              </>
            )}
          </p>

          <p className="mt-1.5 text-[13px] text-foreground">
            <span className="text-muted">Descrição do trabalho: </span>
            {s.descricao}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">Motivo: {s.motivo}</p>

          {s.status !== "pendente" && (
            <p className="mt-1 text-[12px] text-muted">
              {s.decisorNome} decidiu em {s.decididoEm ? dateTimeFormatter.format(new Date(s.decididoEm)) : "—"}
              {s.observacaoDecisao && ` — "${s.observacaoDecisao}"`}
            </p>
          )}

          {s.status === "pendente" &&
            s.podeDecidir &&
            (decidindoId === s.id ? (
              <div className="mt-2 space-y-2 rounded-md border border-border bg-surface-2/40 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`data-${s.id}`} className="text-[12px] text-muted">
                    Data
                  </label>
                  <input
                    id={`data-${s.id}`}
                    type="date"
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                    className={classeCampo}
                  />
                  <label htmlFor={`hini-${s.id}`} className="text-[12px] text-muted">
                    das
                  </label>
                  <input
                    id={`hini-${s.id}`}
                    type="time"
                    value={horaInicio}
                    onChange={(e) => setHoraInicio(e.target.value)}
                    className={classeCampo}
                  />
                  <label htmlFor={`hfim-${s.id}`} className="text-[12px] text-muted">
                    às
                  </label>
                  <input
                    id={`hfim-${s.id}`}
                    type="time"
                    value={horaFim}
                    onChange={(e) => setHoraFim(e.target.value)}
                    className={classeCampo}
                  />
                </div>
                <textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  rows={2}
                  placeholder="Descrição do trabalho — vai pro apontamento e pro Senior"
                  className={`w-full resize-none ${classeCampo}`}
                />
                <input
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Observação (opcional) — vai junto no aviso ao consultor"
                  className={`w-full ${classeCampo}`}
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button onClick={() => setDecidindoId(null)} disabled={enviando} className={classeBotao.neutro}>
                    Cancelar
                  </button>
                  <button onClick={() => decidir(s, false)} disabled={enviando} className={classeBotao.destrutivo}>
                    Reprovar
                  </button>
                  <button onClick={() => decidir(s, true)} disabled={enviando} className={classeBotao.primario}>
                    {enviando ? "Salvando..." : "Aprovar"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setDecidindoId(s.id);
                  setData(paraInputData(s.inicioSolicitado));
                  setHoraInicio(paraInputHora(s.inicioSolicitado));
                  setHoraFim(paraInputHora(s.fimSolicitado));
                  setDescricao(s.descricao);
                  setObservacao("");
                }}
                className={`mt-2 ${classeBotao.neutro}`}
              >
                Decidir
              </button>
            ))}
        </div>
      ))}
        </div>
      )}
    </div>
  );
}

function ListaAjustes({
  status,
  onVerAtividade,
  onMudou,
}: {
  status: string;
  onVerAtividade: (id: number) => void;
  onMudou: () => void;
}) {
  const toast = useToast();
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoAjuste[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [decidindoId, setDecidindoId] = useState<number | null>(null);
  const [data, setData] = useState("");
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFim, setHoraFim] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Filtro de consultor: valores são os nomes que já aparecem nos pedidos carregados, não uma
  // lista de todos os consultores do sistema — é só pra recortar o que já está na tela.
  const [consultorFiltro, setConsultorFiltro] = useState<string[]>([]);
  const [processandoLote, setProcessandoLote] = useState(false);

  const carregar = useCallback(() => {
    setLoading(true);
    axios
      .get("/api/solicitacoes-ajuste", { params: status ? { status } : {} })
      .then(({ data }) => {
        setSolicitacoes(data.solicitacoes);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar as solicitações"))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(carregar, [carregar]);

  const consultoresDisponiveis = useMemo<MultiSelectOption<string>[]>(
    () =>
      [...new Set(solicitacoes.map((s) => s.solicitanteNome))]
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map((nome) => ({ value: nome, label: nome })),
    [solicitacoes]
  );

  const solicitacoesFiltradas = useMemo(
    () => (consultorFiltro.length === 0 ? solicitacoes : solicitacoes.filter((s) => consultorFiltro.includes(s.solicitanteNome))),
    [solicitacoes, consultorFiltro]
  );

  // Só os pendentes que ESTE gestor pode decidir, dentro do filtro atual — é exatamente o
  // conjunto que "Aprovar todos"/"Reprovar todos" atinge.
  const pendentesDecidiveis = useMemo(
    () => solicitacoesFiltradas.filter((s) => s.status === "pendente" && s.podeDecidir),
    [solicitacoesFiltradas]
  );

  async function decidirEmLote(aprovar: boolean) {
    const confirmado = window.confirm(
      aprovar
        ? `Aprovar ${pendentesDecidiveis.length} pedido(s) de ajuste de horário, exatamente como solicitados? Essa ação não pode ser desfeita.`
        : `Reprovar ${pendentesDecidiveis.length} pedido(s) de ajuste de horário? Essa ação não pode ser desfeita.`
    );
    if (!confirmado) return;

    setProcessandoLote(true);
    try {
      const { data } = await axios.post("/api/solicitacoes-ajuste/decidir-lote", {
        ids: pendentesDecidiveis.map((s) => s.id),
        aprovar,
      });
      const totalSucesso = data.sucesso.length as number;
      const falhas = data.falhas as { id: number; erro: string }[];
      toast.mostrar(
        falhas.length === 0
          ? `${totalSucesso} pedido(s) ${aprovar ? "aprovado(s)" : "reprovado(s)"}.`
          : `${totalSucesso} pedido(s) ${aprovar ? "aprovado(s)" : "reprovado(s)"}, ${falhas.length} falha(s): ${falhas
              .map((f) => `#${f.id} — ${f.erro}`)
              .join("; ")}`,
        falhas.length === 0 ? (aprovar ? "success" : "neutral") : "destructive"
      );
      carregar();
      onMudou();
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? `Falha ao ${aprovar ? "aprovar" : "reprovar"} em lote`, "destructive");
    } finally {
      setProcessandoLote(false);
    }
  }

  async function decidir(s: SolicitacaoAjuste, aprovar: boolean) {
    if (aprovar && (!data || !horaInicio || !horaFim)) {
      toast.mostrar("Informe a data, a hora inicial e a hora final.", "destructive");
      return;
    }
    if (aprovar && horaFim <= horaInicio) {
      toast.mostrar("A hora final precisa ser depois da inicial.", "destructive");
      return;
    }
    setEnviando(true);
    try {
      await axios.post(`/api/solicitacoes-ajuste/${s.id}/decidir`, {
        aprovar,
        ...(aprovar
          ? { inicio: new Date(`${data}T${horaInicio}`).toISOString(), fim: new Date(`${data}T${horaFim}`).toISOString() }
          : {}),
        observacao,
      });
      toast.mostrar(
        aprovar ? "Ajuste aprovado. O apontamento foi liberado para envio ao Senior." : "Ajuste reprovado.",
        aprovar ? "success" : "neutral"
      );
      setDecidindoId(null);
      carregar();
      onMudou();
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      // Conflito de horário e estouro de teto chegam aqui: são recusas com explicação, e a
      // solicitação continua pendente pro gestor resolver antes de tentar de novo.
      toast.mostrar(mensagem ?? "Falha ao registrar a decisão", "destructive");
      carregar();
    } finally {
      setEnviando(false);
    }
  }

  if (loading) return <p className="mt-6 text-sm text-muted">Carregando...</p>;
  if (erro)
    return <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>;

  return (
    <div className="mt-4">
      {solicitacoes.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <MultiSelectDropdown
            opcoes={consultoresDisponiveis}
            selecionados={consultorFiltro}
            onChange={setConsultorFiltro}
            labelTodos="Todos os consultores"
            labelSufixo="consultores"
          />
          {status === "pendente" && pendentesDecidiveis.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => decidirEmLote(false)} disabled={processandoLote} className={classeBotao.destrutivo}>
                Reprovar todos ({pendentesDecidiveis.length})
              </button>
              <button onClick={() => decidirEmLote(true)} disabled={processandoLote} className={classeBotao.primario}>
                {processandoLote ? "Processando..." : `Aprovar todos (${pendentesDecidiveis.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {solicitacoesFiltradas.length === 0 ? (
        <p className="mt-2 rounded-md border border-border bg-surface-2/40 px-4 py-3 text-sm text-muted">
          {solicitacoes.length === 0 ? "Nenhum pedido de ajuste de horário por aqui." : "Nenhuma solicitação com esse filtro de consultor."}
        </p>
      ) : (
        <div className="space-y-2">
          {solicitacoesFiltradas.map((s) => (
            <div key={s.id} className="rounded-md border border-border bg-surface px-3.5 py-3">
              <CabecalhoLinha {...s} onVerAtividade={onVerAtividade} criadoEm={s.criadoEm} />

              <p className="mt-1.5 font-mono text-[12px] text-muted">
                De{" "}
                <span className="text-muted">{intervalo(s.inicioAnterior ?? s.inicioAtual, s.fimAnterior ?? s.fimAtual ?? s.inicioAtual)}</span>
                {" para "}
                <span className="text-warning">{intervalo(s.inicioSolicitado, s.fimSolicitado)}</span>
                {s.inicioAprovado && s.fimAprovado && (
                  <>
                    {" · Gravado "}
                    <span className="text-success">{intervalo(s.inicioAprovado, s.fimAprovado)}</span>
                  </>
                )}
              </p>

              <p className="mt-1.5 text-[13px] text-foreground">
                <span className="text-muted">Motivo: </span>
                {s.motivo}
              </p>

              {s.status !== "pendente" && (
            <p className="mt-1 text-[12px] text-muted">
              {s.decisorNome} decidiu em {s.decididoEm ? dateTimeFormatter.format(new Date(s.decididoEm)) : "—"}
              {s.observacaoDecisao && ` — "${s.observacaoDecisao}"`}
            </p>
          )}

          {s.status === "pendente" && (
            <p className="mt-1 text-[11.5px] text-warning">
              O envio deste apontamento ao Senior está retido até a decisão.
            </p>
          )}

          {s.status === "pendente" &&
            s.podeDecidir &&
            (decidindoId === s.id ? (
              <div className="mt-2 space-y-2 rounded-md border border-border bg-surface-2/40 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`aj-data-${s.id}`} className="text-[12px] text-muted">
                    Data
                  </label>
                  <input id={`aj-data-${s.id}`} type="date" value={data} onChange={(e) => setData(e.target.value)} className={classeCampo} />
                  <label htmlFor={`aj-ini-${s.id}`} className="text-[12px] text-muted">
                    das
                  </label>
                  <input id={`aj-ini-${s.id}`} type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} className={classeCampo} />
                  <label htmlFor={`aj-fim-${s.id}`} className="text-[12px] text-muted">
                    às
                  </label>
                  <input id={`aj-fim-${s.id}`} type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} className={classeCampo} />
                </div>
                <input
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Observação (opcional) — vai junto no aviso ao consultor"
                  className={`w-full ${classeCampo}`}
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button onClick={() => setDecidindoId(null)} disabled={enviando} className={classeBotao.neutro}>
                    Cancelar
                  </button>
                  <button onClick={() => decidir(s, false)} disabled={enviando} className={classeBotao.destrutivo}>
                    Reprovar
                  </button>
                  <button onClick={() => decidir(s, true)} disabled={enviando} className={classeBotao.primario}>
                    {enviando ? "Salvando..." : "Aprovar"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setDecidindoId(s.id);
                  setData(paraInputData(s.inicioSolicitado));
                  setHoraInicio(paraInputHora(s.inicioSolicitado));
                  setHoraFim(paraInputHora(s.fimSolicitado));
                  setObservacao("");
                }}
                className={`mt-2 ${classeBotao.neutro}`}
              >
                Decidir
              </button>
            ))}
        </div>
      ))}
        </div>
      )}
    </div>
  );
}

// Uma tela, três tipos de pedido, dois recortes. O gestor decide os do time dele; o
// consultor acompanha os próprios. Quem separa é o servidor — a tela só desenha o que veio,
// e `podeDecidir` por linha diz de qual lado a pessoa está naquele pedido.
export function Aprovacoes() {
  const toast = useToast();
  const [aba, setAba] = useState<Aba>("excedentes");
  const [status, setStatus] = useState("pendente");
  const [atividadeAberta, setAtividadeAberta] = useState<AtividadeDetalheDados | null>(null);
  // Força as listas a recarregar quando o drawer mexe no excedente da atividade.
  const [versao, setVersao] = useState(0);

  async function abrirAtividade(atividadeId: number) {
    try {
      const { data } = await axios.get(`/api/atividades/${atividadeId}/detalhe`);
      setAtividadeAberta(data.atividade);
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? "Não foi possível abrir esta atividade", "destructive");
    }
  }

  const abas: { valor: Aba; rotulo: string }[] = [
    { valor: "excedentes", rotulo: "Horas Excedentes" },
    { valor: "apontamentos", rotulo: "Apontamentos" },
    { valor: "ajustes", rotulo: "Ajustes de horário" },
  ];

  const descricaoDaAba: Record<Aba, string> = {
    excedentes:
      "Horas acima do alocado, pedidas por quem executa e liberadas pelo gestor do departamento. O que é aprovado entra no teto de apontamento da atividade.",
    apontamentos:
      "Tempo trabalhado sem mover o card de raia. Aprovar libera o apontamento para o consultor confirmar em Meus Apontamentos — quem fecha e envia ao Senior continua sendo quem executou.",
    ajustes:
      "Correção de horário de apontamento já confirmado. Enquanto o pedido está aqui, o envio ao Senior fica retido — o ERP só recebe o valor final, e nunca precisa ser alterado lá.",
  };

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Gestão de Projetos · Aprovações</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-foreground">Aprovações</h1>
      <p className="mt-1 text-sm text-muted">{descricaoDaAba[aba]}</p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1 border-b border-border">
          {abas.map((a) => (
            <button
              key={a.valor}
              onClick={() => setAba(a.valor)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium ${
                aba === a.valor ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              onClick={() => setStatus(f.valor)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium ${
                status === f.valor
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
      </div>

      {aba === "excedentes" && (
        <ListaExcedentes key={`exc-${versao}`} status={status} onVerAtividade={abrirAtividade} onMudou={() => setVersao((v) => v + 1)} />
      )}
      {aba === "apontamentos" && (
        <ListaApontamentos key={`apo-${versao}`} status={status} onVerAtividade={abrirAtividade} onMudou={() => setVersao((v) => v + 1)} />
      )}
      {aba === "ajustes" && (
        <ListaAjustes key={`aju-${versao}`} status={status} onVerAtividade={abrirAtividade} onMudou={() => setVersao((v) => v + 1)} />
      )}

      {/* O mesmo painel que abre ao clicar no card do quadro. `podeEditar` false: aqui o
          gestor veio conferir o que aconteceu na atividade antes de decidir, não editar
          planejamento nem checklist. */}
      {atividadeAberta && (
        <AtividadeDetalhe
          atividadeId={atividadeAberta.id}
          titulo={`Proposta ${atividadeAberta.codpro} · Projeto ${atividadeAberta.numprj ?? "—"}`}
          podeEditar={false}
          dataPrevistaInicio={atividadeAberta.dataPrevistaInicio}
          dataPrevistaFim={atividadeAberta.dataPrevistaFim}
          codemp={atividadeAberta.codemp}
          codpro={atividadeAberta.codpro}
          itemDescricao={atividadeAberta.itemDescricao}
          itemQtdhor={atividadeAberta.itemQtdhor}
          itemAlocado={atividadeAberta.itemAlocado}
          itemRealizado={atividadeAberta.itemRealizado}
          estruturaNome={atividadeAberta.estruturaNome}
          estruturaPercentual={atividadeAberta.estruturaPercentual}
          podeVerCronograma={atividadeAberta.podeVerCronograma}
          qtdhorPrevisto={atividadeAberta.qtdhorPrevisto}
          horasExcedentes={atividadeAberta.horasExcedentes}
          horasRealizadas={atividadeAberta.horasRealizadas}
          // O campo direto do gestor continua valendo aqui — é a outra forma de liberar
          // horas, e mexer nele muda o teto que esta tela mostra, então as listas recarregam.
          podeAutorizarExcedente={atividadeAberta.podeAutorizarExcedente}
          souOExecutor={atividadeAberta.souOExecutor}
          onExcedenteAlterado={() => setVersao((v) => v + 1)}
          onClose={() => setAtividadeAberta(null)}
        />
      )}
    </div>
  );
}
