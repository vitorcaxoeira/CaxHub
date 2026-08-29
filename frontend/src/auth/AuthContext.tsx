import axios from "axios";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

interface PayloadJwt {
  userId: number;
  iat: number;
  exp: number;
}

// Decodifica só o payload (2º segmento) de um JWT — sem verificar assinatura, que é papel
// exclusivo do backend. Usado apenas pra validar um X-Renewed-Token ANTES de adotar (ver
// interceptor de resposta abaixo, 29/08/2026): nunca pra decidir autorização de verdade.
function decodificarPayloadJwt(token: string): PayloadJwt | null {
  try {
    const [, payloadBase64] = token.split(".");
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.userId !== "number" || typeof payload.iat !== "number" || typeof payload.exp !== "number") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

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
    // Guarda de "efeito superado" (28/08/2026, segunda corrida da mesma família — ver
    // [[interceptor-global-precisa-validar-identidade-da-requisicao]]): este efeito dispara em
    // TODA troca de sessão (logout → token vira null, login → token vira o novo). Se a chamada
    // /me da sessão ANTERIOR ainda está em voo quando a sessão NOVA já foi montada, a resposta
    // atrasada aplicaria `setUser` de quem já não é mais a sessão atual — sobrescrevendo login
    // recém-feito com outra conta pelo perfil de quem estava logado antes. `cancelado` fecha
    // isso: o React roda a limpeza do efeito ANTERIOR antes de montar o novo, então a resposta
    // atrasada do efeito velho encontra `cancelado === true` e não aplica nada.
    let cancelado = false;
    axios
      .get("/api/auth/me")
      .then(({ data }) => {
        if (!cancelado) setUser(data.user);
      })
      .catch(() => {
        if (!cancelado) {
          localStorage.removeItem("token");
          setToken(null);
        }
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
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
        // BUG REAL (28/08/2026): uma requisição disparada pela sessão ANTERIOR (ex.: admin)
        // pode ainda estar "em voo" no momento em que o usuário desloga e entra com OUTRA
        // conta — a resposta dela chega DEPOIS do login novo, e sem esta checagem o
        // interceptor (global, não sabe "de quem" é a resposta) trocava o token da sessão
        // NOVA pelo token renovado da sessão VELHA, silenciosamente. Só aplica a renovação
        // se o token que ESTA requisição enviou ainda for o token ativo agora — senão é
        // resposta de uma sessão que já não é mais a atual, e descarta.
        const tokenEnviado = (response.config.headers?.Authorization as string | undefined)?.replace(/^Bearer /, "");
        const tokenAtual = localStorage.getItem("token");
        // Segunda guarda, em cima da de identidade da requisição acima (29/08/2026, incidente em
        // produção): a API saía sem Cache-Control, o Chrome cacheava a resposta com o
        // X-Renewed-Token dentro, e uma revalidação (304) reentregava esse header já expirado —
        // a guarda acima passava (a requisição realmente tinha mandado o token atual), mas o
        // CONTEÚDO da resposta é que estava velho. Corrigido na raiz no backend (Cache-Control:
        // no-store em toda resposta da API, server.ts), mas o navegador de quem já foi afetado
        // ainda tem a entrada envenenada no cache até a próxima requisição limpar — por isso
        // esta segunda camada: só adota o renovado se ele for comprovadamente MELHOR que o
        // atual (mesmo usuário, mais novo, ainda no futuro), nunca só "porque veio no header".
        if (renovado && tokenEnviado === tokenAtual) {
          const payloadAtual = decodificarPayloadJwt(tokenAtual ?? "");
          const payloadRenovado = decodificarPayloadJwt(renovado);
          const legitimo =
            payloadAtual &&
            payloadRenovado &&
            payloadRenovado.userId === payloadAtual.userId &&
            payloadRenovado.iat > payloadAtual.iat &&
            payloadRenovado.exp * 1000 > Date.now();
          if (legitimo) {
            localStorage.setItem("token", renovado);
            axios.defaults.headers.common.Authorization = `Bearer ${renovado}`;
            setToken(renovado);
          }
        }
        return response;
      },
      (error) => {
        // Só desloga se ESTA requisição realmente mandou um Authorization e ainda assim foi
        // rejeitada (token de verdade inválido/expirado) — nunca baseado em "existe token no
        // localStorage agora", que também é verdade na corrida acima (login() já gravou lá antes
        // do header estar pronto) e faria deslogar um login que acabou de funcionar. Mesma
        // guarda do sucesso acima (28/08/2026): o token enviado por ESTA requisição precisa
        // ainda ser o token ativo agora — senão é uma falha de uma sessão ANTERIOR que já foi
        // trocada por outro login, e não pode deslogar a sessão nova por causa dela.
        const tokenEnviado = (error.config?.headers?.Authorization as string | undefined)?.replace(/^Bearer /, "");
        const tokenAtual = localStorage.getItem("token");
        if (error.response?.status === 401 && tokenEnviado && tokenEnviado === tokenAtual) {
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
