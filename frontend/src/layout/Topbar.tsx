import { Menu, Moon, PanelLeft, Sun } from "lucide-react";
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
          aria-label={sidebarOpen ? "Recolher menu lateral" : "Expandir menu lateral"}
          title={sidebarOpen ? "Recolher menu" : "Expandir menu"}
          className="hidden items-center justify-center rounded-md border border-border p-2 text-muted transition hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
        >
          <PanelLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {/* Hambúrguer — só abaixo de `lg` (o oposto do botão acima, que é só desktop). Sem
            ele o menu não tinha nenhuma forma de abrir em tela estreita/celular. */}
        <button
          onClick={onToggleMobileMenu}
          aria-label="Abrir menu"
          className="inline-flex items-center justify-center rounded-md border border-border p-2 text-muted transition hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2 lg:hidden">
          <img src="/marca/icone-128.png" alt="" className="h-7 w-7 rounded-md" />
          <p className="font-display text-base font-semibold text-foreground">CaxHub</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Mostra o tema atual (lua = escuro, sol = claro); o clique troca. Mesmo botão do CaxHub_Dash (04/11/2026). */}
        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
          title={theme === "dark" ? "Tema escuro (clique para o claro)" : "Tema claro (clique para o escuro)"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted transition hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {theme === "dark" ? <Moon size={18} strokeWidth={1.75} aria-hidden="true" /> : <Sun size={18} strokeWidth={1.75} aria-hidden="true" />}
        </button>
        <NotificacoesSino />
        <UserMenu />
      </div>
    </header>
  );
}
