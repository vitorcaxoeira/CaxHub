import axios from "axios";
import { useEffect, useState } from "react";
import { Navigate, Outlet, useOutletContext } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { Acesso5S, Papel5S } from "../utils/gestao5s";

// Guarda de rota do módulo Gestão 5S. O acesso NÃO vem do papel do usuário no CaxHub, e sim do
// cadastro de participantes do 5S (GET /5s/meu-acesso) — as três camadas (menu, rota, API) usam
// esse mesmo dado. `papeis` restringe a rota a alguns papéis do 5S (ex.: só coordenador nos
// cadastros); o resultado é entregue às páginas por Outlet context (useAcesso5S).
export function Require5S({ papeis }: { papeis?: Papel5S[] }) {
  const { user, loading } = useAuth();
  const [acesso, setAcesso] = useState<Acesso5S | null | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    let cancelado = false;
    setAcesso(undefined);
    axios
      .get<Acesso5S>("/api/5s/meu-acesso")
      .then(({ data }) => !cancelado && setAcesso(data))
      .catch(() => !cancelado && setAcesso(null));
    return () => {
      cancelado = true;
    };
  }, [user]);

  if (loading || acesso === undefined) return null;
  if (!user || !acesso || !acesso.papel) return <Navigate to="/" replace />;
  if (papeis && !papeis.includes(acesso.papel)) return <Navigate to="/5s" replace />;
  return <Outlet context={acesso} />;
}

export function useAcesso5S(): Acesso5S {
  return useOutletContext<Acesso5S>();
}
