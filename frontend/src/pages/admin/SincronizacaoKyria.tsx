import axios from "axios";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  totalRegistros: number;
  ultimaSincronizacao: string | null;
  ultimoStatus: string | null;
  ultimaMensagem: string | null;
  ultimaDuracaoMs: number | null;
  proximaExecucao: string;
  emAndamento: boolean;
}

interface ListaSyncKyria {
  sincronizandoTodos: boolean;
  jobs: JobKyria[];
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const numberFormatter = new Intl.NumberFormat("pt-BR");

const statusTone: Record<string, string> = {
  success: "bg-success/15 text-success",
  error: "bg-destructive/15 text-destructive",
};

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

export function SincronizacaoKyria() {
  const [jobs, setJobs] = useState<JobKyria[]>([]);
  const [sincronizandoTodos, setSincronizandoTodos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState<string | null>(null);
  const [iniciandoTodos, setIniciandoTodos] = useState(false);

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
        <button
          onClick={dispararTodos}
          disabled={sincronizandoTodos || iniciandoTodos || jobs.some((j) => j.emAndamento)}
          className="flex-none rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sincronizandoTodos || iniciandoTodos ? "Sincronizando todas..." : "Sincronizar Todas as Tabelas"}
        </button>
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

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Ordem
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Tabela
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  URL
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Registros
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Última sincronização
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Duração
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Próxima execução
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="bg-surface-2 px-2.5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 2 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-6" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-48" />
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-16" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-12" />
                    </td>
                    <td className="px-2.5 py-3.5">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-5 w-12 rounded" />
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-24" />
                    </td>
                  </tr>
                ))}
              {!loading &&
                jobs.map((job) => (
                  <tr key={job.jobName} className="border-t border-border/60">
                    <td className="px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                      {job.ordemExecucao}
                    </td>
                    <td className="px-2.5 py-3.5 text-sm font-semibold text-foreground">{job.displayName}</td>
                    <td className="max-w-[220px] truncate px-2.5 py-3.5 font-mono text-[12px] text-muted" title={job.urlCompleta}>
                      {job.urlCompleta}
                    </td>
                    <td className="px-2.5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                      {numberFormatter.format(job.totalRegistros)}
                    </td>
                    <td className="px-2.5 py-3.5 text-[12.5px] text-muted">
                      {job.ultimaSincronizacao ? dateTimeFormatter.format(new Date(job.ultimaSincronizacao)) : "Nunca"}
                      {job.ultimaMensagem && (
                        <p
                          className={`mt-0.5 max-w-[280px] truncate text-[11px] ${
                            job.ultimoStatus === "error" ? "text-destructive" : "text-muted"
                          }`}
                          title={job.ultimaMensagem}
                        >
                          {job.ultimaMensagem}
                        </p>
                      )}
                    </td>
                    <td className="px-2.5 py-3.5 text-right font-mono text-[12.5px] tabular-nums text-muted">
                      {job.ultimaDuracaoMs != null ? formatarDuracao(job.ultimaDuracaoMs) : "—"}
                    </td>
                    <td className="px-2.5 py-3.5 text-[12.5px] text-muted">
                      {dateTimeFormatter.format(new Date(job.proximaExecucao))}
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      {job.emAndamento ? (
                        <span className="inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide bg-warning/15 text-warning">
                          rodando...
                        </span>
                      ) : job.ultimoStatus ? (
                        <span
                          className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${
                            statusTone[job.ultimoStatus] ?? statusTone.success
                          }`}
                        >
                          {job.ultimoStatus === "success" ? "ok" : "erro"}
                        </span>
                      ) : (
                        <span className="inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide bg-muted/15 text-muted">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-3.5 text-right">
                      <div className="flex justify-end gap-3">
                        <Link to={`/admin/sincronizacao-kyria/dados/${job.jobName}`} className="text-sm text-primary hover:underline">
                          Ver dados
                        </Link>
                        <button
                          onClick={() => disparar(job)}
                          disabled={job.emAndamento || disparando !== null || sincronizandoTodos}
                          className="text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {disparando === job.jobName ? "Iniciando..." : "Sincronizar agora"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
