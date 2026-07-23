import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";

export type ToastTone = "success" | "warning" | "destructive" | "neutral";

interface ToastItem {
  id: number;
  mensagem: string;
  tone: ToastTone;
}

interface ToastContextValue {
  mostrar: (mensagem: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const corBorda: Record<ToastTone, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  destructive: "border-l-destructive",
  neutral: "border-l-primary",
};

const DURACAO_MS = 4500;

// Toast mínimo (não existia nenhum sistema de aviso transiente no projeto — só o sino
// de notificações in-app, que é outra coisa). Uso: envolver a árvore com
// `<ToastProvider>` uma vez (ver AppShell.tsx) e chamar `useToast().mostrar(...)` de
// qualquer tela filha.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const proximoId = useRef(1);

  const mostrar = useCallback((mensagem: string, tone: ToastTone = "neutral") => {
    const id = proximoId.current++;
    setToasts((atual) => [...atual, { id, mensagem, tone }]);
    setTimeout(() => {
      setToasts((atual) => atual.filter((t) => t.id !== id));
    }, DURACAO_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ mostrar }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto rounded-md border border-border border-l-4 bg-surface px-3 py-2.5 text-sm text-foreground shadow-lg ${corBorda[t.tone]}`}
          >
            {t.mensagem}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}
