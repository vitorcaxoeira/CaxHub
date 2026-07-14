import axios from "axios";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Login() {
  const [email, setEmail] = useState("admin@caxhub.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const { data } = await axios.post("/api/auth/login", { email, password });
      login(data.token, data.user);
      navigate("/");
    } catch {
      setError("Credenciais inválidas");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-lg">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">CaxHub</p>
        <h1 className="mt-2 mb-6 font-display text-2xl font-bold text-foreground">Entrar</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] text-muted">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
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
          {error && <p className="text-[12.5px] text-destructive">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-md bg-primary py-3 font-mono text-[12.5px] font-semibold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
