import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/ui/Avatar";

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar nome={user.nome} fotoUrl={user.fotoUrl} size="sm" />
        <span className="hidden text-sm text-foreground sm:block">{user.nome}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-56 rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium text-foreground">{user.nome}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <button
            role="menuitem"
            onClick={handleLogout}
            className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-surface-2"
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
