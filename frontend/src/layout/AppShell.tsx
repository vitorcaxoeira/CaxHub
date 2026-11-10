import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { VigiaFimDeJornada } from "../components/projetos/VigiaFimDeJornada";
import { useMenuLateralPadrao } from "../hooks/useMenuLateralPadrao";

export function AppShell() {
  // Menu lateral abre no padrão do usuário (aberto ou recolhido na faixa de ícones; estrela ao lado do botão no topo, 04/11/2026).
  const menuPadrao = useMenuLateralPadrao();
  const [sidebarOpen, setSidebarOpen] = useState(menuPadrao.padrao !== "recolhido");
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
      {/* Escolher uma tela no menu volta o menu ao padrão do usuário: com o padrão "recolhido", quem expandiu o menu (pela faixa de
          ícones ou pelo botão) para achar a tela o vê recolher de novo depois que ela abre. */}
      <Sidebar
        open={sidebarOpen}
        mobileOpen={mobileMenuOpen}
        onNavigate={() => {
          setMobileMenuOpen(false);
          if (menuPadrao.padrao === "recolhido") setSidebarOpen(false);
        }}
        onExpandir={() => setSidebarOpen(true)}
      />
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
          menuPadrao={menuPadrao.padrao}
          salvandoMenuPadrao={menuPadrao.salvando}
          onSalvarMenuPadrao={() => void menuPadrao.salvar(sidebarOpen ? "aberto" : "recolhido")}
          onToggleMobileMenu={() => setMobileMenuOpen((open) => !open)}
        />
        {/* Menu recolhido (faixa de ícones): o conteúdo usa toda a largura disponível (06/11/2026, tabelas largas cortavam colunas com faixas vazias dos
            dois lados). Com o menu aberto segue a largura máxima de sempre. */}
        <main className={`w-full flex-1 p-4 lg:p-6 ${sidebarOpen ? "mx-auto max-w-7xl" : "max-w-none"}`}>
          <Outlet />
        </main>
      </div>
      {/* Fora do <main> de proposito: e um vigia de fundo que acompanha o consultor em
          qualquer rota, nao conteudo de tela. Ver VigiaFimDeJornada. */}
      <VigiaFimDeJornada />
    </div>
  );
}
