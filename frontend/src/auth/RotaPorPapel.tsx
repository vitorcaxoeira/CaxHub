import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { destinoInicial, ROLE_PAINEL } from "./destinoInicial";

// ---------------------------------------------------------------------------
// Os dois pontos de entrada que faltam além do login (destinoInicial.ts) pra
// nenhum papel cair num beco sem saída silencioso. GENÉRICO no mecanismo —
// só depende de destinoInicial, que é onde cada projeto declara seus papéis.
// ---------------------------------------------------------------------------

// Embrulha o AppShell inteiro (não só a Home): várias rotas ali dentro (Atividades,
// Apontamentos, Alocação, Jornadas...) são abertas a "qualquer autenticado" de propósito
// (RBAC fino demais pra expressar em Role — o backend decide o resto), então SEM este
// guard aqui em cima, o papel painel conseguia navegar direto pra qualquer uma delas e o
// AppShell renderizava normal (RequireRole não pega essas rotas, elas não têm nenhum).
// Redireciona pra /painel antes de montar o Outlet — nenhuma delas chega a renderizar.
// Também cobre "/" sozinho: um browser em modo quiosque restaura a última URL/homepage e
// pode cair lá com token válido, sem passar pelo Login.
export function RedirecionaPainelDaHome({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role === ROLE_PAINEL) return <Navigate to="/painel" replace />;
  return <>{children}</>;
}

// Rota catch-all (App.tsx "*") — hoje qualquer URL desconhecida cai em "/", que pro
// papel painel seria a Home vazia. Manda cada papel pro destino certo.
export function CatchAllPorPapel() {
  const { user } = useAuth();
  return <Navigate to={destinoInicial(user?.role)} replace />;
}
