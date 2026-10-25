import axios from "axios";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { DEPEXE_COMERCIAL } from "../auth/acessoComercial";
import { Home } from "./Home";

// Elemento da rota "/" (25/10/2026, pedido do Vitor): o gestor do Comercial começa direto na Gestão de Metas (/comercial/metas); todo o
// resto, inclusive o admin, continua na Home. "Gestor do Comercial" não é papel: vem de DepartamentoGestor (depexe 2), pelo mesmo
// /dashboard/meu-perfil que o menu e o RequireGestorOuAdmin usam. Vale no login e no item "Início" do menu. Erro na consulta = Home.
export function Inicio() {
  const { user } = useAuth();
  const [destino, setDestino] = useState<"metas" | "home" | null>(user?.role === "admin" ? "home" : null);

  useEffect(() => {
    if (!user || user.role === "admin") {
      setDestino("home");
      return;
    }
    let cancelado = false;
    axios
      .get<{ departamentosGerenciados?: { depexe: number }[] }>("/api/dashboard/meu-perfil")
      .then(({ data }) => {
        if (cancelado) return;
        const gerenciaComercial = (data.departamentosGerenciados ?? []).some((d) => d.depexe === DEPEXE_COMERCIAL);
        setDestino(gerenciaComercial ? "metas" : "home");
      })
      .catch(() => !cancelado && setDestino("home"));
    return () => {
      cancelado = true;
    };
  }, [user]);

  if (destino === null) return null;
  if (destino === "metas") return <Navigate to="/comercial/metas" replace />;
  return <Home />;
}
