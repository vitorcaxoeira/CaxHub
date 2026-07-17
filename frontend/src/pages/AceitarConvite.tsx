import axios from "axios";
import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type Estado = "carregando" | "invalido" | "pronto";

export function AceitarConvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { login } = useAuth();
  const navigate = useNavigate();

  const [estado, setEstado] = useState<Estado>("carregando");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!token) {
      setEstado("invalido");
      return;
    }
    axios
      .get(`/api/auth/convite/${token}`)
      .then(({ data }) => {
        setNome(data.nome);
        setEmail(data.email);
        setEstado("pronto");
      })
      .catch(() => setEstado("invalido"));
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErro(null);

    if (password.length < 6) {
      setErro("Senha precisa ter pelo menos 6 caracteres");
      return;
    }
    if (password !== confirmacao) {
      setErro("As senhas não coincidem");
      return;
    }

    setEnviando(true);
    try {
      const { data } = await axios.post(`/api/auth/convite/${token}/aceitar`, { password });
      login(data.token, data.user);
      navigate("/");
    } catch (err: any) {
      setErro(err.response?.data?.error ?? "Não foi possível aceitar o convite");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-lg">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">CaxHub</p>
        <h1 className="mb-6 mt-2 font-display text-2xl font-bold text-foreground">Aceitar convite</h1>

        {estado === "carregando" && <p className="text-sm text-muted">Validando convite...</p>}

        {estado === "invalido" && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Convite inválido ou expirado. Peça pra quem te convidou gerar um novo link.
          </p>
        )}

        {estado === "pronto" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <span className="mb-1.5 block text-[11.5px] text-muted">Nome</span>
              <p className="text-sm font-medium text-foreground">{nome}</p>
            </div>
            <div>
              <span className="mb-1.5 block text-[11.5px] text-muted">E-mail</span>
              <p className="text-sm font-medium text-foreground">{email}</p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] text-muted">Senha</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] text-muted">Confirmar senha</span>
              <input
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                type="password"
                required
                className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            {erro && <p className="text-[12.5px] text-destructive">{erro}</p>}

            <button
              type="submit"
              disabled={enviando}
              className="w-full rounded-md bg-primary py-3 font-mono text-[12.5px] font-semibold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? "Entrando..." : "Definir senha e entrar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
