import axios from "axios";
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Guarda de rota "admin ou líder de departamento". Líder não é um Role — é quem consta em
// DepartamentoGestor, então a resposta vem de GET /dashboard/meu-perfil (o mesmo dado que o
// Sidebar usa em `gestorOuAdmin`). Espelha o `exigirAdminOuGestor` do router de solicitações.
// `permitirViajante`: também deixa entrar quem viaja numa solicitação reservada/finalizada (o
// backend devolve `viajante` no mesmo /meu-perfil) — usado só nas telas de leitura da própria viagem.
// `depexe`: em vez de qualquer líder, só quem gerencia ESTE departamento (admin continua entrando) — usado
// em Pessoas, restrito ao gestor do DHO.
export function RequireGestorOuAdmin({ permitirViajante = false, depexe }: { permitirViajante?: boolean; depexe?: number }) {
  const { user, loading } = useAuth();
  const [ehGestor, setEhGestor] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!user || user.role === "admin") return;
    let cancelado = false;
    setEhGestor(undefined);
    axios
      .get("/api/dashboard/meu-perfil")
      .then(({ data }) => {
        if (cancelado) return;
        // Cada item é um objeto { depexe, depexeLabel, integrantes }, não o número do departamento.
        const gerenciados: { depexe: number }[] = data.departamentosGerenciados ?? [];
        const gerencia = depexe === undefined ? gerenciados.length > 0 : gerenciados.some((d) => d.depexe === depexe);
        setEhGestor(gerencia || (permitirViajante && data.viajante === true));
      })
      .catch(() => !cancelado && setEhGestor(false));
    return () => {
      cancelado = true;
    };
  }, [user, permitirViajante, depexe]);

  if (loading || !user) return loading ? null : <Navigate to="/" replace />;
  if (user.role === "admin") return <Outlet />;
  if (ehGestor === undefined) return null;
  return ehGestor ? <Outlet /> : <Navigate to="/" replace />;
}
