import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RequireRole } from "./auth/RequireRole";
import { ThemeProvider } from "./theme/ThemeContext";
import { ToastProvider } from "./components/ui/Toast";
import { AppShell } from "./layout/AppShell";
import { PainelShell } from "./layout/PainelShell";
import { RedirecionaPainelDaHome, CatchAllPorPapel } from "./auth/RotaPorPapel";
import { Login } from "./pages/Login";
import { AceitarConvite } from "./pages/AceitarConvite";
import { Home } from "./pages/Home";
import { Perfil } from "./pages/Perfil";
import { ContasReceber } from "./pages/financeiro/ContasReceber";
import { ContasPagar } from "./pages/financeiro/ContasPagar";
import { Recebimentos } from "./pages/financeiro/Recebimentos";
import { Inadimplencia } from "./pages/financeiro/Inadimplencia";
import { Clientes } from "./pages/financeiro/Clientes";
import { FluxoCaixa } from "./pages/financeiro/FluxoCaixa";
import { Historico } from "./pages/financeiro/Historico";
import { ResultadoAnalitico } from "./pages/contabil/ResultadoAnalitico";
import { Propostas } from "./pages/projetos/Propostas";
import { Atividades } from "./pages/projetos/Atividades";
import { Jornadas } from "./pages/projetos/Jornadas";
import { Aprovacoes } from "./pages/projetos/Aprovacoes";
import { MeusApontamentos } from "./pages/projetos/MeusApontamentos";
import { Alocacao } from "./pages/projetos/Alocacao";
import { Auditoria } from "./pages/auditoria/Auditoria";
import { AlocacaoPropostaDetalhe } from "./pages/projetos/AlocacaoPropostaDetalhe";
import { CronogramaProposta } from "./pages/projetos/CronogramaProposta";
import { PropostaVisualizacao } from "./pages/projetos/PropostaVisualizacao";
import { RatVisualizacao } from "./pages/projetos/RatVisualizacao";
import { Usuarios } from "./pages/admin/Usuarios";
import { SincronizacaoSenior } from "./pages/admin/SincronizacaoSenior";
import { SincronizacaoErp } from "./pages/admin/SincronizacaoErp";
import { DepartamentoGrupoContabil } from "./pages/admin/DepartamentoGrupoContabil";
import { PaineisTv } from "./pages/admin/PaineisTv";
import { PainelRotacao } from "./pages/painel/PainelRotacao";
import { ListarPedidos } from "./pages/mercado/ListarPedidos";
import { PedidoVisualizacao } from "./pages/mercado/PedidoVisualizacao";
import { AnaliseFaturamento } from "./pages/mercado/AnaliseFaturamento";

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/aceitar-convite" element={<AceitarConvite />} />
            <Route
              element={
                <ProtectedRoute>
                  <RedirecionaPainelDaHome>
                    <AppShell />
                  </RedirecionaPainelDaHome>
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Home />} />
              <Route path="/perfil" element={<Perfil />} />
              <Route path="/projetos/atividades" element={<Atividades />} />
              <Route path="/projetos/apontamentos" element={<MeusApontamentos />} />
              <Route path="/projetos/alocacao" element={<Alocacao />} />
              <Route path="/projetos/jornadas" element={<Jornadas />} />
              <Route path="/projetos/aprovacoes" element={<Aprovacoes />} />
              <Route path="/projetos/auditoria" element={<Auditoria />} />
              <Route path="/projetos/alocacao/:codemp/:codpro" element={<AlocacaoPropostaDetalhe />} />
              <Route path="/projetos/alocacao/:codemp/:codpro/cronograma" element={<CronogramaProposta />} />
              <Route path="/projetos/proposta/:codemp/:codpro" element={<PropostaVisualizacao />} />
              <Route path="/projetos/rat/:id" element={<RatVisualizacao />} />
              {/* Sem RequireRole: "gestor de departamento" não é um Role (é derivado de
                  DepartamentoGestor em runtime) — o backend decide o que cada um vê/faz e o
                  frontend mostra uma tela "sem acesso" no 403. Mesmo padrão de Alocação/
                  Aprovações/Jornadas/Auditoria acima. Reaberto em 28/08/2026 (tinha sido
                  movido pra dentro do bloco admin-only abaixo em 26/08/2026, commit 3398f74,
                  enquanto o mapeamento Departamento x Grupo Contábil era configurado). */}
              <Route path="/contabil/resultado-analitico" element={<ResultadoAnalitico />} />
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
                <Route path="/admin/sincronizacao" element={<SincronizacaoSenior />} />
                <Route path="/admin/sincronizacao-erp" element={<SincronizacaoErp />} />
                <Route path="/admin/departamento-grupo-contabil" element={<DepartamentoGrupoContabil />} />
                <Route path="/admin/paineis-tv" element={<PaineisTv />} />
                <Route path="/mercado/pedidos" element={<ListarPedidos />} />
                <Route path="/mercado/pedido/:codemp/:codfil/:numped" element={<PedidoVisualizacao />} />
                <Route path="/mercado/analise-faturamento" element={<AnaliseFaturamento />} />
              </Route>
            </Route>
            {/* Modo Painel/TV — layout route irmã da AppShell acima, mas SEM Sidebar/Topbar
                (ver PainelShell). Papel painel cai só aqui; admin também acessa, pra
                pré-visualizar a rotação de uma TV. */}
            <Route
              element={
                <ProtectedRoute>
                  <PainelShell />
                </ProtectedRoute>
              }
            >
              <Route element={<RequireRole roles={["painel", "admin"]} />}>
                <Route path="/painel" element={<PainelRotacao />} />
              </Route>
            </Route>
            <Route path="*" element={<CatchAllPorPapel />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
