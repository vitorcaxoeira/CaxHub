import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { classeBotaoPrimario } from "../../components/gestao5s/campos";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { cn } from "../../lib/cn";
import { mensagemDeErro } from "../../utils/gestao5s";
import { TipoArea, formatarDiaIso, hojeIso } from "../../utils/gestao5s";

interface Area {
  id: number;
  nome: string;
  tipo: TipoArea;
  setorVinculadoNome: string | null;
}

// "Nova Avaliação": escolhe o setor/ambiente, mostra o que será criado (título com a data,
// avaliador logado) e abre o questionário. Título, data e avaliador são automáticos no servidor.
export function NovaAvaliacao5S() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { mostrar } = useToast();
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState<Area | null>(null);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    axios
      .get<Area[]>("/api/5s/areas")
      .then(({ data }) => setAreas(data))
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar as áreas")));
  }, []);

  async function iniciar() {
    if (!escolhida) return;
    setCriando(true);
    try {
      const { data } = await axios.post<{ id: number }>("/api/5s/avaliacoes", { areaId: escolhida.id });
      navigate(`/5s/avaliacoes/${data.id}`);
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível criar a avaliação"), "destructive");
      setCriando(false);
    }
  }

  const grupos: { titulo: string; tipo: TipoArea }[] = [
    { titulo: "Setores", tipo: "setor" },
    { titulo: "Ambientes comuns", tipo: "comum" },
  ];
  const [dia, mes, ano] = formatarDiaIso(hojeIso()).split("/");

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S</p>
      <h1 className="mb-1 font-display text-2xl font-bold text-foreground">Nova avaliação</h1>
      <p className="mb-6 text-sm text-muted">Escolha o setor ou ambiente que será avaliado.</p>

      {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{erro}</p>}
      {!areas && !erro && <Skeleton className="h-40 w-full" />}
      {areas && areas.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          Nenhuma área cadastrada. Peça ao coordenador para cadastrar setores e ambientes em Cadastros › Áreas e Ambientes.
        </p>
      )}

      {areas &&
        grupos.map(({ titulo, tipo }) => {
          const lista = areas.filter((a) => a.tipo === tipo);
          if (lista.length === 0) return null;
          return (
            <section key={tipo} className="mb-6">
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {lista.map((a) => {
                  const ativa = escolhida?.id === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setEscolhida(a)}
                      aria-pressed={ativa}
                      className={cn(
                        "min-h-14 rounded-lg border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        ativa ? "border-primary bg-primary/10" : "border-border bg-surface hover:bg-surface-2"
                      )}
                    >
                      <span className="block text-sm font-semibold text-foreground">{a.nome}</span>
                      {a.setorVinculadoNome && <span className="text-[11px] text-muted">Vinculado a {a.setorVinculadoNome}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

      {escolhida && (
        <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          <p className="text-sm font-semibold text-foreground">
            Avaliação 5S – {dia}/{mes}/{ano} – {escolhida.nome}
          </p>
          <p className="mb-3 text-[12px] text-muted">Avaliador: {user?.nome ?? "—"} · a data é a de hoje</p>
          <button type="button" disabled={criando} onClick={iniciar} className={`${classeBotaoPrimario} min-h-11 w-full sm:w-auto`}>
            {criando ? "Criando…" : "Iniciar avaliação"}
          </button>
        </div>
      )}
    </div>
  );
}
