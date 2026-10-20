import { ROTULO_VISAO, VisaoAtividades } from "../../lib/atividadesVisao";

interface Props {
  visao: VisaoAtividades;
  padrao: VisaoAtividades;
  salvando: boolean;
  onTornarPadrao: () => void;
}

// Estrela ao lado das abas de Atividades: cheia quando a visão aberta já é a padrão do usuário; vazada, um clique torna a
// visão aberta a padrão (a tela passa a abrir nela). Também dá para escolher em Perfil › Preferências.
export function EstrelaVisaoPadrao({ visao, padrao, salvando, onTornarPadrao }: Props) {
  const ehPadrao = visao === padrao;
  const dica = ehPadrao ? `${ROTULO_VISAO[visao]} é a sua visão padrão` : `Abrir sempre em ${ROTULO_VISAO[visao]}`;
  return (
    <button
      type="button"
      onClick={ehPadrao ? undefined : onTornarPadrao}
      disabled={salvando}
      aria-pressed={ehPadrao}
      aria-label={dica}
      title={dica}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
        ehPadrao ? "cursor-default text-warning" : "text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill={ehPadrao ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95L12 2.5z" />
      </svg>
    </button>
  );
}
