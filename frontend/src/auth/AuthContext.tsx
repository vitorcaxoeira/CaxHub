import axios from "axios";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

export interface AuthUser {
  id: number;
  email: string;
  nome: string;
  fotoUrl: string | null;
  role: string;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  // Merge otimista no usuário em memória (nome/fotoUrl) — usado depois de PUT/POST em
  // /api/perfil, cujas respostas já trazem o dado atualizado. Evita precisar de reload
  // ou de um novo GET /api/auth/me: o token não muda (payload é só {userId, role}, ver
  // backend/src/auth/jwt.ts), então não há nada pra revalidar além do estado local.
  atualizarUsuario: (patch: Partial<Pick<AuthUser, "nome" | "fotoUrl">>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.defaults.headers.common.Authorization = token ? `Bearer ${token}` : undefined;

    if (!token) {
      setLoading(false);
      return;
    }
    axios
      .get("/api/auth/me")
      .then(({ data }) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem("token");
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  function login(newToken: string, newUser: AuthUser) {
    localStorage.setItem("token", newToken);
    setToken(newToken);
    setUser(newUser);
  }

  function logout() {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  }

  function atualizarUsuario(patch: Partial<Pick<AuthUser, "nome" | "fotoUrl">>) {
    setUser((atual) => (atual ? { ...atual, ...patch } : atual));
  }

  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout, atualizarUsuario }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de um AuthProvider");
  return context;
}
