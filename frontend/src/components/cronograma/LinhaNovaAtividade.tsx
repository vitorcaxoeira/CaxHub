import { useEffect, useRef, useState } from "react";

interface LinhaNovaAtividadeProps {
  pastaNome: string;
  profundidade: number;
  onCriar: (nome: string) => Promise<void>;
  abrirAutomaticamente?: boolean;
  onAbriu?: () => void;
}

export function LinhaNovaAtividade({ pastaNome, profundidade, onCriar, abrirAutomaticamente, onAbriu }: LinhaNovaAtividadeProps) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const paddingEsquerda = 14 + (profundidade + 1) * 24;

  useEffect(() => {
    if (abrirAutomaticamente) {
      setEditando(true);
      requestAnimationFrame(() => inputRef.current?.focus());
      onAbriu?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirAutomaticamente]);

  async function salvar() {
    const nome = valor.trim();
    if (nome === "") {
      setEditando(false);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await onCriar(nome);
      setValor("");
      // Mantém aberto pra próxima atividade (Enter salva e abre a próxima).
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!editando) {
    return (
      <button
        onClick={() => setEditando(true)}
        className="flex min-h-8 w-full items-center gap-2 border-b border-border/50 py-1.5 pr-3 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        style={{ paddingLeft: paddingEsquerda }}
      >
        ＋ Nova atividade em {pastaNome}…
      </button>
    );
  }

  return (
    <div className="border-b border-border/50 py-1.5 pr-3" style={{ paddingLeft: paddingEsquerda }}>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={valor}
          disabled={salvando}
          placeholder="Nome da atividade"
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") {
              setEditando(false);
              setValor("");
              setErro(null);
            }
          }}
          onBlur={() => {
            if (valor.trim() === "") setEditando(false);
          }}
          className="w-full max-w-sm rounded-md border border-primary/40 bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {erro && <p className="mt-1 text-[11px] text-destructive">{erro}</p>}
    </div>
  );
}
