import { StatusNo } from "../../lib/cronograma";
import { EscalaMontada } from "../../lib/gantt";

// Peças do Gantt do relatório impresso do Cronograma. Tudo posicionado em % da largura da coluna
// (ver lib/gantt.ts), sem pixel nem biblioteca: sai igual na tela, no "Imprimir" e no PDF do servidor.

const COR_ATIVIDADE: Record<StatusNo, string> = {
  nao_iniciada: "bg-muted/40",
  // Em curso e concluída usam o mesmo verde nos dois temas — o contorno com miolo claro é o que as
  // separa (concluída = cheia).
  em_curso: "bg-primary/40 ring-1 ring-inset ring-primary",
  bloqueada: "bg-warning",
  concluida: "bg-success",
};

export const LEGENDA_GANTT: { rotulo: string; classe: string }[] = [
  { rotulo: "Não iniciada", classe: COR_ATIVIDADE.nao_iniciada },
  { rotulo: "Em curso", classe: COR_ATIVIDADE.em_curso },
  { rotulo: "Bloqueada", classe: COR_ATIVIDADE.bloqueada },
  { rotulo: "Concluída", classe: COR_ATIVIDADE.concluida },
  { rotulo: "Atrasada", classe: "bg-destructive" },
];

// Cabeçalho da coluna: uma fatia por semana/mês. Com muitas marcas só algumas levam o rótulo, senão
// o texto de uma atropela o da vizinha (a escala segue com todas as linhas de grade).
export function CabecalhoGantt({ escala }: { escala: EscalaMontada }) {
  const passo = Math.max(1, Math.ceil(escala.marcas.length / 14));
  return (
    <div className="relative h-5 overflow-hidden">
      {escala.marcas.map((m, i) => (
        <span
          key={m.inicio}
          className="absolute inset-y-0 border-l border-border pl-0.5 text-[8.5px] font-medium normal-case leading-5 tracking-normal text-muted"
          style={{ left: `${m.esquerda}%`, width: `${m.largura}%` }}
        >
          {i % passo === 0 ? m.rotulo : ""}
        </span>
      ))}
    </div>
  );
}

interface LinhaGanttProps {
  escala: EscalaMontada;
  // Período efetivo do nó (o próprio ou o derivado dos descendentes) — sem data, a linha fica só com a grade.
  inicio: string | null;
  fim: string | null;
  // O período não é do próprio nó: vem dos descendentes (barra hachurada).
  derivado: boolean;
  tipo: "item" | "pasta" | "atividade";
  status: StatusNo;
  atrasada: boolean;
  // Dia de hoje ("AAAA-MM-DD") quando cai dentro da escala; desenha a linha vertical.
  hoje: string | null;
  titulo: string;
}

export function LinhaGantt({ escala, inicio, fim, derivado, tipo, status, atrasada, hoje, titulo }: LinhaGanttProps) {
  // Só início ou só fim (o outro lado em branco): marca o dia que existe, em vez de inventar período.
  const barra = inicio || fim ? escala.barra(inicio ?? fim!, fim ?? inicio!) : null;
  const resumo = tipo !== "atividade";
  const posicaoHoje = hoje ? escala.posicao(hoje) : null;
  return (
    <div className="relative h-[18px]" title={titulo}>
      {escala.marcas.map((m) => (
        <span key={m.inicio} className="absolute inset-y-0 border-l border-border/50" style={{ left: `${m.esquerda}%` }} />
      ))}
      {posicaoHoje != null && posicaoHoje >= 0 && posicaoHoje <= 100 && (
        <span className="absolute inset-y-0 border-l-2 border-destructive/70" style={{ left: `${posicaoHoje}%` }} />
      )}
      {barra && (
        <span
          className={`absolute rounded-[1px] ${resumo ? "top-[6px] h-[6px] bg-foreground/70" : `top-[4px] h-[10px] ${atrasada ? "bg-destructive" : COR_ATIVIDADE[status]}`}`}
          style={{
            left: `${barra.esquerda}%`,
            width: `${barra.largura}%`,
            // Período calculado (não é do próprio nó): hachurado, pra não parecer data planejada.
            ...(derivado
              ? { backgroundImage: "repeating-linear-gradient(135deg, var(--background) 0 2px, transparent 2px 4px)" }
              : {}),
          }}
        />
      )}
    </div>
  );
}
