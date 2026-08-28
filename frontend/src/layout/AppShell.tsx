import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { VigiaFimDeJornada } from "../components/projetos/VigiaFimDeJornada";

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Drawer mobile (abaixo do breakpoint `lg`) — separado de `sidebarOpen` (colapsa/expande o
  // painel de desktop): são ações diferentes, misturar os dois criaria casos estranhos ao
  // redimensionar a janela com o drawer aberto (28/08/2026, ver Sidebar.tsx).
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Trava o scroll da página por trás do drawer aberto — senão dá pra rolar o conteúdo
  // enquanto o menu está por cima dele.
  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  // Esc fecha o drawer — mesmo espírito de fechamento "acidental" já usado em Modal.tsx.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar open={sidebarOpen} mobileOpen={mobileMenuOpen} onNavigate={() => setMobileMenuOpen(false)} />
      {/* Fundo escurecido atrás do drawer mobile — só existe (não só invisível) enquanto
          aberto, e só abaixo de `lg` (no desktop o menu nunca é overlay). Clique fecha. */}
      {mobileMenuOpen && (
        <button
          aria-label="Fechar menu"
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onToggleMobileMenu={() => setMobileMenuOpen((open) => !open)}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
      {/* Fora do <main> de proposito: e um vigia de fundo que acompanha o consultor em
          qualquer rota, nao conteudo de tela. Ver VigiaFimDeJornada. */}
      <VigiaFimDeJornada />
    </div>
  );
}
