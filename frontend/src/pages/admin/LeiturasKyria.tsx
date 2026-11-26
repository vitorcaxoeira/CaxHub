import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ListaServidor } from "../../components/colunas/ListaServidor";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { toneBadge, type Tone } from "../../components/ui/badges";

// Leituras do Kyria (25/11/2026, adaptado das "Leituras do Senior" do CaxHub_Dash): cada execução de um job de sincronização e, dentro dela, cada
// chamada HTTP à API (cursor enviado e devolvido, limite, linhas, KB, tempo de ida e volta, tentativas, espera do 429 e o requestId do Kyria).
// Sem entrada própria no menu: alcançável pelo botão "Leituras do Kyria" e pelo link "Ver leituras" de cada tabela (?job=) da Integração Kyria.
// Limpar os logs é do admin e NUNCA apaga a leitura em andamento, o histórico de sincronizações nem o cursor do feed de apontamentos
// (backend: kyria/registroLeitura.ts, limparLeituras). Os logs ficam 30 dias.

interface Leitura {
  id: number;
  jobName: string;
  tabela: string;
  recurso: string;
  limite: number | null;
  timeoutMs: number;
  iniciadaEm: string;
  finalizadaEm: string | null;
  status: string;
  statusCodigo: string;
  paginas: number;
  linhas: number;
  chamadas: number;
  erros: number;
  msMedio: number | null;
  msMax: number | null;
  esperaS: number;
  duracaoMs: number;
  ultimoCursor: string | null;
  erro: string | null;
}

interface Chamada {
  id: number;
  disparadaEm: string;
  cursor: string | null;
  proximoCursor: string | null;
  limite: number | null;
  linhas: number;
  kb: number;
  msKyria: number;
  tentativa: number;
  httpStatus: number | null;
  esperaS: number | null;
  status: string;
  requestId: string | null;
  erro: string | null;
}

interface JobOpcao {
  jobName: string;
  displayName: string;
}

const STATUS_OPCOES = [
  { valor: "em_andamento", rotulo: "Em andamento" },
  { valor: "concluida", rotulo: "Concluída" },
  { valor: "falhou", rotulo: "Falhou" },
  { valor: "interrompida", rotulo: "Interrompida" },
];
const TOM_STATUS: Record<string, Tone> = { em_andamento: "warning", concluida: "success", falhou: "destructive", interrompida: "warning" };

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
const fmtDataHora = (iso: string | null) => (iso ? dataHora.format(new Date(iso)) : "—");
const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR"));
const fmtSeg = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`);

function Selo({ texto, tone }: { texto: string; tone: Tone }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[tone]}`}>{texto}</span>;
}

