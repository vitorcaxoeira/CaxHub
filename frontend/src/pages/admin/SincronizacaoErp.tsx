import axios from "axios";
import { Fragment, useEffect, useState } from "react";
import { Skeleton } from "../../components/ui/Skeleton";

interface JobSync {
  jobName: string;
  displayName: string;
  ordemExecucao: number;
  totalRegistros: number;
  suportaAlterados: boolean;
  ultimaSincronizacao: string | null;
  ultimoStatus: string | null;
  // Mensagem da última execução — hoje carrega tanto o erro (quando ultimoStatus é
  // "error") quanto o resumo da varredura de removidos (quando é "success"). Quem decide
  // a cor é o status, não a presença da mensagem.
  ultimaMensagem: string | null;
  // null = tabela ainda sem detecção de exclusão no Senior (a maioria hoje).
  totalRemovidos: number | null;
  // Resultado da última VARREDURA, que pode ser bem mais antiga que a última
  // sincronização: o modo "Alterados" nunca varre. `detectados` é o que ela achou — em
  // modo "simular" isso é > 0 enquanto totalRemovidos continua 0, porque nada foi gravado.
  ultimaVarredura: { modo: string; detectados: number; em: string } | null;
  temDeteccao: boolean;
  proximaExecucao: string;
  emAndamento: boolean;
}

interface ItemRemovido {
  chave: string;
  rotulo: string;
  removidoEmSenior: string | null;
  marcado: boolean;
}

const modoTone: Record<string, string> = {
  marcar: "bg-destructive/15 text-destructive",
  simular: "bg-warning/15 text-warning",
  desligada: "bg-muted/15 text-muted",
};

const modoRotulo: Record<string, string> = {
  marcar: "marcando",
  simular: "simulando",
  desligada: "desligada",
};

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

// Quanto a varredura pode ficar atrás da sincronização antes de virar alerta. Uma tabela
// que só roda no modo "Alterados" nunca é varrida — o cron completo é diário, então mais
// de 3 dias de defasagem indica que só o incremental vem rodando.
const DIAS_VARREDURA_DEFASADA = 3;

