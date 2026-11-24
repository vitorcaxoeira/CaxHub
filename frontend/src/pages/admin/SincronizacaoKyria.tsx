import axios from "axios";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "../../components/ui/Modal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";
import { Skeleton } from "../../components/ui/Skeleton";
import { formatarDuracao } from "../../utils/duracao";

// Painel de administração dos jobs Kyria -> CaxHub. Mesmo espírito visual de "Importados do
// Senior" (admin/SincronizacaoErp.tsx), mas bem mais simples: a API do Kyria é só-leitura,
// cursor-paginada e sem conceito de "sumiu" (usa `status: active/inactive` no próprio
// registro) — não há filtro por campo, varredura de removidos, nem "Alterados" (nenhum
// catálogo aceita `updatedAfter`, só `/tickets`, ainda não implementado). Uma única ação por
// tabela: "Sincronizar agora".
interface JobKyria {
  jobName: string;
  displayName: string;
  urlCompleta: string;
  ordemExecucao: number;
  ativo: boolean;
  aceitaFiltros: boolean;
  totalRegistros: number;
  ultimaSincronizacao: string | null;
  ultimoStatus: string | null;
  ultimaMensagem: string | null;
  ultimaDuracaoMs: number | null;
  proximaExecucao: string;
  emAndamento: boolean;
}

interface DependenteKyria {
  jobName: string;
  displayName: string;
  tabelaLocal: string;
}

// Mês corrente completo (dia 01 ao último dia) — default do modal "Sinc. Filtros"; a regra de
// negócio é que from/to sempre cobrem meses completos (competência), validada também no backend.
function mesCorrenteCompleto(): { from: string; to: string } {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;
  const ultimo = new Date(ano, mes, 0).getDate();
  const mm = String(mes).padStart(2, "0");
  return { from: `${ano}-${mm}-01`, to: `${ano}-${mm}-${String(ultimo).padStart(2, "0")}` };
}