const mono = "font-mono text-[12px] tabular-nums text-foreground";
const COLUNAS: DefColuna<Leitura>[] = [
  { nome: "iniciadaEm", titulo: "Início", fixa: true, largura: 150, classe: "font-mono text-[12px] text-foreground", render: (l) => fmtDataHora(l.iniciadaEm) },
  {
    nome: "tabela",
    titulo: "Tabela",
    largura: 220,
    texto: (l) => `${l.tabela} · ${l.jobName}`,
    render: (l) => (
      <div className="min-w-0">
        <div className="truncate text-foreground">{l.tabela}</div>
        <div className="truncate font-mono text-[10.5px] text-muted">{l.jobName}</div>
      </div>
    ),
  },
  { nome: "status", titulo: "Status", largura: 120, render: (l) => <Selo texto={l.status} tone={TOM_STATUS[l.statusCodigo] ?? "neutral"} /> },
  { nome: "recurso", titulo: "Recurso", largura: 170, classe: "font-mono text-[12px] text-muted", ocultaPorPadrao: true, render: (l) => l.recurso },
  { nome: "paginas", titulo: "Páginas", direita: true, largura: 80, dica: "Chamadas bem-sucedidas", classe: mono, render: (l) => fmtNum(l.paginas) },
  { nome: "linhas", titulo: "Linhas", direita: true, largura: 90, classe: mono, formatarResumo: fmtNum, render: (l) => fmtNum(l.linhas) },
  { nome: "limite", titulo: "Limite", direita: true, largura: 80, dica: "Itens por página pedidos (relatórios não paginam)", classe: mono, render: (l) => fmtNum(l.limite) },
  { nome: "timeoutMs", titulo: "Timeout", direita: true, largura: 80, classe: mono, ocultaPorPadrao: true, render: (l) => fmtSeg(l.timeoutMs) },
  {
    nome: "chamadas",
    titulo: "Chamadas",
    direita: true,
    largura: 100,
    dica: "Chamadas à API, inclusive tentativas; entre parênteses as que falharam",
    classe: mono,
    formatarResumo: fmtNum,
    render: (l) => (
      <span>
        {fmtNum(l.chamadas)}
        {l.erros > 0 && <span className="text-destructive"> ({l.erros})</span>}
      </span>
    ),
  },
  { nome: "msMedio", titulo: "Kyria (médio)", direita: true, largura: 110, dica: "Tempo médio de ida e volta de cada chamada", classe: mono, render: (l) => fmtSeg(l.msMedio) },
  {
    nome: "msMax",
    titulo: "Kyria (pior)",
    direita: true,
    largura: 110,
    classe: (l) => `${mono}${l.msMax != null && l.msMax >= l.timeoutMs ? " font-semibold text-destructive" : ""}`,
    render: (l) => fmtSeg(l.msMax),
  },
  {
    nome: "esperaS",
    titulo: "Espera 429",
    direita: true,
    largura: 100,
    dica: "Segundos esperados (Retry-After) por estourar o limite de 60 requisições por minuto",
    classe: mono,
    render: (l) => (l.esperaS > 0 ? `${fmtNum(l.esperaS)} s` : "—"),
  },
  { nome: "duracaoMs", titulo: "Duração", direita: true, largura: 90, dica: "Da abertura ao fim da leitura (inclui esperas e gravação)", classe: mono, render: (l) => fmtSeg(l.duracaoMs) },
  { nome: "finalizadaEm", titulo: "Fim", largura: 150, classe: "font-mono text-[12px] text-muted", ocultaPorPadrao: true, render: (l) => fmtDataHora(l.finalizadaEm) },
  {
    nome: "ultimoCursor",
    titulo: "Parou em",
    largura: 220,
    quebra: true,
    dica: "Último cursor devolvido pela API. No feed de apontamentos, é dali que a próxima execução continua (kyria_sync_cursor).",
    classe: "break-all font-mono text-[11px] text-muted",
    texto: (l) => l.ultimoCursor,
    render: (l) => (l.statusCodigo === "concluida" || !l.ultimoCursor ? "—" : l.ultimoCursor),
  },
  { nome: "erro", titulo: "Erro", largura: 300, quebra: true, classe: "text-[12px] text-destructive", texto: (l) => l.erro, render: (l) => l.erro ?? "" },
];

