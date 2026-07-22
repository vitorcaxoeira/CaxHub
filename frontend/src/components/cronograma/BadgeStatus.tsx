import { StatusNo } from "../../lib/cronograma";

const LABEL: Record<StatusNo, string> = {
  nao_iniciada: "Não iniciada",
  em_curso: "Em curso",
  bloqueada: "Bloqueada",
  concluida: "Concluída",
};

// Cor é reservada só pra status nesta tela — nada de hierarquia comunicada por cor
// (isso é papel de indentação + peso de fonte + fundo).
const TONE: Record<StatusNo, string> = {
  nao_iniciada: "bg-muted/15 text-muted",
  em_curso: "bg-primary/15 text-primary",
  bloqueada: "bg-warning/15 text-warning",
  concluida: "bg-success/15 text-success",
};

export function BadgeStatus({ status }: { status: StatusNo }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${TONE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
