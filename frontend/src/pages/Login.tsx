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
      login(data.token);
      navigate("/dashboard");
    } catch {
      setError("Credenciais inválidas");
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 320, margin: "80px auto" }}>
      <h1>CaxHub</h1>
      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
      </label>
      <label>
        Senha
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />
      </label>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <button type="submit">Entrar</button>
    </form>
  );
}
