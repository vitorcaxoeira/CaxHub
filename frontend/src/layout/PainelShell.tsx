import axios from "axios";
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext";
import type { ItemRotacaoPainel } from "../hooks/useRotacaoPainel";

// ---------------------------------------------------------------------------
// Shell do Modo Painel/TV — o INVERSO do AppShell: sem Sidebar, sem Topbar, sem
// o max-w-7xl do <main> normal (aqui a TV é o viewport inteiro) e sem
// <VigiaFimDeJornada/> (modal pessoal de fim de jornada não pode aparecer num
// telão de recepção). Aplica o zoom e o tema da config da TV — não lê o toggle
// de tema do navegador, fixa o que o admin configurou.
// ---------------------------------------------------------------------------

export interface PainelShellContext {
  itens: ItemRotacaoPainel[];
}

// Hora local (0-23) em que a TV recarrega a página sozinha — depois da janela do cron
// noturno (03:00-06:15), pra descartar qualquer vazamento de memória acumulado num
// processo que fica meses no ar sem F5 manual. Seguro barato, não crítico.
const HORA_RECARGA_DIARIA = 4;

export function PainelShell() {
  const { setTheme } = useTheme();
  const [config, setConfig] = useState<{ zoom: number; itens: ItemRotacaoPainel[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get("/api/painel-tv/rotacao")
      .then(({ data }) => {
        setTheme(data.tv.tema === "light" ? "light" : "dark");
        setConfig({ zoom: Number(data.tv.zoom) || 1, itens: data.itens });
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a configuração desta TV"));
  }, [setTheme]);

  // Cursor não serve pra nada numa TV sem mouse, só distrai (fica parado no centro
  // ou num canto, brilhando enquanto nada muda).
  useEffect(() => {
    const anterior = document.body.style.cursor;
    document.body.style.cursor = "none";
    return () => {
      document.body.style.cursor = anterior;
    };
  }, []);

  useEffect(() => {
    function verificarRecarga() {
      if (new Date().getHours() === HORA_RECARGA_DIARIA) window.location.reload();
    }
    const id = window.setInterval(verificarRecarga, 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  if (erro) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-16 text-center">
        <p className="font-mono text-3xl text-muted">{erro}</p>
      </div>
    );
  }

  if (!config) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  return (
    <div className="min-h-screen w-full overflow-hidden bg-background" style={{ zoom: config.zoom }}>
      <Outlet context={{ itens: config.itens } satisfies PainelShellContext} />
    </div>
  );
}
