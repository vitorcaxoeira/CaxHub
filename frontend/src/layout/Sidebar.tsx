import axios from "axios";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

interface NavLeaf {
  to: string;
  label: string;
  // Só aparece pra quem é admin ou gestor de algum departamento (dinâmico, via
  // DepartamentoGestor — não dá pra expressar isso com `roles`, que é estático).
  gestorOuAdmin?: boolean;
  // Combina com `gestorOuAdmin` como OU, não AND: também aparece pra quem tem Consultor
  // próprio (dinâmico, via Consultor.email — mesmo caso de `gestorOuAdmin` não dar pra
  // expressar com `roles`). Hoje só a Meta diária usa isto — acesso liberado ao consultor
  // comum, mas restrito ao próprio registro dele no backend (ver routes/jornadas.ts).
  souConsultor?: boolean;
}

interface NavGroup {
  label: string;
  items: NavLeaf[];
  // Papéis que podem ver este grupo — mantido em sincronia com o `RequireRole` das
  // mesmas rotas em `App.tsx` e com o `requireRole(...)` do router correspondente no
  // backend. "*" = qualquer papel autenticado. Ao criar um menu novo, sempre
  // perguntar ao Vitor quais papéis acessam.
  roles: string[] | "*";
}

const topLevel: NavLeaf[] = [{ to: "/", label: "Início" }];

const groups: NavGroup[] = [
  {
    label: "Comercial",
    items: [{ to: "/projetos/propostas", label: "Propostas" }],
    roles: ["admin", "comercial"],
  },
  {
    label: "Gestão de Projetos",
    items: [
      { to: "/projetos/atividades", label: "Atividades" },
      { to: "/projetos/apontamentos", label: "Meus Apontamentos" },
      // Sem `gestorOuAdmin`: o consultor entra pra acompanhar os pedidos dele, o gestor
      // pra decidir os do time. O recorte de quem vê o quê é do servidor.
      { to: "/projetos/aprovacoes", label: "Aprovações" },
      { to: "/projetos/alocacao", label: "Alocação", gestorOuAdmin: true },
      { to: "/projetos/jornadas", label: "Meta diária", gestorOuAdmin: true, souConsultor: true },
      { to: "/projetos/auditoria", label: "Auditoria", gestorOuAdmin: true },
    ],
    roles: "*",
  },
  {
    label: "Financeiro a Receber",
    items: [
      { to: "/financeiro/contas-a-receber", label: "Contas a Receber" },
      { to: "/financeiro/recebimentos", label: "Recebimentos" },
      { to: "/financeiro/inadimplencia", label: "Inadimplência" },
      { to: "/financeiro/clientes", label: "Clientes" },
      { to: "/financeiro/fluxo-caixa", label: "Fluxo de Caixa" },
      { to: "/financeiro/historico", label: "Histórico" },
    ],
    roles: ["admin"],
  },
  {
    label: "Financeiro a Pagar",
    items: [{ to: "/financeiro/contas-a-pagar", label: "Contas a Pagar" }],
    roles: ["admin"],
  },
  {
    label: "Contábil",
    // Recorte por gestor de departamento reaberto em 28/08/2026 (tabela
    // DepartamentoGrupoContabil, administrada em Administração > Departamento x Grupo
    // Contábil) — o gestor vê a tela com o filtro de grupos já restrito ao(s)
    // departamento(s) dele; o admin continua vendo tudo.
    items: [{ to: "/contabil/resultado-analitico", label: "Resultado Analítico", gestorOuAdmin: true }],
    roles: "*",
  },
  {
    label: "Mercado",
    items: [
      { to: "/mercado/pedidos", label: "Listar Pedidos" },
      { to: "/mercado/analise-faturamento", label: "Análise de Faturamento" },
    ],
    roles: ["admin"],
  },
  {
    label: "Administração",
    items: [
      { to: "/admin/usuarios", label: "Usuários" },
      { to: "/admin/sincronizacao", label: "Exportados para o Senior" },
      { to: "/admin/sincronizacao-erp", label: "Importados do Senior" },
      { to: "/admin/departamento-grupo-contabil", label: "Departamento x Grupo Contábil" },
      { to: "/admin/paineis-tv", label: "Painéis de TV" },
    ],
    roles: ["admin"],
  },
];

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
  // Estado do drawer mobile (abaixo do breakpoint `lg`) — independente de `open`, que só
  // colapsa/expande o painel de desktop. Ver AppShell.tsx.
  mobileOpen?: boolean;
  // Fecha o drawer mobile ao navegar (clique num link). Sem efeito no desktop — lá não há
  // drawer pra fechar, é só um setState que não muda nada visualmente.
  onNavigate?: () => void;
}

