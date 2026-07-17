import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RequireRole } from "./auth/RequireRole";
import { ThemeProvider } from "./theme/ThemeContext";
import { AppShell } from "./layout/AppShell";
import { Login } from "./pages/Login";
import { AceitarConvite } from "./pages/AceitarConvite";
import { Home } from "./pages/Home";
import { ContasReceber } from "./pages/financeiro/ContasReceber";
import { ContasPagar } from "./pages/financeiro/ContasPagar";
import { Recebimentos } from "./pages/financeiro/Recebimentos";
import { Inadimplencia } from "./pages/financeiro/Inadimplencia";
import { Clientes } from "./pages/financeiro/Clientes";
import { FluxoCaixa } from "./pages/financeiro/FluxoCaixa";
import { Historico } from "./pages/financeiro/Historico";
import { Propostas } from "./pages/projetos/Propostas";
import { Atividades } from "./pages/projetos/Atividades";
import { Usuarios } from "./pages/admin/Usuarios";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/aceitar-convite" element={<AceitarConvite />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Home />} />
              <Route path="/projetos/atividades" element={<Atividades />} />
              <Route element={<RequireRole roles={["admin", "comercial"]} />}>
                <Route path="/projetos/propostas" element={<Propostas />} />
              </Route>
              <Route element={<RequireRole roles={["admin"]} />}>
                <Route path="/financeiro/contas-a-receber" element={<ContasReceber />} />
                <Route path="/financeiro/contas-a-pagar" element={<ContasPagar />} />
                <Route path="/financeiro/recebimentos" element={<Recebimentos />} />
                <Route path="/financeiro/inadimplencia" element={<Inadimplencia />} />
                <Route path="/financeiro/clientes" element={<Clientes />} />
                <Route path="/financeiro/fluxo-caixa" element={<FluxoCaixa />} />
                <Route path="/financeiro/historico" element={<Historico />} />
                <Route path="/admin/usuarios" element={<Usuarios />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
