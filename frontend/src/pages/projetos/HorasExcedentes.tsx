import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../components/ui/Toast";
import { AtividadeDetalhe, SolicitacaoExcedente } from "../../components/projetos/AtividadeDetalhe";
import { formatHoras, horasParaMinutos, minutosParaInputHoras } from "../../utils/horas";

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
  podeAutorizarExcedente: boolean;
  podeSolicitarExcedente: boolean;
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

// Painel único: o gestor decide os pedidos do time dele, o consultor acompanha os
// próprios. O recorte é do servidor (GET /solicitacoes-excedente) — a tela só desenha o
// que veio, e `podeDecidir` por linha diz de qual lado a pessoa está naquele pedido.
export function HorasExcedentes() {
  const toast = useToast();
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoExcedente[]>([]);
  const [status, setStatus] = useState("pendente");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Decisão em andamento: qual linha está aberta, quanto o gestor vai liberar e por quê.
  const [decidindoId, setDecidindoId] = useState<number | null>(null);
  const [horasAprovadasInput, setHorasAprovadasInput] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Atividade aberta em painel lateral, por cima desta tela.
  const [atividadeAberta, setAtividadeAberta] = useState<AtividadeDetalheDados | null>(null);

  async function abrirAtividade(atividadeId: number) {
    try {
      const { data } = await axios.get(`/api/atividades/${atividadeId}/detalhe`);
      setAtividadeAberta(data.atividade);
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? "Não foi possível abrir esta atividade", "destructive");
    }
  }

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

  function abrirDecisao(s: SolicitacaoExcedente) {
    setDecidindoId(s.id);
    // Já nasce com o que foi pedido: aprovar o valor integral é o caminho comum, e o
    // gestor só digita quando quer liberar diferente.
    setHorasAprovadasInput(minutosParaInputHoras(s.horasSolicitadas));
    setObservacao("");
  }

  async function decidir(s: SolicitacaoExcedente, aprovar: boolean) {
    const minutos = aprovar ? horasParaMinutos(horasAprovadasInput) : null;
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

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Gestão de Projetos · Horas Excedentes</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-foreground">Solicitações de horas excedentes</h1>
      <p className="mt-1 text-sm text-muted">
        Horas acima do alocado, pedidas por quem executa e liberadas pelo gestor do departamento. O que é aprovado entra no
        teto de apontamento da atividade.
      </p>

      {erro && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            onClick={() => setStatus(f.valor)}
            className={`rounded-md px-3 py-1 text-[12.5px] font-medium ${
              status === f.valor ? "bg-primary text-primary-foreground" : "border border-border text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-muted">Carregando...</p>
      ) : solicitacoes.length === 0 ? (
        <p className="mt-6 rounded-md border border-border bg-surface-2/40 px-4 py-3 text-sm text-muted">
          Nenhuma solicitação {status ? FILTROS.find((f) => f.valor === status)?.rotulo.toLowerCase() : ""} por aqui.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {solicitacoes.map((s) => (
            <div key={s.id} className="rounded-md border border-border bg-surface px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] uppercase ${TOM_STATUS[s.status] ?? ""}`}>
                  {s.status}
                </span>
                <span className="text-sm font-medium text-foreground">{s.solicitanteNome}</span>
                <span className="text-[12.5px] text-muted">
                  · Proposta {s.codpro} · Item {String(s.seqite).padStart(2, "0")} · {s.depexeLabel}
                </span>
                {/* Abre o painel AQUI, sem navegar: quem decide está no meio de uma fila
                    de pedidos, e ir pra tela de Atividades carregaria quadro, KPIs e
                    filtros inteiros só pra mostrar um painel lateral — e na volta o
                    filtro e a rolagem deste painel já teriam se perdido. */}
                <button
                  onClick={() => abrirAtividade(s.atividadeId)}
                  className="text-[12.5px] font-medium text-primary hover:underline"
                >
                  Ver atividade
                </button>
                <span className="ml-auto font-mono text-[12.5px] text-muted">
                  {dateTimeFormatter.format(new Date(s.criadoEm))}
                </span>
              </div>

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

              <p className="mt-1.5 text-[13px] text-foreground">{s.motivo}</p>

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
                        value={horasAprovadasInput}
                        onChange={(e) => setHorasAprovadasInput(e.target.value)}
                        placeholder="4:00"
                        className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <span className="text-[11.5px] text-muted">soma ao excedente que a atividade já tem</span>
                    </div>
                    <input
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value)}
                      placeholder="Observação (opcional) — vai junto no aviso ao consultor"
                      className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        onClick={() => setDecidindoId(null)}
                        disabled={enviando}
                        className="rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => decidir(s, false)}
                        disabled={enviando}
                        className="rounded-md border border-destructive/40 px-2.5 py-1 text-[12.5px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        Reprovar
                      </button>
                      <button
                        onClick={() => decidir(s, true)}
                        disabled={enviando}
                        className="rounded-md bg-primary px-3 py-1 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {enviando ? "Salvando..." : "Aprovar"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => abrirDecisao(s)}
                    className="mt-2 rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted hover:bg-surface-2 hover:text-foreground"
                  >
                    Decidir
                  </button>
                ))}
            </div>
          ))}
        </div>
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
          // O campo direto do gestor continua valendo aqui — é a outra forma de liberar
          // horas, e mexer nele muda o teto que esta tela mostra, então o painel recarrega.
          podeAutorizarExcedente={atividadeAberta.podeAutorizarExcedente}
          podeSolicitarExcedente={atividadeAberta.podeSolicitarExcedente}
          onExcedenteAlterado={carregar}
          onClose={() => setAtividadeAberta(null)}
        />
      )}
    </div>
  );
}
