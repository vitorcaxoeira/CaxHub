import { Tone } from "./badges";

// Ícone dos 3 desfechos de uma solicitação de aprovação — mesmo estilo/proporção de
// IconeIntegracaoErp.tsx (24x24, stroke, sem fill), mapeado pelo STATUS da solicitação em
// vez de por Tone de sync ERP: "pendente" aqui é relógio (aguardando uma PESSOA decidir),
// não o Spinner que IconeIntegracaoErp usa pra "enviando" (processo em voo).
export type StatusSolicitacao = "pendente" | "aprovada" | "reprovada";

export const TOM_STATUS_SOLICITACAO: Record<StatusSolicitacao, Tone> = {
  pendente: "warning",
  aprovada: "success",
  reprovada: "destructive",
};

export function IconeStatusSolicitacao({ status, className = "h-2.5 w-2.5" }: { status: StatusSolicitacao; className?: string }) {
  if (status === "aprovada") {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === "reprovada") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    );
  }
  // pendente — relógio: aguarda alguém com alçada decidir.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}
