import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { SeletorStatus, filtroAcoesValido } from "../../components/eficiencia/AbaAcoes";
import { Chip, Indicador, Vazio } from "../../components/eficiencia/comum";
import { AcaoDto, AcoesResposta, FiltroAcoes, StatusAcao, prazoBr } from "../../lib/eficiencia";

const FILTROS: { chave: FiltroAcoes; rotulo: string }[] = [
  { chave: "abertas", rotulo: "Em aberto" },
  { chave: "atrasadas", rotulo: "Atrasadas" },
  { chave: "concluidas", rotulo: "Concluídas" },
  { chave: "todas", rotulo: "Todas" },
];

// As ações do Plano de ação em que a pessoa é a RESPONSÁVEL. Aberta a qualquer consultor (não só gestor): quem foi
// indicado como responsável não entra no Painel de Eficiência, mas precisa ver e concluir o que combinaram com ele.
export function MinhasAcoes() {
  const { mostrar } = useToast();
  const [params, setParams] = useSearchParams();
  const filtro = filtroAcoesValido(params.get("filtro"));
  const [dados, setDados] = useState<AcoesResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [mudando, setMudando] = useState<number | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    axios
      .get<AcoesResposta>("/api/eficiencia/acoes/minhas", { params: { filtro: "todas" } })
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível carregar suas ações." : "Não foi possível carregar suas ações."));
    return () => {
      cancelado = true;
    };
  }, [recarga]);

  const visiveis = useMemo(
    () => (dados?.acoes ?? []).filter((a) => (filtro === "abertas" ? a.status !== "concluida" : filtro === "atrasadas" ? a.atrasada : filtro === "concluidas" ? a.status === "concluida" : true)),
    [dados, filtro]
  );

  const escolherFiltro = useCallback(
    (f: FiltroAcoes) =>
      setParams((p) => {
        const novo = new URLSearchParams(p);
        if (f === "abertas") novo.delete("filtro");
        else novo.set("filtro", f);
        return novo;
      }),
    [setParams]
  );

  async function mudarStatus(a: AcaoDto, status: StatusAcao) {
    setMudando(a.id);
    try {
      await axios.patch(`/api/eficiencia/acoes/${a.id}/status`, { status });
      setRecarga((n) => n + 1);
    } catch (e) {
      mostrar(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível mudar o status." : "Não foi possível mudar o status.", "destructive");
    } finally {
      setMudando(null);
    }
  }

  const c = dados?.contagens;
  const contagem = (f: FiltroAcoes) => (c ? { abertas: c.abertas, atrasadas: c.atrasadas, concluidas: c.concluidas, todas: c.todas }[f] : 0);

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Minhas ações</p>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Minhas ações</h1>
        <p className="mt-1 text-sm text-muted">O que o seu gestor combinou com você a partir do painel de eficiência. Atualize o status conforme avançar.</p>
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>}

      {!dados && !erro && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {dados && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Indicador rotulo="Em aberto" valor={c!.abertas} sub="abertas ou em andamento" />
            <Indicador rotulo="Atrasadas" valor={c!.atrasadas} sub="prazo vencido" tom={c!.atrasadas ? "bad" : "ok"} onClick={() => escolherFiltro("atrasadas")} />
            <Indicador rotulo="Concluídas" valor={c!.concluidas} sub="no total" />
          </div>

          <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-0.5" role="group" aria-label="Filtrar ações">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                type="button"
                aria-pressed={filtro === f.chave}
                onClick={() => escolherFiltro(f.chave)}
                className={`rounded px-2.5 py-1 text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filtro === f.chave ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
              >
                {f.rotulo} <b className={`ml-1 font-mono text-[11px] ${filtro === f.chave ? "text-primary" : "text-muted"}`}>{contagem(f.chave)}</b>
              </button>
            ))}
          </div>

          {visiveis.length === 0 ? (
            <Vazio>{c!.todas === 0 ? "Você não tem nenhuma ação do plano de eficiência." : "Nenhuma ação neste filtro."}</Vazio>
          ) : (
            <ul className="space-y-3">
              {visiveis.map((a) => (
                <li key={a.id} className={`rounded-lg border bg-surface p-4 ${a.atrasada ? "border-destructive/40" : "border-border"} ${a.status === "concluida" ? "opacity-70" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{a.titulo}</p>
                      {a.observacao && <p className="mt-1 text-[13px] text-muted">{a.observacao}</p>}
                      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
                        {a.codpro != null && (
                          <span>
                            PS {a.codpro}
                            {a.cliente ? ` · ${a.cliente}` : ""}
                          </span>
                        )}
                        {a.alvoNome && <span>Sobre {a.alvoNome}</span>}
                        <span>Pedida por {a.criadoPorNome}</span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <SeletorStatus acao={a} ocupado={mudando === a.id} onMudar={(s) => mudarStatus(a, s)} />
                      <span className={`font-mono text-[12.5px] tabular-nums ${a.atrasada ? "font-semibold text-destructive" : "text-foreground"}`}>
                        Prazo {prazoBr(a.prazo)}
                      </span>
                      {a.atrasada && <Chip tom="bad">Atrasada</Chip>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
