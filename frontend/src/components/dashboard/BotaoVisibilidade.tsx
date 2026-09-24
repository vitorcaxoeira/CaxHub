// Olho de privacidade dos cards de dinheiro da Home (Valor-hora, RDV): evita expor valores em
// compartilhamento de tela/print. Estado puramente local no card — não persiste.
export function BotaoVisibilidade({ visivel, onAlternar }: { visivel: boolean; onAlternar: () => void }) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      className="rounded p-1 text-muted transition hover:bg-surface-2 hover:text-foreground"
      title={visivel ? "Ocultar valores" : "Mostrar valores"}
    >
      {visivel ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}
