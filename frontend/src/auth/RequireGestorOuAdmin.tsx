import axios from "axios";
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Guarda de rota "admin ou líder de departamento". Líder não é um Role — é quem consta em
// DepartamentoGestor, então a resposta vem de GET /dashboard/meu-perfil (o mesmo dado que o
// Sidebar usa em `gestorOuAdmin`). Espelha o `exigirAdminOuGestor` do router de solicitações.
export function RequireGestorOuAdmin() {
  const { user, loading } = useAuth();
  const [ehGestor, setEhGestor] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!user || user.role === "admin") return;
    let cancelado = false;
    setEhGestor(undefined);
    axios
      .get("/api/dashboard/meu-perfil")
      .then(({ data }) => !cancelado && setEhGestor((data.departamentosGerenciados ?? []).length > 0))
      .catch(() => !cancelado && setEhGestor(false));
    return () => {
      cancelado = true;
    };
  }, [user]);

  if (loading || !user) return loading ? null : <Navigate to="/" replace />;
  if (user.role === "admin") return <Outlet />;
  if (ehGestor === undefined) return null;
  return ehGestor ? <Outlet /> : <Navigate to="/" replace />;
}
