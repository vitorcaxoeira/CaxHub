import { Tone } from "./badges";
import { Spinner } from "./Spinner";

// Ícone do status de integração com o Senior — o tom já identifica o estado sozinho
// (integracaoErpTone em ratDominio.ts é uma bijeção: falha=destructive, enviando=warning,
// pendente=neutral, sincronizado=success), então o ícone escolhe pelo tom, sem precisar do
// status cru. Descritivo completo vai só no `title` de quem usa (hover), não aqui dentro.
//
// Extraído do Cronograma (LinhaNo.tsx) pra ser reaproveitado em qualquer tela que já tenha um
// `Tone` de integração ERP calculado — primeiro outro consumidor: "Sessões pendentes de
// confirmação" em MeusApontamentos.tsx.
export function IconeIntegracaoErp({ tone, className = "h-2.5 w-2.5" }: { tone: Tone; className?: string }) {
  if (tone === "warning") return <Spinner className={className} />; // enviando — em voo
  if (tone === "destructive") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    );
  }
  if (tone === "neutral") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
      </svg>
    );
  }
  // success — sincronizado
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
