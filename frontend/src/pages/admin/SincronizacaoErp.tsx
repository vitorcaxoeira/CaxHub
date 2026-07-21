import axios from "axios";
import { useEffect, useState } from "react";

interface JobSync {
  jobName: string;
  displayName: string;
  suportaAlterados: boolean;
  ultimaSincronizacao: string | null;
  ultimoStatus: string | null;
  ultimoErro: string | null;
  proximaExecucao: string;
  emAndamento: boolean;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const statusTone: Record<string, string> = {
  success: "bg-success/15 text-success",
  error: "bg-destructive/15 text-destructive",
};

export function SincronizacaoErp() {
  const [jobs, setJobs] = useState<JobSync[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState<string | null>(null);

  function carregar() {
    axios
      .get("/api/sync-erp")
      .then(({ data }) => {
        setJobs(data.jobs);
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

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Administração · Sincronização ERP
      </p>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Tabelas sincronizadas do Senior</h1>
        <p className="mt-1 text-sm text-muted">
          Cada tabela roda sozinha no horário agendado. "Alterados" filtra pela data de geração/alteração do registro
          desde a última sincronização com sucesso — só aparece pra tabelas que têm esse campo no Senior.
        </p>
      </div>

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
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Tabela
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
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground">{job.displayName}</td>
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
                        disabled={job.emAndamento || disparando !== null}
                        className="text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {disparando === `${job.jobName}-todos` ? "Iniciando..." : "Sincronizar Todos"}
                      </button>
                      <button
                        onClick={() => disparar(job, "alterados")}
                        disabled={!job.suportaAlterados || job.emAndamento || disparando !== null}
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
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
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
