import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtividadeKanban } from "../../components/projetos/KanbanBoard";
import { ModalObservacaoAtividade } from "../../components/projetos/ModalObservacaoAtividade";
import {
  DetalheVigiaAlerta,
  EVENTO_SESSAO_ALTERADA,
  EVENTO_VIGIA_ALERTA,
  avisarSessaoAlterada,
} from "../../components/projetos/VigiaFimDeJornada";
import { IndicadorProgresso } from "../../components/cronograma/IndicadorProgresso";
import { IconePlay, IconeStop } from "../../components/ui/iconesExecucao";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../components/ui/Toast";
import { useCronometro } from "../../hooks/useCronometro";
import { RAIA_A_FAZER, RAIA_EM_ANDAMENTO, motivoIniciarDesabilitado, podeIniciar } from "../../lib/atividade-acoes";
import { tomConsumo } from "../../lib/consumoHoras";
import { formatHorasCompacto } from "../../lib/cronograma";
import {
  ModoJanela,
  abrirNoNavegador,
  aplicarPreferencias,
  definirModo,
  estaNoApp,
  notificar,
  trazerParaFrente,
} from "../../lib/desktop";

// Janela flutuante do CaxHub Desktop (rota /flutuante, ver layout/FlutuanteShell). Feita pra
// ~360px de largura: a atividade em andamento com o cronômetro, Iniciar/Parar e as próximas
// atividades pra trocar rápido. Também roda num navegador comum (os comandos nativos viram
// no-op, ver lib/desktop.ts), o que serve pra testar e de alternativa sem o app.

interface Preferencias {
  abrirAoIniciar: boolean;
  sempreNoTopo: boolean;
  alertasJornada: boolean;
  /** Minutos entre os avisos de "sem atividade em execução"; 0 = não avisar. */
  frequenciaAvisoMin: number;
  modoInicial: ModoJanela;
}

interface JornadaHoje {
  periodos: { inicio: number; fim: number }[];
  minutosAgora: number;
}

const CHAVE_MODO = "caxhub-flutuante-modo";
// 15s: é o que torna rápido perceber uma atividade parada pelo navegador (ou pelo servidor).
const INTERVALO_ATUALIZAR_MS = 15_000;
const INTERVALO_JORNADA_MS = 30_000;
// Depois de uma ação feita NESTA janela (iniciar/parar), não avisa "foi encerrada fora daqui": a
// mudança que a próxima leitura vai trazer é a que a própria pessoa acabou de fazer.
const SILENCIO_ACAO_LOCAL_MS = 20_000;
// O vigia de fim de jornada já avisa por conta própria, e a parada que vem depois dele é esperada.
const SILENCIO_VIGIA_MS = 5 * 60_000;

function modoSalvo(): ModoJanela | null {
  try {
    const v = localStorage.getItem(CHAVE_MODO);
    return v === "pilula" || v === "expandida" ? v : null;
  } catch {
    return null;
  }
}

function limitePrevisto(a: AtividadeKanban): number {
  return (a.qtdhorPrevisto ?? 0) + a.horasExcedentes;
}

function Consumo({ realizado, previsto }: { realizado: number; previsto: number }) {
  const temPrevisto = previsto > 0;
  const avanco = temPrevisto ? realizado / previsto : 0;
  const tom = tomConsumo(avanco);
  return (
    <>
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums text-muted">
        <span>
          {formatHorasCompacto(realizado)}
          {temPrevisto && ` / ${formatHorasCompacto(previsto)}`} h
        </span>
        {temPrevisto && <span className={tom.texto}>{Math.round(avanco * 100)}%</span>}
      </div>
      {temPrevisto && <IndicadorProgresso avanco={avanco} cor={tom.barra} alturaPx={3} className="mt-1" />}
    </>
  );
}

function Cabecalho({ modo, onAlternar }: { modo: ModoJanela; onAlternar: () => void }) {
  return (
    <div data-tauri-drag-region className="flex h-8 flex-none select-none items-center gap-2 border-b border-border bg-surface px-3">
      {/* No app a barra de título nativa já mostra "CaxHub". */}
      {!estaNoApp() && (
        <span data-tauri-drag-region className="flex items-center gap-1.5 font-display text-[11px] font-bold tracking-wide text-foreground">
          <img src="/marca/icone-128.png" alt="" className="h-4 w-4 rounded" />
          CaxHub
        </span>
      )}
      <span data-tauri-drag-region className="flex-1" />
      <button
        type="button"
        onClick={() => abrirNoNavegador(`${window.location.origin}/projetos/atividades`)}
        title="Abrir o CaxHub completo no navegador"
        className="rounded px-1.5 py-0.5 text-[10.5px] text-muted hover:bg-surface-2 hover:text-foreground"
      >
        Abrir completo
      </button>
      <button
        type="button"
        onClick={onAlternar}
        aria-label={modo === "pilula" ? "Expandir" : "Recolher"}
        title={modo === "pilula" ? "Expandir" : "Recolher"}
        className="rounded px-1.5 py-0.5 text-[12px] leading-none text-muted hover:bg-surface-2 hover:text-foreground"
      >
        {modo === "pilula" ? "▢" : "▭"}
      </button>
    </div>
  );
}

