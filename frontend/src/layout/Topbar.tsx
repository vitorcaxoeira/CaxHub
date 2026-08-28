import { useTheme } from "../theme/ThemeContext";
import { UserMenu } from "./UserMenu";
import { NotificacoesSino } from "./NotificacoesSino";

interface TopbarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  // Abre/fecha o drawer mobile — ação diferente de onToggleSidebar (que só existe a partir
  // de `lg`, ver botões abaixo).
  onToggleMobileMenu: () => void;
}

export function Topbar({ sidebarOpen, onToggleSidebar, onToggleMobileMenu }: TopbarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Esconder menu lateral" : "Mostrar menu lateral"}
          className="hidden items-center justify-center rounded-md border border-border p-2 text-muted transition hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
        {/* Hambúrguer — só abaixo de `lg` (o oposto do botão acima, que é só desktop). Sem
            ele o menu não tinha nenhuma forma de abrir em tela estreita/celular. */}
        <button
          onClick={onToggleMobileMenu}
          aria-label="Abrir menu"
          className="inline-flex items-center justify-center rounded-md border border-border p-2 text-muted transition hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <p className="font-display text-base font-semibold text-foreground lg:hidden">CaxHub</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
          className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted transition hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {theme === "dark" ? "Escuro" : "Claro"}
        </button>
        <NotificacoesSino />
        <UserMenu />
      </div>
    </header>
  );
}