const COLUNAS_CHAMADAS: DefColuna<Chamada, number>[] = [
  { nome: "disparadaEm", titulo: "Disparada em", fixa: true, largura: 150, classe: "font-mono text-[12px] text-foreground", render: (c) => fmtDataHora(c.disparadaEm) },
  { nome: "cursor", titulo: "Cursor enviado", largura: 200, quebra: true, classe: "break-all font-mono text-[11px] text-muted", texto: (c) => c.cursor, render: (c) => c.cursor ?? "início" },
  { nome: "proximoCursor", titulo: "Próximo cursor", largura: 200, quebra: true, classe: "break-all font-mono text-[11px] text-muted", texto: (c) => c.proximoCursor, render: (c) => c.proximoCursor ?? "—" },
  { nome: "limite", titulo: "Limite", direita: true, largura: 80, classe: mono, render: (c) => fmtNum(c.limite) },
  { nome: "linhas", titulo: "Linhas", direita: true, largura: 80, classe: mono, formatarResumo: fmtNum, render: (c) => fmtNum(c.linhas) },
  { nome: "kb", titulo: "KB", direita: true, largura: 80, classe: mono, formatarResumo: fmtNum, render: (c) => fmtNum(c.kb) },
  {
    nome: "msKyria",
    titulo: "Kyria",
    direita: true,
    largura: 90,
    dica: "Ida e volta da chamada (rede + Kyria)",
    classe: (c, timeoutMs) => `${mono}${c.msKyria >= timeoutMs ? " font-semibold text-destructive" : ""}`,
    render: (c) => fmtSeg(c.msKyria),
  },
  { nome: "tentativa", titulo: "Tentativa", direita: true, largura: 80, classe: mono, render: (c) => c.tentativa },
  { nome: "httpStatus", titulo: "HTTP", direita: true, largura: 70, classe: mono, render: (c) => c.httpStatus ?? "—" },
  { nome: "esperaS", titulo: "Espera", direita: true, largura: 80, dica: "Retry-After esperado antes da próxima tentativa", classe: mono, render: (c) => (c.esperaS ? `${c.esperaS} s` : "—") },
  { nome: "status", titulo: "Resultado", largura: 100, render: (c) => (c.status === "ok" ? <span className="text-success">ok</span> : <span className="text-destructive">erro</span>) },
  { nome: "requestId", titulo: "Request ID", largura: 200, classe: "break-all font-mono text-[11px] text-muted", quebra: true, texto: (c) => c.requestId, render: (c) => c.requestId ?? "—" },
  { nome: "erro", titulo: "Erro", largura: 300, quebra: true, classe: "text-[12px] text-destructive", texto: (c) => c.erro, render: (c) => c.erro ?? "" },
];