export function Sidebar({ open, mobileOpen = false, onNavigate }: SidebarProps) {
  const { user } = useAuth();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(["Financeiro a Receber"]));
  const [ehGestorOuAdmin, setEhGestorOuAdmin] = useState(false);
  // Tem Consultor próprio (Consultor.email == o dele) — dinâmico, igual ehGestorOuAdmin,
  // mas admin não precisa disto pra ver nada (já entra por ehGestorOuAdmin).
  const [souConsultor, setSouConsultor] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (user.role === "admin") {
      setEhGestorOuAdmin(true);
      setSouConsultor(false);
      return;
    }
    // Guarda de "efeito superado" (28/08/2026) — mesma classe de corrida já corrigida em
    // AuthContext.tsx (ver interceptor-global-precisa-validar-identidade-da-requisicao):
    // este efeito dispara de novo toda vez que `user` muda (login/logout/troca de conta).
    // Sem isso, a resposta de /meu-perfil de uma sessão ANTERIOR (ex.: um gestor) podia
    // chegar depois de já estar logado como outra pessoa e marcar `ehGestorOuAdmin` errado
    // pra sessão nova — foi assim que o menu Contábil apareceu pro Edson, que não gerencia
    // departamento nenhum.
    let cancelado = false;
    axios
      .get("/api/dashboard/meu-perfil")
      .then(({ data }) => {
        if (cancelado) return;
        setEhGestorOuAdmin((data.departamentosGerenciados ?? []).length > 0);
        setSouConsultor(data.consultor != null);
      })
      .catch(() => {
        if (!cancelado) {
          setEhGestorOuAdmin(false);
          setSouConsultor(false);
        }
      });
    return () => {
      cancelado = true;
    };
  }, [user]);

  const visibleGroups = groups
    .filter((group) => user && (group.roles === "*" || group.roles.includes(user.role)))
    .map((group) => ({
      ...group,
      // `gestorOuAdmin` e `souConsultor` combinam como OU quando um item declara os dois
      // (ex.: Meta diária): item sem nenhuma das duas flags é sempre visível.
      items: group.items.filter(
        (item) => (!item.gestorOuAdmin && !item.souConsultor) || (item.gestorOuAdmin && ehGestorOuAdmin) || (item.souConsultor && souConsultor)
      ),
    }))
    // Grupo com `roles: "*"` mas cujo único item (ou todos) é `gestorOuAdmin: true` (ex.:
    // Contábil) fica sem NENHUM item pra quem não é gestor nem admin — sem este filtro, o
    // grupo continuava aparecendo vazio no menu (achado real: Edson via "Contábil" com
    // "Em breve" dentro, 28/08/2026). A visibilidade do GRUPO precisa considerar o resultado
    // do filtro por item, não só o `roles` estático dele.
    .filter((group) => group.items.length > 0);

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    // Dois comportamentos no mesmo elemento, um por breakpoint: abaixo de `lg` é um drawer
    // fixo que desliza por transform (`mobileOpen`); a partir de `lg` volta a ser o painel em
    // fluxo normal de sempre, que só colapsa/expande a largura (`open`) — nunca os dois ao
    // mesmo tempo, o breakpoint decide (28/08/2026, ver AppShell.tsx pro backdrop/estado).
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-none flex-col overflow-hidden border-r border-border bg-surface transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 lg:transition-[width] ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      } ${open ? "lg:w-60 lg:border-r" : "lg:w-0 lg:border-r-0"}`}
    >
      <div className="flex h-16 items-center border-b border-border px-5">
        <p className="whitespace-nowrap font-display text-lg font-bold text-foreground">CaxHub</p>
      </div>
      <nav className="flex-1 space-y-1 whitespace-nowrap px-3 py-4">
        {topLevel.map((item) => (
          <NavLink key={item.to} to={item.to} end className={linkClass} onClick={onNavigate}>
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
              {/* Sem fallback "Em breve" pra grupo vazio (28/08/2026): `visibleGroups` acima já
                  filtra fora qualquer grupo cujos itens zeraram depois do recorte por
                  gestorOuAdmin — chegar aqui com `group.items` vazio não acontece mais. */}
              {isOpen && (
                <div className="mt-1 space-y-1 border-l border-border pl-3">
                  {group.items.map((item) => (
                    <NavLink key={item.to} to={item.to} className={linkClass} onClick={onNavigate}>
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
