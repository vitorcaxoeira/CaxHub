import { Navigate, Outlet, useOutletContext } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function RequireRole({ roles }: { roles: string[] }) {
  const { user, loading } = useAuth();
  // Repassa o outlet context do pai (se houver) pro filho — o React Router NÃO propaga
  // context por Outlets aninhados sozinho; sem isto, uma rota que fique entre um layout
  // que fornece context (ex.: PainelShell) e a página que o lê (useOutletContext) quebra
  // com "undefined" mesmo o pai tendo passado o valor certo. `undefined` quando não há
  // nada a repassar é inofensivo (mesmo default do próprio hook).
  const context = useOutletContext();
  if (loading) return null;
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet context={context} />;
}
