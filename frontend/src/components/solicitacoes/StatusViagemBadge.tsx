import { toneBadge } from "../ui/badges";
import { STATUS_TOM, rotuloStatus, type StatusViagem } from "../../utils/solicitacoesViagem";

// `tipo` só troca o rótulo do pedido "Outros" (Em atendimento / Concluída); sem ele, é o rótulo da viagem.
export function StatusViagemBadge({ status, tipo }: { status: string; tipo?: string }) {
  const s = status as StatusViagem;
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[STATUS_TOM[s] ?? "neutral"]}`}>
      {rotuloStatus(status, tipo)}
    </span>
  );
}
