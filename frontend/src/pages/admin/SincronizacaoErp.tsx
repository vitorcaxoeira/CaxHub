import axios from "axios";
import { useEffect, useState } from "react";

interface JobSync {
  jobName: string;
  displayName: string;
  ordemExecucao: number;
  totalRegistros: number;
  suportaAlterados: boolean;
  ultimaSincronizacao: string | null;
  ultimoStatus: string | null;
  ultimoErro: string | null;
  proximaExecucao: string;
  emAndamento: boolean;
}

interface ListaSyncErp {
  sincronizandoTodos: boolean;
  jobs: JobSync[];
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

export function SincronizacaoErp() {
  const [jobs, setJobs] = useState<JobSync[]>([]);
  const [sincronizandoTodos, setSincronizandoTodos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState<string | null>(null);
  const [iniciandoTodos, setIniciandoTodos] = useState(false);

  function carregar() {
    axios
      .get<ListaSyncErp>("/api/sync-erp")
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
    // Atualiza sozinho a cada 10s pra refletir "em andamento" -> concluído sem precisar
    // que o usuário recarregue a página manualmente.
    const intervalo = setInterval(carregar, 10000);
    return () => clearInterval(intervalo);
  }, []);

  async function disparar(job: JobSync, modo: "todos" | "alterados") {
    setDisparando(`${job.jobName}-${modo}`);
    setErro(null);
    try {
      await axios.post(`/api/sync-erp/${job.jobName}/run`, { modo });
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
      await axios.post("/api/sync-erp/run-all");
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
  const maisDesatualizada = jobs.reduce<JobSync | null>((pior, job) => {
    if (!pior) return job;
    const tempoJob = job.ultimaSincronizacao ? new Date(job.ultimaSincronizacao).getTime() : -Infinity;
    const tempoPior = pior.ultimaSincronizacao ? new Date(pior.ultimaSincronizacao).getTime() : -Infinity;
    return tempoJob < tempoPior ? job : pior;
  }, null);

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Importados do Senior
      </p>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Importados do Senior</h1>
          <p className="mt-1 text-sm text-muted">
            Cada tabela roda sozinha no horário agendado. "Alterados" filtra pela data de geração/alteração do registro
            desde a última sincronização com sucesso — só aparece pra tabelas que têm esse campo no Senior.
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

      {!loading && jobs.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
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
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Ordem
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Tabela
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Registros
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Última sincronização
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Próxima execução
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.jobName} className="border-t border-border/60 transition hover:bg-surface-2">
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">{job.ordemExecucao}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground">{job.displayName}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                    {numberFormatter.format(job.totalRegistros)}
                  </td>
                  <td className="px-5 py-3.5 text-[12.5px] text-muted">
                    {job.ultimaSincronizacao ? dateTimeFormatter.format(new Date(job.ultimaSincronizacao)) : "Nunca"}
                    {job.ultimoErro && (
                      <p className="mt-0.5 max-w-[240px] truncate text-[11px] text-destructive" title={job.ultimoErro}>
                        {job.ultimoErro}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-[12.5px] text-muted">
                    {dateTimeFormatter.format(new Date(job.proximaExecucao))}
                  </td>
                  <td className="px-5 py-3.5 text-right">
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
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => disparar(job, "todos")}
                        disabled={job.emAndamento || disparando !== null || sincronizandoTodos}
                        className="text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {disparando === `${job.jobName}-todos` ? "Iniciando..." : "Sincronizar Todos"}
                      </button>
                      <button
                        onClick={() => disparar(job, "alterados")}
                        disabled={!job.suportaAlterados || job.emAndamento || disparando !== null || sincronizandoTodos}
                        title={!job.suportaAlterados ? "Essa tabela não tem campo de data de geração/alteração no Senior" : undefined}
                        className="text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {disparando === `${job.jobName}-alterados` ? "Iniciando..." : "Sincronizar Alterados"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                    Nenhuma tabela cadastrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