function CartaoEmAndamento({
  atividade,
  processando,
  onParar,
}: {
  atividade: AtividadeKanban;
  processando: boolean;
  onParar: (a: AtividadeKanban) => void;
}) {
  const { texto, atingiuLimite, decorridoMinutos } = useCronometro(atividade.sessaoAtualInicio, atividade.sessaoLimite);
  const contexto = atividade.estruturaNome ?? atividade.itemDescricao;
  return (
    <div className="rounded-lg border border-success/40 bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 flex-none">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Em andamento</span>
        <span
          className={`ml-auto font-mono text-lg font-semibold tabular-nums ${atingiuLimite ? "text-destructive" : "text-success"}`}
          title={atingiuLimite ? "Limite atingido — a execução está sendo encerrada" : undefined}
        >
          {texto}
          {atingiuLimite && " ⏹"}
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground" title={atividade.cliente}>
        Proposta {atividade.codpro} · {atividade.cliente}
      </p>
      {contexto && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted" title={contexto}>
          {contexto}
        </p>
      )}
      <div className="mt-2">
        <Consumo realizado={atividade.horasRealizadas + decorridoMinutos} previsto={limitePrevisto(atividade)} />
      </div>
      <button
        type="button"
        onClick={() => onParar(atividade)}
        disabled={processando}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded border border-destructive/50 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {processando ? <Spinner className="h-3 w-3" /> : <IconeStop />}
        Parar
      </button>
    </div>
  );
}

function Pilula({
  atividade,
  processando,
  onParar,
  onExpandir,
}: {
  atividade: AtividadeKanban | null;
  processando: boolean;
  onParar: (a: AtividadeKanban) => void;
  onExpandir: () => void;
}) {
  const { texto, atingiuLimite } = useCronometro(atividade?.sessaoAtualInicio ?? null, atividade?.sessaoLimite);
  return (
    <div className="flex h-full items-center gap-2 px-3">
      {atividade ? (
        <>
          <span className="relative flex h-2 w-2 flex-none">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-xs text-foreground" title={atividade.cliente}>
            {atividade.codpro} · {atividade.cliente}
          </span>
          <span
            data-tauri-drag-region
            className={`flex-none font-mono text-sm font-semibold tabular-nums ${atingiuLimite ? "text-destructive" : "text-success"}`}
          >
            {texto}
          </span>
          <button
            type="button"
            onClick={() => onParar(atividade)}
            disabled={processando}
            aria-label="Parar"
            title="Parar"
            className="flex-none rounded border border-destructive/50 p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {processando ? <Spinner className="h-3 w-3" /> : <IconeStop className="h-3 w-3" />}
          </button>
        </>
      ) : (
        <>
          <span className="h-2 w-2 flex-none rounded-full bg-muted/50" />
          <span data-tauri-drag-region className="flex-1 truncate text-xs text-muted">
            Nenhuma atividade em andamento
          </span>
          <button
            type="button"
            onClick={onExpandir}
            className="flex-none rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
          >
            Iniciar…
          </button>
        </>
      )}
    </div>
  );
}

function LinhaAFazer({
  atividade,
  processando,
  onIniciar,
}: {
  atividade: AtividadeKanban;
  processando: boolean;
  onIniciar: (a: AtividadeKanban) => void;
}) {
  const habilita = podeIniciar(atividade);
  const contexto = atividade.estruturaNome ?? atividade.itemDescricao;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface p-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground" title={atividade.cliente}>
          Proposta {atividade.codpro} · {atividade.cliente}
        </p>
        {contexto && (
          <p className="mt-0.5 truncate text-[10.5px] text-muted" title={contexto}>
            {contexto}
          </p>
        )}
        <div className="mt-1.5">
          <Consumo realizado={atividade.horasRealizadas} previsto={limitePrevisto(atividade)} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => onIniciar(atividade)}
        disabled={!habilita || processando}
        title={motivoIniciarDesabilitado(atividade)}
        className="mt-0.5 flex flex-none items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {processando ? <Spinner className="h-3 w-3" /> : <IconePlay className="h-3 w-3" />}
        Iniciar
      </button>
    </div>
  );
}

