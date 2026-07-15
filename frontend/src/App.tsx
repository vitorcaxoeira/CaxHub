import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RequireRole } from "./auth/RequireRole";
import { ThemeProvider } from "./theme/ThemeContext";
import { AppShell } from "./layout/AppShell";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { ContasReceber } from "./pages/financeiro/ContasReceber";
import { ContasPagar } from "./pages/financeiro/ContasPagar";
import { Propostas } from "./pages/projetos/Propostas";
import { Usuarios } from "./pages/admin/Usuarios";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Home />} />
              <Route path="/financeiro/contas-a-receber" element={<ContasReceber />} />
              <Route path="/financeiro/contas-a-pagar" element={<ContasPagar />} />
              <Route path="/projetos/propostas" element={<Propostas />} />
              <Route element={<RequireRole roles={["admin"]} />}>
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
