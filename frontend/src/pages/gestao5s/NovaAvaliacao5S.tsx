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
  setorVinculadoId: number | null;
  setorVinculadoNome: string | null;
  // Setor com ambientes comuns vinculados: sem perguntas próprias, avalia todos os ambientes.
  ehAgrupadora: boolean;
  vinculados: { id: number; nome: string }[];
}

// Uma escolha na tela: um setor, um ambiente comum ou o conjunto de ambientes de uma área agrupadora.
interface Opcao {
  chave: string;
  areaId: number;
  titulo: string;
  legenda?: string;
  // Nomes das avaliações que serão abertas (mais de uma quando é uma agrupadora).
  abre: string[];
  nomeNoTitulo: string;
  destaque?: boolean;
}

// "Nova Avaliação": escolhe o setor/ambiente, mostra o que será criado (título com a data,
// avaliador logado) e abre o questionário. Título, data e avaliador são automáticos no servidor.
// Área agrupadora abre uma avaliação por ambiente; avaliar um ambiente sozinho acumula o resultado
// na área a que ele está vinculado.
export function NovaAvaliacao5S() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { mostrar } = useToast();
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState<Opcao | null>(null);
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
      const { data } = await axios.post<{ id: number }>("/api/5s/avaliacoes", { areaId: escolhida.areaId });
      navigate(`/5s/avaliacoes/${data.id}`);
    } catch (err) {
      mostrar(mensagemDeErro(err, "Não foi possível criar a avaliação"), "destructive");
      setCriando(false);
    }
  }

  const setores: Opcao[] = (areas ?? [])
    .filter((a) => a.tipo === "setor" && !a.ehAgrupadora)
    .map((a) => ({ chave: `a${a.id}`, areaId: a.id, titulo: a.nome, abre: [a.nome], nomeNoTitulo: a.nome }));

  // Ambientes comuns: primeiro cada área agrupadora (avalia todos) seguida dos ambientes dela; depois
  // os ambientes soltos, sem vínculo.
  const agrupadoras = (areas ?? []).filter((a) => a.ehAgrupadora);
  const grupos = agrupadoras.map((mae) => ({
    mae,
    opcoes: [
      {
        chave: `mae${mae.id}`,
        areaId: mae.id,
        titulo: `Avaliar todos · ${mae.nome}`,
        legenda: `${mae.vinculados.length} ambiente(s): ${mae.vinculados.map((v) => v.nome).join(", ")}`,
        abre: mae.vinculados.map((v) => v.nome),
        nomeNoTitulo: mae.nome,
        destaque: true,
      } satisfies Opcao,
      ...(areas ?? [])
        .filter((a) => a.tipo === "comum" && a.setorVinculadoId === mae.id)
        .map((a) => ({ chave: `a${a.id}`, areaId: a.id, titulo: a.nome, legenda: `Acumula em ${mae.nome}`, abre: [a.nome], nomeNoTitulo: a.nome, acumulaEm: mae.nome })),
    ] as (Opcao & { acumulaEm?: string })[],
  }));
  const soltos: Opcao[] = (areas ?? [])
    .filter((a) => a.tipo === "comum" && !agrupadoras.some((m) => m.id === a.setorVinculadoId))
    .map((a) => ({ chave: `a${a.id}`, areaId: a.id, titulo: a.nome, abre: [a.nome], nomeNoTitulo: a.nome }));

  const [dia, mes, ano] = formatarDiaIso(hojeIso()).split("/");

  function Cartao({ o }: { o: Opcao }) {
    const ativa = escolhida?.chave === o.chave;
    return (
      <button
        type="button"
        onClick={() => setEscolhida(o)}
        aria-pressed={ativa}
        className={cn(
          "min-h-14 rounded-lg border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          ativa ? "border-primary bg-primary/10" : o.destaque ? "border-primary/40 bg-surface hover:bg-surface-2" : "border-border bg-surface hover:bg-surface-2"
        )}
      >
        <span className="block text-sm font-semibold text-foreground">{o.titulo}</span>
        {o.legenda && <span className="text-[11px] text-muted">{o.legenda}</span>}
      </button>
    );
  }

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

      {areas && setores.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Setores</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {setores.map((o) => (
              <Cartao key={o.chave} o={o} />
            ))}
          </div>
        </section>
      )}

      {areas &&
        grupos.map(({ mae, opcoes }) => (
          <section key={mae.id} className="mb-6">
            <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Ambientes comuns · {mae.nome}</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {opcoes.map((o) => (
                <Cartao key={o.chave} o={o} />
              ))}
            </div>
          </section>
        ))}

      {areas && soltos.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Ambientes comuns</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {soltos.map((o) => (
              <Cartao key={o.chave} o={o} />
            ))}
          </div>
        </section>
      )}

      {escolhida && (
        <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          <p className="text-sm font-semibold text-foreground">
            Avaliação 5S – {dia}/{mes}/{ano} – {escolhida.nomeNoTitulo}
          </p>
          <p className="mb-3 text-[12px] text-muted">
            Avaliador: {user?.nome ?? "—"} · a data é a de hoje
            {escolhida.abre.length > 1 && ` · serão abertas ${escolhida.abre.length} avaliações, uma por ambiente`}
          </p>
          <button type="button" disabled={criando} onClick={iniciar} className={`${classeBotaoPrimario} min-h-11 w-full sm:w-auto`}>
            {criando ? "Criando…" : escolhida.abre.length > 1 ? "Iniciar avaliações" : "Iniciar avaliação"}
          </button>
        </div>
      )}
    </div>
  );
}
