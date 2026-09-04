import { PainelMoldura } from "../ui/PainelMoldura";
import { useCronometro } from "../../hooks/useCronometro";

// Shape devolvido por GET /painel-tv/dados/projetos-em-execucao — espelha
// domain/painelCatalogo.ts::carregarEmExecucao (backend). Específico do CaxHub.
interface ItemEmExecucao {
  atividadeConsultorId: number;
  codfor: number;
  consultorNome: string;
  atividadeNome: string;
  clienteNome: string | null;
  inicio: string;
}
interface DadosEmExecucao {
  erro?: string;
  depexeLabel: string;
  emExecucao: ItemEmExecucao[];
}

// Um componente por linha, não um loop chamando o hook — useCronometro conta 1 segundo
// de cada vez no CLIENTE a partir de `inicio` (já recebido do servidor), então o
// cronômetro corre sozinho entre uma rotação e outra, sem nenhuma requisição nova.
function LinhaEmExecucao({ item }: { item: ItemEmExecucao }) {
  const cronometro = useCronometro(item.inicio);
  return (
    <div className="flex items-center justify-between gap-8 rounded-xl border border-border bg-surface px-10 py-7">
      <div className="min-w-0">
        <p className="font-mono text-4xl font-semibold text-foreground">{item.consultorNome}</p>
        <p className="mt-1.5 text-2xl text-muted">
          {item.atividadeNome}
          {item.clienteNome && ` · ${item.clienteNome}`}
        </p>
      </div>
      <p className="shrink-0 font-mono text-6xl font-bold tabular-nums text-primary">{cronometro.texto}</p>
    </div>
  );
}

export function PainelEmExecucao({ dados }: { dados: unknown }) {
  const d = dados as DadosEmExecucao | undefined;

  if (!d) {
    return (
      <PainelMoldura eyebrow="Projetos e horas do time" titulo="Em execução agora">
        <p className="text-3xl text-muted">Carregando...</p>
      </PainelMoldura>
    );
  }
  if (d.erro) {
    return (
      <PainelMoldura eyebrow="Projetos e horas do time" titulo="Em execução agora">
        <p className="text-3xl text-destructive">{d.erro}</p>
      </PainelMoldura>
    );
  }

  return (
    <PainelMoldura eyebrow={`Projetos e horas do time · ${d.depexeLabel}`} titulo="Em execução agora">
      {d.emExecucao.length === 0 ? (
        <p className="text-3xl text-muted">Ninguém em execução neste departamento agora.</p>
      ) : (
        <div className="space-y-5">
          {d.emExecucao.map((item) => (
            <LinhaEmExecucao key={item.atividadeConsultorId} item={item} />
          ))}
        </div>
      )}
    </PainelMoldura>
  );
}
