import { toneBadge } from "../ui/badges";
import { STATUS_ROTULO, STATUS_TOM, type StatusViagem } from "../../utils/solicitacoesViagem";

export function StatusViagemBadge({ status }: { status: string }) {
  const s = status as StatusViagem;
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[STATUS_TOM[s] ?? "neutral"]}`}>
      {STATUS_ROTULO[s] ?? status}
    </span>
  );
}
