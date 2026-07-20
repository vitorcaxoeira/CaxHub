import axios from "axios";
import { useEffect, useRef, useState } from "react";

interface Notificacao {
  id: number;
  tipo: string;
  mensagem: string;
  lida: boolean;
  criadoEm: string;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Sem WebSocket ainda — atualiza por polling. 45s é suficiente pra uma notificação
// in-app não crítica (nada aqui depende de tempo real).
const INTERVALO_POLLING_MS = 45000;

export function NotificacoesSino() {
  const [open, setOpen] = useState(false);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  function carregar() {
    axios.get("/api/notificacoes").then(({ data }) => {
      setNotificacoes(data.notificacoes);
      setNaoLidas(data.naoLidas);
    });
  }

  useEffect(() => {
    carregar();
    const intervalo = setInterval(carregar, INTERVALO_POLLING_MS);
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function marcarLida(id: number) {
    await axios.patch(`/api/notificacoes/${id}/lida`);
    carregar();
  }

  async function marcarTodasLidas() {
    await axios.patch("/api/notificacoes/marcar-todas-lidas");
    carregar();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Notificações"
        className="relative flex items-center justify-center rounded-md border border-border p-2 text-muted transition hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {naoLidas > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-mono text-[9.5px] font-semibold text-destructive-foreground">
            {naoLidas > 9 ? "9+" : naoLidas}
          </span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-80 rounded-md border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-foreground">Notificações</p>
            {naoLidas > 0 && (
              <button onClick={marcarTodasLidas} className="text-[11px] text-primary hover:underline">
                Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notificacoes.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.lida && marcarLida(n.id)}
                className={`block w-full border-b border-border/60 px-3 py-2 text-left text-sm transition hover:bg-surface-2 ${
                  n.lida ? "text-muted" : "text-foreground"
                }`}
              >
                <div className="flex items-start gap-2">
                  {!n.lida && <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-primary" />}
                  <span className={n.lida ? "" : "flex-1"}>{n.mensagem}</span>
                </div>
                <p className="mt-1 text-[10.5px] text-muted">{dateTimeFormatter.format(new Date(n.criadoEm))}</p>
              </button>
            ))}
            {notificacoes.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-muted">Sem notificações.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
