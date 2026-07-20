import axios from "axios";
import { useEffect, useState } from "react";
import { AtividadeKanban, ColunaKanban, DetalheInfo, KanbanBoard } from "../../components/projetos/KanbanBoard";
import { AtividadesTable } from "../../components/projetos/AtividadesTable";
import { IndicadoresProjetos, IndicadoresProjetosData } from "../../components/projetos/IndicadoresProjetos";
import { AtividadeDetalhe } from "../../components/projetos/AtividadeDetalhe";
import { CalendarioAtividades } from "../../components/projetos/CalendarioAtividades";
import { TimelineAtividades } from "../../components/projetos/TimelineAtividades";
import { WorkloadConsultores } from "../../components/projetos/WorkloadConsultores";

type Visao = "quadro" | "lista" | "calendario" | "timeline" | "workload";

interface DetalheSelecionado extends DetalheInfo {
  id: number;
}

export function Atividades() {
  const [visao, setVisao] = useState<Visao>("quadro");
  const [colunas, setColunas] = useState<ColunaKanban[]>([]);
  const [atividades, setAtividades] = useState<AtividadeKanban[]>([]);
  const [indicadores, setIndicadores] = useState<IndicadoresProjetosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheSelecionado | null>(null);

  function carregar() {
    setLoading(true);
    Promise.all([axios.get("/api/atividades/quadro-colunas"), axios.get("/api/atividades")])
      .then(([colunasRes, atividadesRes]) => {
        setColunas(colunasRes.data.colunas);
        setAtividades(atividadesRes.data.rows);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar atividades"))
      .finally(() => setLoading(false));
  }

  function carregarIndicadores() {
    axios.get("/api/atividades/indicadores").then(({ data }) => setIndicadores(data));
  }

  useEffect(() => {
    carregarIndicadores();
  }, []);

  useEffect(() => {
    if (visao !== "lista") carregar();
  }, [visao]);

  async function moverAtividade(atividadeId: number, novaColunaId: number) {
    const anterior = atividades;
    setAtividades((atual) => atual.map((a) => (a.id === atividadeId ? { ...a, colunaId: novaColunaId } : a)));
    try {
      await axios.patch(`/api/atividades/${atividadeId}/mover`, { colunaId: novaColunaId });
      carregarIndicadores();
    } catch (err: any) {
      setAtividades(anterior);
      setErro(err.response?.data?.error ?? "Falha ao mover atividade");
    }
  }

  function abrirDetalhe(atividadeId: number, info: DetalheInfo) {
    setDetalhe({ id: atividadeId, ...info });
  }

  const tabClass = (ativa: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      ativa ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Atividades
      </p>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-foreground">Atividades</h1>
        <div className="flex flex-wrap gap-2 rounded-md border border-border p-1">
          <button onClick={() => setVisao("quadro")} className={tabClass(visao === "quadro")}>
            Quadro
          </button>
          <button onClick={() => setVisao("lista")} className={tabClass(visao === "lista")}>
            Lista
          </button>
          <button onClick={() => setVisao("calendario")} className={tabClass(visao === "calendario")}>
            Calendário
          </button>
          <button onClick={() => setVisao("timeline")} className={tabClass(visao === "timeline")}>
            Timeline
          </button>
          <button onClick={() => setVisao("workload")} className={tabClass(visao === "workload")}>
            Workload
          </button>
        </div>
      </div>

      {indicadores && <IndicadoresProjetos dados={indicadores} />}

      {erro && visao !== "lista" && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {visao === "lista" ? (
        <AtividadesTable onMovido={carregarIndicadores} onAbrirDetalhe={abrirDetalhe} />
      ) : loading ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : visao === "quadro" ? (
        <KanbanBoard colunas={colunas} atividades={atividades} onMover={moverAtividade} onAbrirDetalhe={abrirDetalhe} />
      ) : visao === "calendario" ? (
        <CalendarioAtividades atividades={atividades} onAbrirDetalhe={abrirDetalhe} />
      ) : visao === "timeline" ? (
        <TimelineAtividades atividades={atividades} onAbrirDetalhe={abrirDetalhe} />
      ) : (
        <WorkloadConsultores itens={indicadores?.porConsultor ?? []} />
      )}

      {detalhe && (
        <AtividadeDetalhe
          atividadeId={detalhe.id}
          titulo={detalhe.titulo}
          podeEditar={detalhe.podeEditar}
          dataPrevistaInicio={detalhe.dataPrevistaInicio}
          dataPrevistaFim={detalhe.dataPrevistaFim}
          onClose={() => setDetalhe(null)}
        />
      )}
    </div>
  );
}
