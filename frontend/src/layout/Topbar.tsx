import { Menu, Moon, PanelLeft, Sun } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";
import { UserMenu } from "./UserMenu";
import { NotificacoesSino } from "./NotificacoesSino";
import type { MenuLateral } from "../hooks/useMenuLateralPadrao";

interface TopbarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  // Abre/fecha o drawer mobile — ação diferente de onToggleSidebar (que só existe a partir
  // de `lg`, ver botões abaixo).
  onToggleMobileMenu: () => void;
  /** Padrão salvo do menu lateral e a gravação do estado atual como padrão (estrela ao lado do botão, 04/11/2026). */
  menuPadrao: MenuLateral;
  salvandoMenuPadrao: boolean;
  onSalvarMenuPadrao: () => void;
}

export function Topbar({ sidebarOpen, onToggleSidebar, onToggleMobileMenu, menuPadrao, salvandoMenuPadrao, onSalvarMenuPadrao }: TopbarProps) {
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
        <EstrelaMenuPadrao atual={sidebarOpen ? "aberto" : "recolhido"} padrao={menuPadrao} salvando={salvandoMenuPadrao} onSalvar={onSalvarMenuPadrao} />
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

// Estrela ao lado do botão de mostrar/esconder o menu (só desktop, como o botão): cheia quando o menu está como o padrão salvo; vazada, um
// clique torna o estado atual (aberto ou recolhido) o padrão — o CaxHub passa a abrir assim e o menu volta a ele depois de escolher uma tela.
// Mesmo desenho da estrela de padrão dos filtros e da visão de Atividades.
function EstrelaMenuPadrao({ atual, padrao, salvando, onSalvar }: { atual: MenuLateral; padrao: MenuLateral; salvando: boolean; onSalvar: () => void }) {
  const ehPadrao = atual === padrao;
  const dica = ehPadrao ? `Menu ${atual} é o seu padrão` : `Abrir sempre com o menu ${atual}`;
  return (
    <button
      type="button"
      onClick={ehPadrao ? undefined : onSalvar}
      disabled={salvando}
      aria-pressed={ehPadrao}
      aria-label={dica}
      title={dica}
      className={`hidden h-8 w-8 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:inline-flex ${
        ehPadrao ? "cursor-default text-warning" : "text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill={ehPadrao ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95L12 2.5z" />
      </svg>
    </button>
  );
}
