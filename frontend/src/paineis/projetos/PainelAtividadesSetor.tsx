import { PainelMoldura } from "../ui/PainelMoldura";
import { PainelKpi } from "../ui/PainelKpi";
import { PainelBarras } from "../ui/PainelBarras";
import { formatarCarimboFrescor } from "../ui/formatarCarimboFrescor";

// Shape devolvido por GET /painel-tv/dados/projetos-atividades-setor — espelha
// domain/painelCatalogo.ts::carregarAtividadesSetor (backend), mais `_syncAtualizadoEm`
// (embutido pelo router pra todo painel com dominioSync != null). Específico do CaxHub.
interface DadosAtividadesSetor {
  erro?: string;
  depexeLabel: string;
  total: number;
  backlog: number;
  emCurso: number;
  atrasadas: number;
  concluidasNoMes: number;
  porConsultor: { codfor: number; nome: string; qtd: number }[];
  _syncAtualizadoEm?: string | null;
}

export function PainelAtividadesSetor({ dados }: { dados: unknown }) {
  const d = dados as DadosAtividadesSetor | undefined;

  if (!d) {
    return (
      <PainelMoldura eyebrow="Projetos e horas do time" titulo="Atividades do setor">
        <p className="text-3xl text-muted">Carregando...</p>
      </PainelMoldura>
    );
  }
  if (d.erro) {
    return (
      <PainelMoldura eyebrow="Projetos e horas do time" titulo="Atividades do setor">
        <p className="text-3xl text-destructive">{d.erro}</p>
      </PainelMoldura>
    );
  }

  return (
    <PainelMoldura
      eyebrow={`Projetos e horas do time · ${d.depexeLabel}`}
      titulo="Atividades do setor"
      atualizadoEm={formatarCarimboFrescor(d._syncAtualizadoEm)}
    >
      {/* 2 colunas, não 4: com 4 colunas um valor de 3-4 dígitos (backlog de um
          departamento grande passa disso fácil) espremia demais e estourava a largura
          do card — ver o comentário em PainelKpi.tsx. 2x2 continua lendo bem numa TV. */}
      <div className="grid grid-cols-2 gap-8">
        <PainelKpi label="Backlog" valor={d.backlog} tone="neutral" />
        <PainelKpi label="Em curso" valor={d.emCurso} tone="primary" />
        <PainelKpi label="Atrasadas" valor={d.atrasadas} tone={d.atrasadas > 0 ? "destructive" : "success"} />
        <PainelKpi label="Concluídas no mês" valor={d.concluidasNoMes} tone="success" />
      </div>

      {d.porConsultor.length > 0 && (
        <div className="mt-14">
          <p className="mb-4 font-mono text-2xl uppercase tracking-wide text-muted">Carga por consultor</p>
          <PainelBarras itens={d.porConsultor.map((c) => ({ label: c.nome, valor: c.qtd }))} />
        </div>
      )}
    </PainelMoldura>
  );
}
