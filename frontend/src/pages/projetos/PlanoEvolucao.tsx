import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Skeleton } from "../../components/ui/Skeleton";
import { TabDef, Tabs } from "../../components/ui/Tabs";
import { Apuracao } from "../../components/planoEvolucao/Apuracao";
import { CiclosParametros } from "../../components/planoEvolucao/CiclosParametros";
import { ComoCalculamosPlano } from "../../components/planoEvolucao/ComoCalculamosPlano";
import { Participantes } from "../../components/planoEvolucao/Participantes";
import { PreviaCiclo } from "../../components/planoEvolucao/PreviaCiclo";
import { CiclosResposta, ParticipantesResposta, PreviaResposta, rotuloStatusCiclo } from "../../lib/planoEvolucao";

const ABAS: TabDef[] = [
  { key: "previa", label: "Ciclo atual" },
  { key: "apuracao", label: "Apuração" },
  { key: "ciclos", label: "Ciclos e parâmetros" },
  { key: "participantes", label: "Participantes" },
  { key: "regras", label: "Como calculamos" },
];

const mensagemDe = (e: unknown, padrao: string) => (axios.isAxiosError(e) ? e.response?.data?.error ?? padrao : padrao);

// Plano de Evolução Profissional e Eficiência dos consultores PJ (Gestão de Projetos › Eficiência › Plano de evolução).
// Admin: tudo. Gestor: lê o time dele, lança e apura o time dele, sempre sem valores em R$. Apuração: lançamentos, memória de cálculo, devolutiva, contestação e encerramento.
export function PlanoEvolucao() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const [params, setParams] = useSearchParams();
  const aba = ABAS.some((a) => a.key === params.get("aba")) ? (params.get("aba") as string) : "previa";
  const mudarAba = useCallback(
    (key: string) =>
      setParams((p) => {
        const novo = new URLSearchParams(p);
        if (key === "previa") novo.delete("aba");
        else novo.set("aba", key);
        return novo;
      }),
    [setParams]
  );

  const [ciclos, setCiclos] = useState<CiclosResposta | null>(null);
  const [cicloId, setCicloId] = useState<number | null>(null);
  const [participantes, setParticipantes] = useState<ParticipantesResposta | null>(null);
  const [previa, setPrevia] = useState<PreviaResposta | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const recarregar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    Promise.all([axios.get<CiclosResposta>("/api/plano-evolucao/ciclos"), axios.get<ParticipantesResposta>("/api/plano-evolucao/participantes")])
      .then(([c, p]) => {
        if (cancelado) return;
        setCiclos(c.data);
        setParticipantes(p.data);
        setCicloId((atual) => (atual != null && c.data.ciclos.some((x) => x.id === atual) ? atual : c.data.atualId ?? c.data.ciclos[0]?.id ?? null));
      })
      .catch((e) => {
        if (cancelado) return;
        if (axios.isAxiosError(e) && e.response?.status === 403) setSemAcesso(true);
        else setErro(mensagemDe(e, "Não foi possível carregar o plano de evolução."));
      });
    return () => {
      cancelado = true;
    };
  }, [recarga]);

  useEffect(() => {
    if (cicloId == null) {
      setPrevia(null);
      return;
    }
    let cancelado = false;
    setCarregandoPrevia(true);
    axios
      .get<PreviaResposta>(`/api/plano-evolucao/ciclos/${cicloId}/previa`)
      .then(({ data }) => !cancelado && setPrevia(data))
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível calcular a prévia do ciclo.")))
      .finally(() => !cancelado && setCarregandoPrevia(false));
    return () => {
      cancelado = true;
    };
  }, [cicloId, recarga]);

  if (semAcesso) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Plano de Evolução</h1>
        <p className="mt-3 rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">Esta tela é do administrador e dos gestores de departamento.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Eficiência · Plano de evolução</p>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Plano de Evolução Profissional e Eficiência</h1>
          <p className="mt-1 text-sm text-muted">Mérito dos consultores PJ por ciclo semestral: eficiência pelo item da proposta, apontamento online e valor hora projetado.</p>
        </div>
        <Link to="/projetos/eficiencia" className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          ← Painel de Eficiência
        </Link>
      </div>

      <Tabs tabs={ABAS} activeKey={aba} onChange={mudarAba} />

      {erro && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>}
      {!ciclos && !erro && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {ciclos && participantes && (
        <>
          {aba === "previa" && (
            <div className="space-y-5">
              {ciclos.ciclos.length === 0 ? (
                <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
                  Ainda não há ciclo.{" "}
                  {admin ? (
                    <button type="button" onClick={() => mudarAba("ciclos")} className="font-medium text-primary hover:underline">
                      Crie o primeiro na aba Ciclos e parâmetros.
                    </button>
                  ) : (
                    "O administrador precisa criar o primeiro ciclo."
                  )}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor="ciclo-previa" className="text-[12.5px] text-muted">Ciclo</label>
                    <select
                      id="ciclo-previa"
                      value={cicloId ?? ""}
                      onChange={(e) => setCicloId(Number(e.target.value))}
                      className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {ciclos.ciclos.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.rotulo} · {rotuloStatusCiclo[c.status]}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={recarregar} disabled={carregandoPrevia} className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50">
                      {carregandoPrevia ? "Calculando…" : "Atualizar"}
                    </button>
                  </div>
                  {!previa && carregandoPrevia && <Skeleton className="h-72 w-full" />}
                  {previa && (
                    <div className={carregandoPrevia ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"} aria-busy={carregandoPrevia}>
                      <PreviaCiclo previa={previa} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {aba === "apuracao" && <Apuracao ciclos={ciclos.ciclos} cicloId={cicloId} onSelecionar={setCicloId} admin={admin} />}
          {aba === "ciclos" && <CiclosParametros dados={ciclos} podeEditar={admin} selecionadoId={cicloId} onSelecionar={setCicloId} onMudou={recarregar} />}
          {aba === "participantes" && <Participantes dados={participantes} podeEditar={admin} motivosValorBase={ciclos.motivosValorBase} onMudou={recarregar} />}
          {aba === "regras" && <ComoCalculamosPlano />}
        </>
      )}
    </div>
  );
}
