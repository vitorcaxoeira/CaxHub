import { PainelMoldura } from "../ui/PainelMoldura";
import { PainelKpi } from "../ui/PainelKpi";
import { formatHoras } from "../../utils/horas";
import { formatarCarimboFrescor } from "../ui/formatarCarimboFrescor";

// Shape devolvido por GET /painel-tv/dados/projetos-horas-meta — espelha
// domain/painelCatalogo.ts::carregarHorasMeta (backend), mais `_syncAtualizadoEm`
// (embutido pelo router pra todo painel com dominioSync != null). Específico do CaxHub.
interface ConsultorHorasMeta {
  codfor: number;
  nome: string;
  realizadoMinutos: number;
  metaMinutos: number;
}
interface DadosHorasMeta {
  erro?: string;
  depexeLabel: string;
  periodo: { ano: number; mes: number };
  porConsultor: ConsultorHorasMeta[];
  evolucaoDiaria: { data: string; minutos: number }[];
  totalRealizadoMinutos: number;
  totalMetaMinutos: number;
  _syncAtualizadoEm?: string | null;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function LinhaConsultor({ item }: { item: ConsultorHorasMeta }) {
  const pct = item.metaMinutos > 0 ? Math.round((item.realizadoMinutos / item.metaMinutos) * 100) : null;
  const dentroDaMeta = pct == null || pct >= 100;
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-2xl">
        <span className="text-foreground">{item.nome}</span>
        <span className={dentroDaMeta ? "text-success" : "text-muted"}>
          {formatHoras(item.realizadoMinutos / 60)}
          {item.metaMinutos > 0 && ` / ${formatHoras(item.metaMinutos / 60)}`}
          {pct != null && ` · ${pct}%`}
        </span>
      </div>
      <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-muted/20">
        <div className={`h-full rounded-full ${dentroDaMeta ? "bg-success" : "bg-primary"}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
    </div>
  );
}

// Evolução diária do time inteiro — barras simples, sem rótulo por dia (30 rótulos não
// cabem numa TV) e sem overflow-x-auto (SerieTemporalBarra.tsx tem os dois problemas
// numa tela normal, onde dá pra passar o mouse ou rolar; aqui ninguém pode fazer isso).
function EvolucaoDiaria({ pontos }: { pontos: { data: string; minutos: number }[] }) {
  const maior = Math.max(1, ...pontos.map((p) => p.minutos));
  return (
    <div className="flex h-32 items-end gap-1">
      {pontos.map((p) => (
        <div
          key={p.data}
          className="flex-1 rounded-t-sm bg-primary/70"
          style={{ height: `${Math.max(2, (p.minutos / maior) * 100)}%` }}
          title={`${p.data}: ${formatHoras(p.minutos / 60)}`}
        />
      ))}
    </div>
  );
}

export function PainelHorasMeta({ dados }: { dados: unknown }) {
  const d = dados as DadosHorasMeta | undefined;

  if (!d) {
    return (
      <PainelMoldura eyebrow="Projetos e horas do time" titulo="Horas do time no mês">
        <p className="text-3xl text-muted">Carregando...</p>
      </PainelMoldura>
    );
  }
  if (d.erro) {
    return (
      <PainelMoldura eyebrow="Projetos e horas do time" titulo="Horas do time no mês">
        <p className="text-3xl text-destructive">{d.erro}</p>
      </PainelMoldura>
    );
  }

  return (
    <PainelMoldura
      eyebrow={`Projetos e horas do time · ${d.depexeLabel} · ${MESES[d.periodo.mes - 1]} de ${d.periodo.ano}`}
      titulo="Horas do time no mês"
      atualizadoEm={formatarCarimboFrescor(d._syncAtualizadoEm)}
    >
      <div className="grid grid-cols-2 gap-8">
        <PainelKpi label="Realizado no mês" valor={formatHoras(d.totalRealizadoMinutos / 60)} tone="primary" />
        <PainelKpi
          label="Meta do mês"
          valor={d.totalMetaMinutos > 0 ? formatHoras(d.totalMetaMinutos / 60) : "sem jornada"}
          tone={d.totalMetaMinutos > 0 && d.totalRealizadoMinutos >= d.totalMetaMinutos ? "success" : "neutral"}
        />
      </div>

      {d.evolucaoDiaria.length > 0 && (
        <div className="mt-10">
          <p className="mb-3 font-mono text-2xl uppercase tracking-wide text-muted">Evolução diária</p>
          <EvolucaoDiaria pontos={d.evolucaoDiaria} />
        </div>
      )}

      {d.porConsultor.length > 0 && (
        <div className="mt-10 space-y-5">
          <p className="font-mono text-2xl uppercase tracking-wide text-muted">Por consultor</p>
          {d.porConsultor.map((item) => (
            <LinhaConsultor key={item.codfor} item={item} />
          ))}
        </div>
      )}

      {d.porConsultor.length === 0 && <p className="mt-10 text-2xl text-muted">Nenhum consultor no time deste departamento.</p>}
    </PainelMoldura>
  );
}
