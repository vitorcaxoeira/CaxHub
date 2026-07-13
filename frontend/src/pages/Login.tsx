import axios from "axios";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageShell } from "../components/PageShell";

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
      login(data.token);
      navigate("/dashboard");
    } catch {
      setError("Credenciais inválidas");
    }
  }

  return (
    <PageShell narrow>
      <div className="login-card">
        <p className="eyebrow">CaxHub</p>
        <h1 className="display" style={{ fontSize: 26, marginBottom: 24 }}>
          Entrar
        </h1>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </label>
          <label className="field">
            <span>Senha</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn-primary">
            Entrar
          </button>
        </form>
      </div>
    </PageShell>
  );
}
