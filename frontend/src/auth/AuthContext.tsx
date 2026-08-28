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

  // Corrige corrida de tempo pré-existente (28/08/2026, incidente em produção): login() grava o
  // token no localStorage de forma síncrona, mas quem seta axios.defaults.headers.common.Authorization
  // é o efeito [token] acima — roda depois do commit. Se navigate("/") já trocar de rota no mesmo
  // ciclo, os efeitos da Home (que buscam /dashboard/meu-perfil etc.) podem disparar ANTES desse
  // header existir (efeitos de componente filho rodam antes dos do pai) — a requisição sai sem
  // Authorization, vira 401 "Token ausente". Esse interceptor de REQUISIÇÃO lê o token direto do
  // localStorage (sempre síncrono e atualizado) e injeta o header no momento do disparo — não
  // depende de o efeito acima já ter rodado, fecha a corrida na raiz pra qualquer requisição.
  useEffect(() => {
    const id = axios.interceptors.request.use((config) => {
      const tokenAtual = localStorage.getItem("token");
      if (tokenAtual) config.headers.Authorization = `Bearer ${tokenAtual}`;
      return config;
    });
    return () => axios.interceptors.request.eject(id);
  }, []);

  // Renovação por deslizamento + auto-logout (27/08/2026) — primeiro interceptor global de
  // resposta do projeto, registrado uma vez. Backend (requireAuth) manda um token novo no header
  // X-Renewed-Token quando o atual já passou da metade da vida útil; aqui só troca ele
  // silenciosamente (localStorage + header padrão + estado). Se um 401 real chegar (token
  // expirou de vez), desloga — sem precisar de useNavigate (AuthProvider fica fora do
  // BrowserRouter): ProtectedRoute.tsx já observa `token` do contexto e redireciona pro /login
  // sozinho assim que ele vira null, mesmo mecanismo que o logout() manual já usa.
  useEffect(() => {
    const id = axios.interceptors.response.use(
      (response) => {
        const renovado = response.headers["x-renewed-token"];
        if (renovado) {
          localStorage.setItem("token", renovado);
          axios.defaults.headers.common.Authorization = `Bearer ${renovado}`;
          setToken(renovado);
        }
        return response;
      },
      (error) => {
        // Só desloga se ESTA requisição realmente mandou um Authorization e ainda assim foi
        // rejeitada (token de verdade inválido/expirado) — nunca baseado em "existe token no
        // localStorage agora", que também é verdade na corrida acima (login() já gravou lá antes
        // do header estar pronto) e faria deslogar um login que acabou de funcionar.
        const enviouToken = Boolean(error.config?.headers?.Authorization);
        if (error.response?.status === 401 && enviouToken) {
          localStorage.removeItem("token");
          setToken(null);
          setUser(null);
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, []);

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
