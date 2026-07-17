import axios from "axios";
import { useEffect, useState } from "react";
import { AtividadeKanban, ColunaKanban, KanbanBoard } from "../../components/projetos/KanbanBoard";

export function Atividades() {
  const [colunas, setColunas] = useState<ColunaKanban[]>([]);
  const [atividades, setAtividades] = useState<AtividadeKanban[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

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

  useEffect(() => {
    carregar();
  }, []);

  async function moverAtividade(atividadeId: number, novaColunaId: number) {
    const anterior = atividades;
    setAtividades((atual) => atual.map((a) => (a.id === atividadeId ? { ...a, colunaId: novaColunaId } : a)));
    try {
      await axios.patch(`/api/atividades/${atividadeId}/mover`, { colunaId: novaColunaId });
    } catch (err: any) {
      setAtividades(anterior);
      setErro(err.response?.data?.error ?? "Falha ao mover atividade");
    }
  }

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Atividades
      </p>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-foreground">Quadro de Atividades</h1>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : (
        <KanbanBoard colunas={colunas} atividades={atividades} onMover={moverAtividade} />
      )}
    </div>
  );
}
