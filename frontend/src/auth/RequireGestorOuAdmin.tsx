import axios from "axios";
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Guarda de rota "admin ou líder de departamento". Líder não é um Role — é quem consta em
// DepartamentoGestor, então a resposta vem de GET /dashboard/meu-perfil (o mesmo dado que o
// Sidebar usa em `gestorOuAdmin`). Espelha o `exigirAdminOuGestor` do router de solicitações.
// `permitirViajante`: também deixa entrar quem viaja numa solicitação reservada/finalizada (o
// backend devolve `viajante` no mesmo /meu-perfil) — usado só nas telas de leitura da própria viagem.
// `depexe`: em vez de qualquer líder, só quem gerencia ESTE departamento (ou um DESTES, numa lista) — admin continua entrando.
// Usado em Pessoas (DHO), Gestão de Metas (Comercial) e Plano de Evolução PJ (Consultoria ERP e HCM).
export function RequireGestorOuAdmin({ permitirViajante = false, depexe }: { permitirViajante?: boolean; depexe?: number | readonly number[] }) {
  const { user, loading } = useAuth();
  // O resultado vale só para a regra (e o usuário) em que foi calculado. Duas guardas desta na mesma posição da árvore de rotas (ex.: o
  // redirecionamento do endereço antigo do Plano, sob a guarda "qualquer gestor", levando à guarda "só Consultoria") são a MESMA instância
  // para o React: sem a chave, o "é gestor" da regra anterior deixava a tela nova renderizar uma vez antes de o efeito recalcular.
  const chave = `${user?.id ?? ""}|${permitirViajante}|${depexe === undefined ? "" : String(depexe)}`;
  const [resultado, setResultado] = useState<{ chave: string; ehGestor: boolean } | null>(null);
  const ehGestor = resultado?.chave === chave ? resultado.ehGestor : undefined;

  useEffect(() => {
    if (!user || user.role === "admin") return;
    let cancelado = false;
    axios
      .get("/api/dashboard/meu-perfil")
      .then(({ data }) => {
        if (cancelado) return;
        // Cada item é um objeto { depexe, depexeLabel, integrantes }, não o número do departamento.
        const gerenciados: { depexe: number }[] = data.departamentosGerenciados ?? [];
        const aceitos = depexe === undefined ? null : typeof depexe === "number" ? [depexe] : depexe;
        const gerencia = aceitos === null ? gerenciados.length > 0 : gerenciados.some((d) => aceitos.includes(d.depexe));
        setResultado({ chave, ehGestor: gerencia || (permitirViajante && data.viajante === true) });
      })
      .catch(() => !cancelado && setResultado({ chave, ehGestor: false }));
    return () => {
      cancelado = true;
    };
    // `chave` resume user, permitirViajante e depexe (uma lista nova a cada render não pode disparar o efeito de novo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (loading || !user) return loading ? null : <Navigate to="/" replace />;
  if (user.role === "admin") return <Outlet />;
  if (ehGestor === undefined) return null;
  return ehGestor ? <Outlet /> : <Navigate to="/" replace />;
}