interface ListaSyncKyria {
  sincronizandoTodos: boolean;
  jobs: JobKyria[];
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const numberFormatter = new Intl.NumberFormat("pt-BR");

function formatTempoAtras(iso: string | null): string {
  if (!iso) return "nunca sincronizada";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora mesmo";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  const diffDias = Math.floor(diffH / 24);
  return `há ${diffDias} dia${diffDias === 1 ? "" : "s"}`;
}

type StatusJob = "rodando" | "ok" | "erro" | "sem execução";

// Status como a tela mostra (a mesma regra do selo da coluna): é o valor que o funil e a ordem da coluna "Status" enxergam.
function statusDoJob(j: JobKyria): StatusJob {
  if (j.emAndamento) return "rodando";
  if (j.ultimoStatus === "success") return "ok";
  if (j.ultimoStatus) return "erro";
  return "sem execução";
}

// Colunas que o funil (Condição e Valores) e a ordem enxergam (18/11/2026, "filtro de colunas" pedido pelo Vitor): a lista é pequena e já vem
// inteira do servidor, então o filtro roda na tela (TabelaLocal), com a mesma regra das demais listas do CaxHub. "Ações" não filtra.
const COLUNAS_LOCAIS: ColunaLocal[] = [
  { nome: "ordemExecucao", tipo: "inteiro", obrigatoria: true },
  { nome: "displayName", tipo: "texto", obrigatoria: true },
  { nome: "ativo", tipo: "booleano", obrigatoria: true },
  { nome: "urlCompleta", tipo: "texto", obrigatoria: true },
  { nome: "totalRegistros", tipo: "inteiro", obrigatoria: true },
  { nome: "ultimaSincronizacao", tipo: "data" },
  { nome: "ultimaDuracaoMs", tipo: "inteiro" },
  { nome: "proximaExecucao", tipo: "data", obrigatoria: true },
  { nome: "status", tipo: "texto", obrigatoria: true },
];

// "status" não é campo do job: é calculado (statusDoJob). O resto lê o campo de mesmo nome.
const lerJob = (j: JobKyria, coluna: string): unknown => (coluna === "status" ? statusDoJob(j) : (j as unknown as Record<string, unknown>)[coluna]);

interface AcoesJob {
  alternarAtivo: (job: JobKyria) => void;
  disparar: (job: JobKyria) => void;
  disparando: string | null;
  sincronizandoTodos: boolean;
}

const TOM_STATUS_JOB: Record<StatusJob, string> = {
  rodando: "bg-warning/15 text-warning",
  ok: "bg-success/15 text-success",
  erro: "bg-destructive/15 text-destructive",
  "sem execução": "bg-muted/15 text-muted",
};
const ROTULO_STATUS_JOB: Record<StatusJob, string> = { rodando: "rodando...", ok: "ok", erro: "erro", "sem execução": "—" };

const COLUNAS_JOBS: DefColuna<JobKyria, AcoesJob>[] = [
  { nome: "ordemExecucao", titulo: "Ordem", direita: true, largura: 70, classe: "font-mono text-sm tabular-nums text-muted", render: (j) => j.ordemExecucao },
  { nome: "displayName", titulo: "Tabela", fixa: true, largura: 200, classe: "text-sm font-semibold text-foreground", texto: (j) => j.displayName, render: (j) => j.displayName },
  {
    nome: "ativo",
    titulo: "Ativa",
    largura: 80,
    formatarValor: (v) => (v === true || v === "true" ? "Sim" : "Não"),
    render: (j, a) => (
      <button
        type="button"
        role="switch"
        aria-checked={j.ativo}
        aria-label={`${j.ativo ? "Desativar" : "Ativar"} ${j.displayName}`}
        onClick={() => a.alternarAtivo(j)}
        className={`relative h-5 w-9 rounded-full transition ${j.ativo ? "bg-success" : "bg-muted/40"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${j.ativo ? "left-[18px]" : "left-0.5"}`} />
      </button>
    ),
  },
  { nome: "urlCompleta", titulo: "URL", largura: 200, classe: "max-w-[130px] truncate font-mono text-[12px] text-muted", title: (j) => j.urlCompleta, texto: (j) => j.urlCompleta, render: (j) => j.urlCompleta },
  { nome: "totalRegistros", titulo: "Registros", direita: true, largura: 100, classe: "font-mono text-sm tabular-nums text-muted", render: (j) => numberFormatter.format(j.totalRegistros) },
  {
    nome: "ultimaSincronizacao",
    titulo: "Última sincronização",
    largura: 260,
    classe: "text-[12.5px] text-muted",
    render: (j) => (
      <>
        {j.ultimaSincronizacao ? dateTimeFormatter.format(new Date(j.ultimaSincronizacao)) : "Nunca"}
        {j.ultimaMensagem && (
          <p className={`mt-0.5 max-w-[190px] truncate text-[11px] ${j.ultimoStatus === "error" ? "text-destructive" : "text-muted"}`} title={j.ultimaMensagem}>
            {j.ultimaMensagem}
          </p>
        )}
      </>
    ),
  },
  {
    nome: "ultimaDuracaoMs",
    titulo: "Duração",
    direita: true,
    largura: 100,
    classe: "font-mono text-[12.5px] tabular-nums text-muted",
    formatarValor: (v) => formatarDuracao(Number(v)),
    render: (j) => (j.ultimaDuracaoMs != null ? formatarDuracao(j.ultimaDuracaoMs) : "—"),
  },
  { nome: "proximaExecucao", titulo: "Próxima execução", largura: 150, classe: "text-[12.5px] text-muted", render: (j) => dateTimeFormatter.format(new Date(j.proximaExecucao)) },
  {
    nome: "status",
    titulo: "Status",
    direita: true,
    largura: 110,
    render: (j) => {
      const st = statusDoJob(j);
      return <span className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${TOM_STATUS_JOB[st]}`}>{ROTULO_STATUS_JOB[st]}</span>;
    },
  },
  {
    nome: "acoes",
    titulo: "Ações",
    direita: true,
    semOrdenar: true,
    largura: 210,
    // Coluna "à direita" herda a fonte de número (mono); os links de ação ficam na fonte normal.
    classe: "font-sans",
    render: (j, a) => (
      <div className="flex justify-end gap-3">
        <Link to={`/admin/sincronizacao-kyria/dados/${j.jobName}`} className="text-sm text-primary hover:underline">
          Ver dados
        </Link>
        <button
          onClick={() => a.disparar(j)}
          disabled={!j.ativo || j.emAndamento || a.disparando !== null || a.sincronizandoTodos}
          className="text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          {a.disparando === j.jobName ? "Iniciando..." : "Sincronizar agora"}
        </button>
      </div>
    ),
  },
];

export function SincronizacaoKyria() {
  const [jobs, setJobs] = useState<JobKyria[]>([]);
  const [sincronizandoTodos, setSincronizandoTodos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState<string | null>(null);
  const [iniciandoTodos, setIniciandoTodos] = useState(false);
  const [filtrosAberto, setFiltrosAberto] = useState(false);
  const [filtroJob, setFiltroJob] = useState("");
  const [filtroFrom, setFiltroFrom] = useState("");
  const [filtroTo, setFiltroTo] = useState("");
  const [filtroErro, setFiltroErro] = useState<string | null>(null);
  const [filtroEnviando, setFiltroEnviando] = useState(false);
  const [confirmacao, setConfirmacao] = useState<{ job: JobKyria; dependentes: DependenteKyria[] } | null>(null);

  function carregar() {
    axios
      .get<ListaSyncKyria>("/api/sync-kyria")
      .then(({ data }) => {
        setJobs(data.jobs);
        setSincronizandoTodos(data.sincronizandoTodos);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar tabelas sincronizadas"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
    const intervalo = setInterval(carregar, 10000);
    return () => clearInterval(intervalo);
  }, []);

  async function disparar(job: JobKyria) {
    setDisparando(job.jobName);
    setErro(null);
    try {
      await axios.post(`/api/sync-kyria/${job.jobName}/run`);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao iniciar sincronização");
    } finally {
      setDisparando(null);
    }
  }

  async function alterarAtivo(job: JobKyria, ativo: boolean, cascata = false) {
    setErro(null);
    try {
      await axios.patch(`/api/sync-kyria/${job.jobName}/ativo`, { ativo, cascata });
      setConfirmacao(null);
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao alterar o estado da tabela");
    }
  }

  // Ao inativar, varre as tabelas ligadas por FK: se houver alguma ainda ativa, pede confirmação
  // antes de inativar tudo junto.
  async function alternarAtivo(job: JobKyria) {
    if (!job.ativo) return alterarAtivo(job, true);
    setErro(null);
    try {
      const { data } = await axios.get<{ dependentes: DependenteKyria[] }>(`/api/sync-kyria/${job.jobName}/dependentes`);
      if (data.dependentes.length === 0) return alterarAtivo(job, false);
      setConfirmacao({ job, dependentes: data.dependentes });
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao verificar tabelas relacionadas");
    }
  }

  function abrirFiltros() {
    const padrao = mesCorrenteCompleto();
    setFiltroJob(jobs.find((j) => j.aceitaFiltros)?.jobName ?? "");
    setFiltroFrom(padrao.from);
    setFiltroTo(padrao.to);
    setFiltroErro(null);
    setFiltrosAberto(true);
  }

  async function sincronizarComFiltros() {
    setFiltroEnviando(true);
    setFiltroErro(null);
    try {
      await axios.post(`/api/sync-kyria/${filtroJob}/run`, { from: filtroFrom, to: filtroTo });
      setFiltrosAberto(false);
      carregar();
    } catch (err: any) {
      setFiltroErro(err.response?.data?.error ?? "Falha ao iniciar sincronização com filtros");
    } finally {
      setFiltroEnviando(false);
    }
  }

  async function dispararTodos() {
    setIniciandoTodos(true);
    setErro(null);
    try {
      await axios.post("/api/sync-kyria/run-all");
      carregar();
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Falha ao iniciar sincronização de todas as tabelas");
    } finally {
      setIniciandoTodos(false);
    }
  }

  const totalTabelas = jobs.length;
  const comErro = jobs.filter((j) => j.ultimoStatus === "error").length;
  const rodandoAgora = jobs.filter((j) => j.emAndamento).length;
  const maisDesatualizada = jobs.reduce<JobKyria | null>((pior, job) => {
    if (!pior) return job;
    const tempoJob = job.ultimaSincronizacao ? new Date(job.ultimaSincronizacao).getTime() : -Infinity;
    const tempoPior = pior.ultimaSincronizacao ? new Date(pior.ultimaSincronizacao).getTime() : -Infinity;
    return tempoJob < tempoPior ? job : pior;
  }, null);

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Integração Kyria
      </p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Integração Kyria</h1>
          <p className="mt-1 text-sm text-muted">
            Cada tabela roda sozinha no horário agendado. API só-leitura do Kyria — sem filtro por campo nem detecção
            de exclusão: um registro inativo lá já chega aqui com <code>status: inactive</code>.
          </p>
        </div>
        <div className="flex flex-none gap-2">
          <button
            onClick={abrirFiltros}
            disabled={sincronizandoTodos || iniciandoTodos || jobs.some((j) => j.emAndamento) || !jobs.some((j) => j.aceitaFiltros)}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sinc. Filtros
          </button>
          <button
            onClick={dispararTodos}
            disabled={sincronizandoTodos || iniciandoTodos || jobs.some((j) => j.emAndamento)}
            className="flex-none rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sincronizandoTodos || iniciandoTodos ? "Sincronizando todas..." : "Sincronizar Todas as Tabelas"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-28" />
              <Skeleton className="h-7 w-14" />
            </div>
          ))}
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">Total de tabelas</p>
            <span className="block font-mono text-2xl font-semibold tabular-nums text-foreground">{totalTabelas}</span>
          </div>
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">Com erro</p>
            <span
              className={`block font-mono text-2xl font-semibold tabular-nums ${comErro > 0 ? "text-destructive" : "text-foreground"}`}
            >
              {comErro}
            </span>
          </div>
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">Sincronizando agora</p>
            <span
              className={`block font-mono text-2xl font-semibold tabular-nums ${rodandoAgora > 0 ? "text-warning" : "text-foreground"}`}
            >
              {rodandoAgora}
            </span>
          </div>
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-[11.5px] text-muted">Mais desatualizada</p>
            <span className="block truncate font-mono text-lg font-semibold tabular-nums text-foreground" title={maisDesatualizada?.displayName}>
              {maisDesatualizada?.displayName ?? "—"}
            </span>
            <p className="mt-1 text-[11px] text-muted">
              {maisDesatualizada ? formatTempoAtras(maisDesatualizada.ultimaSincronizacao) : "—"}
            </p>
          </div>
        </div>
      )}

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <TabelaLocal<JobKyria, AcoesJob>
        chave="admin.sincronizacao-kyria"
        defs={COLUNAS_JOBS}
        colunas={COLUNAS_LOCAIS}
        linhas={jobs}
        ler={lerJob}
        chaveLinha={(j) => j.jobName}
        loading={loading}
        vazio="Nenhuma tabela cadastrada."
        ctx={{ alternarAtivo, disparar, disparando, sincronizandoTodos }}
      />

      <Modal
        open={filtrosAberto}
        onClose={() => setFiltrosAberto(false)}
        title="Sincronizar com filtros"
        subtitulo="Ajuste o período (competência) a importar"
        fecharPorFora={false}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted">Tabela</label>
            <select
              value={filtroJob}
              onChange={(e) => setFiltroJob(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {jobs
                .filter((j) => j.aceitaFiltros)
                .map((j) => (
                  <option key={j.jobName} value={j.jobName}>
                    {j.displayName}
                  </option>
                ))}
            </select>
            <p className="mt-1 truncate font-mono text-[11px] text-muted">
              {jobs.find((j) => j.jobName === filtroJob)?.urlCompleta}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted">from (dia 01 do mês)</label>
              <input
                type="date"
                value={filtroFrom}
                onChange={(e) => setFiltroFrom(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted">to (último dia do mês)</label>
              <input
                type="date"
                value={filtroTo}
                onChange={(e) => setFiltroTo(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <p className="text-[12px] text-muted">
            O período sempre cobre meses completos. Se abranger mais de um mês, cada mês é importado como uma
            competência separada. Sem filtro, o job automático usa a data da última sincronização.
          </p>
          {filtroErro && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {filtroErro}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setFiltrosAberto(false)}
              className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              onClick={sincronizarComFiltros}
              disabled={filtroEnviando || !filtroJob || !filtroFrom || !filtroTo}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {filtroEnviando ? "Iniciando..." : "Sincronizar"}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={confirmacao !== null}
        onClose={() => setConfirmacao(null)}
        title="Inativar tabelas relacionadas?"
        subtitulo={confirmacao?.job.displayName}
        fecharPorFora={false}
      >
        {confirmacao && (
          <div>
            <p className="text-sm text-foreground">
              As tabelas abaixo têm chave estrangeira (FK) ligada a <strong>{confirmacao.job.displayName}</strong>. Se
              você confirmar, todas serão inativadas junto e deixam de importar, manualmente e pelos jobs.
            </p>
            <ul className="my-4 divide-y divide-border/60 rounded-md border border-border">
              {confirmacao.dependentes.map((d) => (
                <li key={d.jobName} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="font-semibold text-foreground">{d.displayName}</span>
                  <span className="font-mono text-[12px] text-muted">{d.tabelaLocal}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmacao(null)}
                className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                onClick={() => alterarAtivo(confirmacao.job, false, true)}
                className="rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Inativar todas
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