export function JanelaFlutuante() {
  const toast = useToast();
  // Espelham estado pra serem lidos dentro de timers e callbacks de longa vida (sem closure velha).
  const prefsRef = useRef<Preferencias | null>(null);
  // undefined = ainda não carregou; null = carregou e nada estava em execução.
  const emAndamentoAnteriorRef = useRef<{ id: number; codpro: number } | null | undefined>(undefined);
  const silenciarAteRef = useRef(0);
  const [codfor, setCodfor] = useState<number | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [prefs, setPrefs] = useState<Preferencias | null>(null);
  const [linhas, setLinhas] = useState<AtividadeKanban[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [modo, setModoState] = useState<ModoJanela>(() => modoSalvo() ?? "expandida");
  const [processando, setProcessando] = useState<number | null>(null);
  const [pedidoParada, setPedidoParada] = useState<AtividadeKanban | null>(null);

  const setModo = useCallback((novo: ModoJanela) => {
    setModoState(novo);
    try {
      localStorage.setItem(CHAVE_MODO, novo);
    } catch {
      // sem armazenamento: o modo só não é lembrado
    }
    void definirModo(novo);
  }, []);

  prefsRef.current = prefs;

  // Quem sou eu (consultor vinculado) + preferências. 403 = usuário sem consultor.
  useEffect(() => {
    let cancelado = false;
    Promise.all([axios.get("/api/desktop/eu"), axios.get("/api/desktop/preferencias")])
      .then(([eu, p]) => {
        if (cancelado) return;
        setCodfor(eu.data.codfor);
        setPrefs(p.data);
        // Sem modo salvo neste computador, vale o inicial escolhido no perfil.
        if (!modoSalvo()) setModoState(p.data.modoInicial);
      })
      .catch((err) => {
        if (cancelado) return;
        if (err.response?.status === 403) setSemAcesso(true);
        else setErro(err.response?.data?.error ?? "Falha ao carregar");
        setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Aplica no app as opções do perfil e o modo (tamanho da janela) a cada abertura.
  useEffect(() => {
    if (!prefs) return;
    void aplicarPreferencias({ abrirAoIniciar: prefs.abrirAoIniciar, sempreNoTopo: prefs.sempreNoTopo });
    void definirModo(modo);
    // Só na carga das preferências; trocar de modo depois já chama definirModo em setModo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);

  // A atividade que estava em execução deixou de estar, e não foi esta janela que mexeu nela:
  // parada no navegador, pausada porque outra foi iniciada lá, ou encerrada pelo servidor. Sem
  // este aviso o cronômetro some da janela e a pessoa só percebe olhando.
  function avisarSeEncerradaFora(lista: AtividadeKanban[]) {
    const atual = lista.find((a) => a.coluna?.nome === RAIA_EM_ANDAMENTO && a.sessaoAtualInicio) ?? null;
    const anterior = emAndamentoAnteriorRef.current;
    emAndamentoAnteriorRef.current = atual ? { id: atual.id, codpro: atual.codpro } : null;
    if (!anterior) return; // primeira leitura, ou nada estava em execução
    if (atual && atual.id === anterior.id) return;
    if (Date.now() < silenciarAteRef.current) return;
    if (!estaNoApp() || prefsRef.current?.alertasJornada !== true) return;
    void notificar(
      "CaxHub",
      atual
        ? `Proposta ${anterior.codpro} foi pausada: a Proposta ${atual.codpro} foi iniciada fora desta janela.`
        : `Proposta ${anterior.codpro} não está mais em execução: foi parada fora desta janela.`
    );
  }

  const carregar = useCallback(async () => {
    if (codfor == null) return;
    try {
      const { data } = await axios.get("/api/atividades", { params: { codfor } });
      const lista = (data.rows as AtividadeKanban[]).filter(
        (a) => a.coluna?.nome === RAIA_EM_ANDAMENTO || a.coluna?.nome === RAIA_A_FAZER
      );
      setLinhas(lista);
      avisarSeEncerradaFora(lista);
      setErro(null);
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao carregar atividades");
    } finally {
      setCarregando(false);
    }
  }, [codfor]);

  // Atualiza ao abrir, a cada 30s, quando a janela volta ao primeiro plano e quando o vigia
  // prorroga/encerra uma sessão (mesmo evento que a tela de Atividades já ouve).
  useEffect(() => {
    if (codfor == null) return;
    void carregar();
    const intervalo = setInterval(carregar, INTERVALO_ATUALIZAR_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener(EVENTO_SESSAO_ALTERADA, carregar);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener(EVENTO_SESSAO_ALTERADA, carregar);
    };
  }, [codfor, carregar]);

  const emAndamento = useMemo(
    () => linhas.find((a) => a.coluna?.nome === RAIA_EM_ANDAMENTO && a.sessaoAtualInicio) ?? null,
    [linhas]
  );
  const aFazer = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return linhas
      .filter((a) => a.coluna?.nome === RAIA_A_FAZER)
      .filter(
        (a) =>
          !termo ||
          `${a.codpro} ${a.cliente} ${a.itemDescricao ?? ""} ${a.estruturaNome ?? ""}`.toLowerCase().includes(termo)
      )
      .sort((a, b) => (a.dataPrevistaFim ?? "9999").localeCompare(b.dataPrevistaFim ?? "9999") || a.codpro - b.codpro);
  }, [linhas, busca]);

  // ---------- Alertas de jornada (só dentro do app) ----------
  const emAndamentoRef = useRef(false);
  emAndamentoRef.current = emAndamento != null;
  const alertasLigados = estaNoApp() && prefs?.alertasJornada === true;
  // Desde quando não há atividade em execução, e quando foi o último aviso. Reiniciam sempre que
  // a atividade em execução muda (começou, parou, trocou).
  const semAtividadeDesdeRef = useRef(Date.now());
  const ultimoAvisoRef = useRef(0);
  const idEmAndamento = emAndamento?.id ?? null;
  useEffect(() => {
    semAtividadeDesdeRef.current = Date.now();
    ultimoAvisoRef.current = 0;
  }, [idEmAndamento]);

  // Dentro do horário da jornada e sem nada em execução: avisa a cada `frequenciaAvisoMin` minutos
  // (opção do Meu perfil, 0 desliga) enquanto continuar assim. A contagem parte do que for mais
  // recente entre: a última atividade ter parado, o período da jornada ter começado e o app ter
  // aberto — abrir o app no meio da manhã não dispara um aviso na hora. Consultor sem jornada
  // cadastrada vem com lista vazia e não recebe.
  useEffect(() => {
    if (!estaNoApp()) return;
    let ativo = true;
    async function conferir() {
      try {
        // Relê as opções a cada volta: mudar a frequência no Meu perfil vale sem reabrir o app.
        const { data: p } = await axios.get<Preferencias>("/api/desktop/preferencias");
        if (!ativo) return;
        setPrefs((atual) => (atual && JSON.stringify(atual) === JSON.stringify(p) ? atual : p));
        if (!p.alertasJornada || p.frequenciaAvisoMin <= 0 || emAndamentoRef.current) return;
        const { data } = await axios.get<JornadaHoje>("/api/desktop/jornada-hoje");
        if (!ativo || emAndamentoRef.current) return;
        const periodo = data.periodos.find((x) => data.minutosAgora >= x.inicio && data.minutosAgora < x.fim);
        if (!periodo) return;
        const agora = Date.now();
        const inicioDoPeriodo = agora - (data.minutosAgora - periodo.inicio) * 60_000;
        const base = Math.max(semAtividadeDesdeRef.current, inicioDoPeriodo, ultimoAvisoRef.current);
        if (agora - base < p.frequenciaAvisoMin * 60_000) return;
        ultimoAvisoRef.current = agora;
        void notificar("CaxHub", "Você está no horário de trabalho e não há nenhuma atividade em execução.");
      } catch {
        // silencioso: é verificação de fundo
      }
    }
    void conferir();
    const intervalo = setInterval(conferir, INTERVALO_JORNADA_MS);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, []);

  // Fim do expediente / teto de horas: o vigia abre o modal e avisa por este evento.
  useEffect(() => {
    if (!alertasLigados) return;
    function aoAlertar(e: Event) {
      const d = (e as CustomEvent<DetalheVigiaAlerta>).detail;
      const corpo =
        d.motivo === "teto_atingido"
          ? `Proposta ${d.codpro}: o teto de horas foi atingido e a execução foi encerrada.`
          : d.iniciouForaDoExpediente
            ? `Proposta ${d.codpro} foi iniciada fora do expediente.`
            : `Proposta ${d.codpro}: seu expediente terminou. Ainda está trabalhando?`;
      // O vigia já avisou: a parada que vem depois dele não é "fora desta janela".
      silenciarAteRef.current = Date.now() + SILENCIO_VIGIA_MS;
      void notificar("CaxHub", corpo);
      void trazerParaFrente();
      setModo("expandida");
    }
    window.addEventListener(EVENTO_VIGIA_ALERTA, aoAlertar);
    return () => window.removeEventListener(EVENTO_VIGIA_ALERTA, aoAlertar);
  }, [alertasLigados, setModo]);

  // ---------- Iniciar / Parar (mesmos endpoints e mensagens da tela de Atividades) ----------
  async function iniciar(a: AtividadeKanban) {
    silenciarAteRef.current = Date.now() + SILENCIO_ACAO_LOCAL_MS;
    setProcessando(a.id);
    try {
      const { data } = await axios.post(`/api/atividades/${a.id}/start`);
      if (data.pausada) {
        toast.mostrar(`Atividade ${data.pausada.titulo} foi pausada para iniciar a Proposta ${a.codpro}`, "warning");
      }
      if (data.aviso) toast.mostrar(data.aviso, "warning");
      // Iniciar fora do expediente cria uma sessão com limite já vencido: o vigia precisa
      // consultar agora pra abrir o alerta, não só no próximo tique de 30s.
      avisarSessaoAlterada();
      await carregar();
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao iniciar atividade", "destructive");
      await carregar();
    } finally {
      setProcessando(null);
    }
  }

  function pedirParada(a: AtividadeKanban) {
    // O modal de observação não cabe na pílula (320×56): expande antes de abrir.
    if (modo === "pilula") setModo("expandida");
    setPedidoParada(a);
  }

  async function parar(a: AtividadeKanban, observacao: string) {
    setPedidoParada(null);
    silenciarAteRef.current = Date.now() + SILENCIO_ACAO_LOCAL_MS;
    setProcessando(a.id);
    try {
      const { data } = await axios.post(`/api/atividades/${a.id}/stop`, { observacao: observacao || undefined });
      if (data?.fimCortado) toast.mostrar(data.fimCortado, "warning");
      avisarSessaoAlterada();
      await carregar();
    } catch (err: any) {
      toast.mostrar(err.response?.data?.error ?? "Falha ao parar atividade", "destructive");
      await carregar();
    } finally {
      setProcessando(null);
    }
  }

  if (semAcesso) {
    return (
      <div className="flex h-full flex-col">
        <Cabecalho modo="expandida" onAlternar={() => undefined} />
        <p className="p-4 text-sm text-muted">
          A janela flutuante é para usuários com consultor vinculado. Procure um administrador se achar que deveria ter
          acesso.
        </p>
      </div>
    );
  }

  const alternar = () => setModo(modo === "pilula" ? "expandida" : "pilula");

  return (
    <div className="flex h-full flex-col">
      <Cabecalho modo={modo} onAlternar={alternar} />

      {modo === "pilula" ? (
        <div className="min-h-0 flex-1">
          <Pilula atividade={emAndamento} processando={processando === emAndamento?.id} onParar={pedirParada} onExpandir={() => setModo("expandida")} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {erro && <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{erro}</p>}
          {carregando ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-5 w-5" />
            </div>
          ) : (
            <>
              {emAndamento ? (
                <CartaoEmAndamento atividade={emAndamento} processando={processando === emAndamento.id} onParar={pedirParada} />
              ) : (
                <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted">
                  Nenhuma atividade em andamento
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
                    A fazer ({aFazer.length})
                  </p>
                  <input
                    type="search"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar…"
                    className="ml-auto w-32 rounded border border-border bg-surface px-2 py-1 text-[11px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  {aFazer.map((a) => (
                    <LinhaAFazer key={a.id} atividade={a} processando={processando === a.id} onIniciar={iniciar} />
                  ))}
                  {aFazer.length === 0 && (
                    <p className="py-3 text-center text-xs text-muted">{busca ? "Nada encontrado." : "Nenhuma atividade a fazer."}</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {pedidoParada && (
        <ModalObservacaoAtividade
          titulo={`Proposta ${pedidoParada.codpro}`}
          descricaoPadrao={pedidoParada.descricaoPadrao}
          onConfirmar={(obs) => void parar(pedidoParada, obs)}
          onFechar={() => void parar(pedidoParada, "")}
        />
      )}
    </div>
  );
}