function varreduraDefasada(job: JobSync): boolean {
  if (!job.temDeteccao || !job.ultimaSincronizacao) return false;
  if (!job.ultimaVarredura) return true; // tem detecção e nunca varreu
  const atraso = new Date(job.ultimaSincronizacao).getTime() - new Date(job.ultimaVarredura.em).getTime();
  return atraso > DIAS_VARREDURA_DEFASADA * 24 * 60 * 60 * 1000;
}

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
  // Amostra dos removidos por tabela, carregada sob demanda ao expandir a linha — não
  // entra no polling de 10s porque é dado de conferência, não de acompanhamento.
  const [expandido, setExpandido] = useState<string | null>(null);
  const [removidosPorJob, setRemovidosPorJob] = useState<Record<string, ItemRemovido[] | "carregando" | "erro">>({});

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

  function alternarRemovidos(job: JobSync) {
    if (expandido === job.jobName) {
      setExpandido(null);
      return;
    }
    setExpandido(job.jobName);
    if (removidosPorJob[job.jobName]) return;
    setRemovidosPorJob((r) => ({ ...r, [job.jobName]: "carregando" }));
    axios
      .get<{ itens: ItemRemovido[] }>(`/api/sync-erp/${job.jobName}/removidos`)
      .then(({ data }) => setRemovidosPorJob((r) => ({ ...r, [job.jobName]: data.itens })))
      .catch(() => setRemovidosPorJob((r) => ({ ...r, [job.jobName]: "erro" })));
  }

  const totalTabelas = jobs.length;
  const comErro = jobs.filter((j) => j.ultimoStatus === "error").length;
  const totalRemovidos = jobs.reduce((soma, j) => soma + (j.totalRemovidos ?? 0), 0);
  const tabelasComDeteccao = jobs.filter((j) => j.totalRemovidos !== null).length;
  // Detectados que ainda não foram marcados, porque a varredura daquela tabela está só
  // simulando. É o número que interessa durante a fase de observação.
  const totalSimulados = jobs.reduce(
    (soma, j) => soma + (j.ultimaVarredura?.modo === "simular" ? j.ultimaVarredura.detectados : 0),
    0
  );
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

      {loading && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-28" />
              <Skeleton className="h-7 w-14" />
            </div>
          ))}
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
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
            <p className="mb-2 text-[11.5px] text-muted">Sumidos no Senior</p>
            <span
              className={`block font-mono text-2xl font-semibold tabular-nums ${
                totalRemovidos > 0 || totalSimulados > 0 ? "text-warning" : "text-foreground"
              }`}
            >
              {numberFormatter.format(totalRemovidos)}
              {totalSimulados > 0 && (
                <span className="ml-1.5 font-sans text-sm font-medium text-muted">
                  +{numberFormatter.format(totalSimulados)} simulado{totalSimulados === 1 ? "" : "s"}
                </span>
              )}
            </span>
            <p className="mt-1 text-[11px] text-muted">
              {tabelasComDeteccao === 0
                ? "detecção ainda não ligada"
                : `em ${tabelasComDeteccao} tabela${tabelasComDeteccao === 1 ? "" : "s"} com detecção`}
            </p>
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
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Sumidos
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
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-6" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-16" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-10" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-5 w-12 rounded" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-32" />
                    </td>
                  </tr>
                ))}
              {!loading &&
                jobs.map((job) => (
                <Fragment key={job.jobName}>
                <tr className="border-t border-border/60 transition hover:bg-surface-2">
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">{job.ordemExecucao}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground">
                    <span className="flex items-center gap-2">
                      {job.displayName}
                      {job.ultimaVarredura && (
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-wide ${
                            modoTone[job.ultimaVarredura.modo] ?? modoTone.desligada
                          }`}
                          title={`${
                            job.ultimaVarredura.modo === "marcar"
                              ? "Registros que sumirem do Senior são marcados como removidos"
                              : "Varredura só conta os que sumiram, sem marcar nada"
                          } — última varredura em ${dateTimeFormatter.format(new Date(job.ultimaVarredura.em))}`}
                        >
                          {modoRotulo[job.ultimaVarredura.modo] ?? job.ultimaVarredura.modo}
                        </span>
                      )}
                      {varreduraDefasada(job) && (
                        <span
                          className="inline-block rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-wide text-warning"
                          title={
                            job.ultimaVarredura
                              ? `Sincronizada em ${dateTimeFormatter.format(new Date(job.ultimaSincronizacao as string))}, mas varrida pela última vez em ${dateTimeFormatter.format(new Date(job.ultimaVarredura.em))}. O modo "Alterados" não varre — rode "Sincronizar Todos" pra detectar exclusões.`
                              : 'Esta tabela tem detecção configurada mas nunca foi varrida. O modo "Alterados" não varre — rode "Sincronizar Todos".'
                          }
                        >
                          varredura atrasada
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                    {numberFormatter.format(job.totalRegistros)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {(() => {
                      // Detectados pela última varredura mas ainda não gravados — só
                      // acontece em modo "simular". É o número que a fase de observação
                      // precisa ver; sem ele a coluna fica zerada justamente quando importa.
                      const simulados =
                        job.ultimaVarredura?.modo === "simular" ? job.ultimaVarredura.detectados : 0;

                      // Tabela ainda sem detecção — "—" em vez de 0, que daria a impressão
                      // errada de "conferido, nada sumiu".
                      if (job.totalRemovidos === null) {
                        return (
                          <span className="font-mono text-sm text-muted" title="Detecção de exclusão ainda não ligada nesta tabela">
                            —
                          </span>
                        );
                      }
                      if (job.totalRemovidos === 0 && simulados === 0) {
                        return <span className="font-mono text-sm tabular-nums text-muted">0</span>;
                      }
                      return (
                        <button
                          onClick={() => alternarRemovidos(job)}
                          className="font-mono text-sm font-semibold tabular-nums text-warning hover:underline"
                          title="Ver quais registros sumiram do Senior"
                        >
                          {numberFormatter.format(job.totalRemovidos)}
                          {simulados > 0 && (
                            <span className="ml-1 font-sans text-[11px] font-medium text-muted">
                              (+{numberFormatter.format(simulados)} simulado{simulados === 1 ? "" : "s"})
                            </span>
                          )}
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-5 py-3.5 text-[12.5px] text-muted">
                    {job.ultimaSincronizacao ? dateTimeFormatter.format(new Date(job.ultimaSincronizacao)) : "Nunca"}
                    {job.ultimaMensagem && (
                      <p
                        className={`mt-0.5 max-w-[240px] truncate text-[11px] ${
                          job.ultimoStatus === "error" ? "text-destructive" : "text-muted"
                        }`}
                        title={job.ultimaMensagem}
                      >
                        {job.ultimaMensagem}
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
                {expandido === job.jobName && (
                  <tr className="border-t border-border/60 bg-surface-2/40">
                    <td colSpan={8} className="px-5 py-3">
                      <p className="mb-2 text-[11.5px] text-muted">
                        Registros que não vieram mais na consulta ao Senior. Confira alguns direto no ERP: se eles
                        realmente não existem mais lá, a detecção está correta.
                      </p>
                      {removidosPorJob[job.jobName] === "carregando" && (
                        <p className="py-2 text-sm text-muted">Carregando...</p>
                      )}
                      {removidosPorJob[job.jobName] === "erro" && (
                        <p className="py-2 text-sm text-destructive">Falha ao carregar os registros removidos.</p>
                      )}
                      {Array.isArray(removidosPorJob[job.jobName]) && (
                        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                          {(removidosPorJob[job.jobName] as ItemRemovido[]).map((item) => (
                            <li key={item.chave} className="flex items-baseline gap-2 text-[12.5px]">
                              <span className="font-mono font-semibold text-foreground">{item.chave}</span>
                              <span className="truncate text-muted" title={item.rotulo}>
                                {item.rotulo}
                              </span>
                              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                                {item.marcado && item.removidoEmSenior
                                  ? dateTimeFormatter.format(new Date(item.removidoEmSenior))
                                  : "candidato"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {!loading && jobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted">
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
