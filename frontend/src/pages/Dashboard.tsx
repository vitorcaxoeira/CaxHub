import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "../auth/AuthContext";

// Dado mockado só para validar o layout do dashboard.
// Será substituído por dados reais vindos do backend (Postgres sincronizado via SOAP).
const mockData = [
  { name: "Jan", valor: 400 },
  { name: "Fev", valor: 300 },
  { name: "Mar", valor: 520 },
  { name: "Abr", valor: 280 },
];

export function Dashboard() {
  const { logout } = useAuth();

  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>Dashboard</h1>
        <button onClick={logout}>Sair</button>
      </header>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={mockData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="valor" fill="#4f46e5" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