export function LeiturasKyria() {
  const { mostrar } = useToast();
  const [params, setParams] = useSearchParams();
  const job = params.get("job") ?? "";
  const status = params.get("status") ?? "";
  const de = params.get("de") ?? "";
  const ate = params.get("ate") ?? "";

  const [jobs, setJobs] = useState<JobOpcao[]>([]);
  const [aberta, setAberta] = useState<Leitura | null>(null);
  const [limpar, setLimpar] = useState<"tabela" | "todas" | null>(null);
  const [limpando, setLimpando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    axios
      .get<{ jobs: JobOpcao[] }>("/api/sync-kyria")
      .then(({ data }) => setJobs(data.jobs.map((j) => ({ jobName: j.jobName, displayName: j.displayName }))))
      .catch(() => undefined);
  }, []);

  function filtrar(chave: string, valor: string) {
    const novo = new URLSearchParams(params);
    if (valor) novo.set(chave, valor);
    else novo.delete(chave);
    setParams(novo, { replace: true });
  }

  const paramsLista = useMemo(() => ({ job: job || undefined, status: status || undefined, de: de || undefined, ate: ate || undefined }), [job, status, de, ate]);
  const nomeDoJob = jobs.find((j) => j.jobName === job)?.displayName ?? job;
  const filtrando = !!(job || status || de || ate);

  async function confirmarLimpeza() {
    if (!limpar) return;
    setLimpando(true);
    try {
      const url = limpar === "tabela" ? `/api/sync-kyria/${encodeURIComponent(job)}/leituras` : "/api/sync-kyria/leituras";
      const { data } = await axios.delete<{ leiturasApagadas: number; chamadasApagadas: number }>(url);
      mostrar(`${fmtNum(data.leiturasApagadas)} leitura(s) e ${fmtNum(data.chamadasApagadas)} chamada(s) apagadas`, "success");
      setLimpar(null);
      setRecarga((n) => n + 1);
    } catch (e) {
      mostrar(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Não foi possível limpar os logs") : "Não foi possível limpar os logs", "destructive");
    } finally {
      setLimpando(false);
    }
  }

  const CAMPO = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const BOTAO = "rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        <Link to="/admin/sincronizacao-kyria" className="hover:underline">
          Administração · Integração Kyria
        </Link>
      </p>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-foreground">Leituras do Kyria</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Cada execução de uma tabela e, dentro dela, cada chamada à API do Kyria: quando foi disparada, o cursor enviado e o devolvido, o limite,
            quanto o Kyria levou, as tentativas depois de um 429 e o requestId para falar com o suporte. Os logs ficam 30 dias.
          </p>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          <button onClick={() => setLimpar("tabela")} disabled={!job} title={!job ? "Escolha uma tabela no filtro" : undefined} className={BOTAO}>
            Limpar logs desta tabela
          </button>
          <button onClick={() => setLimpar("todas")} className={BOTAO}>
            Limpar logs de todas as tabelas
          </button>
          <Link to="/admin/sincronizacao-kyria" className={BOTAO}>
            ← Voltar pra lista
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          Tabela
          <select value={job} onChange={(e) => filtrar("job", e.target.value)} className={`${CAMPO} w-64`}>
            <option value="">Todas as tabelas</option>
            {jobs.map((j) => (
              <option key={j.jobName} value={j.jobName}>
                {j.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          Status
          <select value={status} onChange={(e) => filtrar("status", e.target.value)} className={CAMPO}>
            <option value="">Todos</option>
            {STATUS_OPCOES.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          De
          <input type="date" value={de} onChange={(e) => filtrar("de", e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          Até
          <input type="date" value={ate} onChange={(e) => filtrar("ate", e.target.value)} className={CAMPO} />
        </label>
        {filtrando && (
          <button onClick={() => setParams(new URLSearchParams(), { replace: true })} className={BOTAO}>
            Limpar filtros
          </button>
        )}
      </div>

      <ListaServidor<Leitura>
        chave="admin.kyria.leituras"
        url="/api/sync-kyria/leituras"
        params={paramsLista}
        recarga={recarga}
        defs={COLUNAS}
        chaveLinha={(l) => String(l.id)}
        rotulo="leituras"
        vazio={filtrando ? "Nenhuma leitura com estes filtros." : "Nenhuma leitura registrada ainda. Elas aparecem aqui assim que uma tabela sincronizar (manual ou pelo horário agendado)."}
        pageSize={25}
        exportavel="kyria-leituras"
        onLinha={setAberta}
        classeLinha={() => "cursor-pointer"}
      />

      <Modal
        open={aberta !== null}
        onClose={() => setAberta(null)}
        title={aberta ? `Leitura #${aberta.id} — ${aberta.tabela}` : "Leitura"}
        subtitulo={aberta ? `${fmtDataHora(aberta.iniciadaEm)} · limite ${fmtNum(aberta.limite)} · timeout ${fmtSeg(aberta.timeoutMs)} · ${aberta.status}` : undefined}
        className="max-w-6xl"
      >
        {aberta && (
          <>
            {aberta.erro && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{aberta.erro}</p>}
            <ListaServidor<Chamada, number>
              chave="admin.kyria.leituras.chamadas"
              url="/api/sync-kyria/chamadas"
              params={{ leituraId: aberta.id }}
              defs={COLUNAS_CHAMADAS}
              ctx={aberta.timeoutMs}
              chaveLinha={(c) => String(c.id)}
              rotulo="chamadas"
              vazio="Sem chamadas registradas (os logs desta leitura podem ter sido limpos)."
              pageSize={50}
            />
          </>
        )}
      </Modal>

      <Modal open={limpar !== null} onClose={() => !limpando && setLimpar(null)} title={limpar === "tabela" ? `Limpar os logs de ${nomeDoJob}?` : "Limpar os logs de todas as tabelas?"} className="max-w-lg">
        <p className="text-sm text-foreground">Apaga as leituras e as chamadas registradas {limpar === "tabela" ? "desta tabela" : "de todas as tabelas do Kyria"}.</p>
        <ul className="mt-2 list-disc pl-5 text-sm text-muted">
          <li>Fica a leitura que estiver em andamento.</li>
          <li>O histórico de sincronizações da tela anterior e o cursor do feed de apontamentos não mudam.</li>
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setLimpar(null)} disabled={limpando} className={BOTAO}>
            Cancelar
          </button>
          <button
            onClick={confirmarLimpeza}
            disabled={limpando}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {limpando ? "Limpando..." : "Limpar logs"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
