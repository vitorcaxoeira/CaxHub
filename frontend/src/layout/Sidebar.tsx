import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

interface NavLeaf {
  to: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavLeaf[];
}

const topLevel: NavLeaf[] = [{ to: "/", label: "Início" }];

const groups: NavGroup[] = [
  {
    label: "Financeiro",
    items: [
      { to: "/financeiro/contas-a-receber", label: "Contas a Receber" },
      { to: "/financeiro/contas-a-pagar", label: "Contas a Pagar" },
    ],
  },
  {
    label: "Gestão de Projetos",
    items: [{ to: "/projetos/propostas", label: "Propostas" }],
  },
];

const adminGroup: NavGroup = {
  label: "Administração",
  items: [{ to: "/admin/usuarios", label: "Usuários" }],
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium transition ${
    isActive ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
  }`;

interface SidebarProps {
  open: boolean;
}

export function Sidebar({ open }: SidebarProps) {
  const { user } = useAuth();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(["Financeiro"]));
  const visibleGroups = user?.role === "admin" ? [...groups, adminGroup] : groups;

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <aside
      className={`hidden flex-none flex-col overflow-hidden border-border bg-surface transition-[width] duration-200 lg:flex ${
        open ? "w-60 border-r" : "w-0 border-r-0"
      }`}
    >
      <div className="flex h-16 items-center border-b border-border px-5">
        <p className="whitespace-nowrap font-display text-lg font-bold text-foreground">CaxHub</p>
      </div>
      <nav className="flex-1 space-y-1 whitespace-nowrap px-3 py-4">
        {topLevel.map((item) => (
          <NavLink key={item.to} to={item.to} end className={linkClass}>
            {item.label}
          </NavLink>
        ))}

        {visibleGroups.map((group) => {
          const isOpen = openGroups.has(group.label);
          return (
            <div key={group.label}>
              <button
                onClick={() => toggleGroup(group.label)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{group.label}</span>
                <ChevronIcon open={isOpen} />
              </button>
              {isOpen && (
                <div className="mt-1 space-y-1 border-l border-border pl-3">
                  {group.items.map((item) => (
                    <NavLink key={item.to} to={item.to} className={linkClass}>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
