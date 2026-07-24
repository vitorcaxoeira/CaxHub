import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/ui/Avatar";
import { DropdownMenu } from "../components/ui/DropdownMenu";

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenu.Trigger>
        <button className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar nome={user.nome} fotoUrl={user.fotoUrl} size="sm" />
          <span className="hidden text-sm text-foreground sm:block">{user.nome}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="w-56 p-0 py-1">
        <div className="border-b border-border px-3 py-2">
          <p className="truncate text-sm font-medium text-foreground">{user.nome}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
        <DropdownMenu.Item onSelect={() => navigate("/perfil")} className="flex items-center gap-2 rounded-none px-3 py-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          Meu perfil
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={handleLogout} destructive className="rounded-none px-3 py-2">
          Sair
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
