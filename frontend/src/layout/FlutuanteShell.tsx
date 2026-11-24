import { ReactNode } from "react";
import { VigiaFimDeJornada } from "../components/projetos/VigiaFimDeJornada";

// Casca da janela flutuante (/flutuante): sem Sidebar nem Topbar, ocupa a janela inteira — que
// tem ~360px de largura. Mantém o VigiaFimDeJornada que o AppShell tem: é ele que pergunta
// "ainda está trabalhando?" no fim do expediente, e que cancela o `agendar-parada` quando a
// página volta. Com a janela sempre no topo, o alerta passa a ser visto de verdade.
export function FlutuanteShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      {children}
      <VigiaFimDeJornada />
    </div>
  );
}
