import { ReactNode, useState } from "react";
import { useToast } from "../ui/Toast";
import { Tom, pct, tomChip, tomFundo, tomTexto } from "../../lib/eficiencia";

export function Cartao({
  titulo,
  nota,
  acao,
  children,
  className = "",
}: {
  titulo?: string;
  nota?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-lg border border-border bg-surface p-5 ${className}`}>
      {(titulo || acao) && (
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {titulo && <h2 className="font-display text-[15px] font-semibold text-foreground">{titulo}</h2>}
          {nota && <span className="text-[12px] text-muted">{nota}</span>}
          {acao}
        </header>
      )}
      {children}
    </section>
  );
}

interface IndicadorProps {
  rotulo: string;
  valor: ReactNode;
  sub?: ReactNode;
  tom?: Tom;
  /** 0..1 — barra de progresso embaixo do valor. */
  medidor?: number;
  dica?: string;
  onClick?: () => void;
}

// Bloco de indicador do resumo executivo: rótulo, valor grande, medidor opcional e uma linha de apoio.
export function Indicador({ rotulo, valor, sub, tom, medidor, dica, onClick }: IndicadorProps) {
  const corpo = (
    <>
      <span className="block truncate font-mono text-[10px] font-medium uppercase tracking-wider text-muted">{rotulo}</span>
      <span className={`mt-1 block font-mono text-[22px] font-semibold leading-tight tabular-nums ${tom ? tomTexto[tom] : "text-foreground"}`}>
        {valor}
      </span>
      {medidor != null && (
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-border">
          <span
            className={`block h-full rounded-full ${tom ? tomFundo[tom] : "bg-primary"}`}
            style={{ width: `${Math.max(0, Math.min(1, medidor)) * 100}%` }}
          />
        </span>
      )}
      {sub && <span className="mt-1.5 block truncate text-[12px] text-muted">{sub}</span>}
    </>
  );
  const classes = "min-w-0 rounded-md border border-transparent bg-surface-2/60 p-3 text-left";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title={dica}
      className={`${classes} transition hover:border-border hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {corpo}
    </button>
  ) : (
    <div className={classes} title={dica}>
      {corpo}
    </div>
  );
}

export function Chip({ tom, children }: { tom: Tom; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${tomChip[tom]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

// Barra de consumo na escala 0–150%: o traço marca os 100% (o vendido). Acima dele, vermelho.
export function BarraConsumo({ consumo }: { consumo: number | null }) {
  const c = Math.min(consumo ?? 1.5, 1.5);
  const dentro = (Math.min(c, 1) / 1.5) * 100;
  const acima = c > 1 ? ((c - 1) / 1.5) * 100 : 0;
  const perto = c > 0.8 && c <= 1;
  return (
    <span className="relative block h-2 min-w-[110px] rounded-full bg-surface-2" title={`Consumo: ${pct(consumo)}`}>
      <span className={`absolute inset-y-0 left-0 rounded-full ${perto ? "bg-warning" : "bg-primary/60"}`} style={{ width: `${dentro}%` }} />
      {acima > 0 && <span className="absolute inset-y-0 rounded-r-full bg-destructive" style={{ left: `${dentro}%`, width: `${acima}%` }} />}
      <span className="absolute -inset-y-0.5 w-px bg-muted" style={{ left: `${100 / 1.5}%` }} />
    </span>
  );
}

export type Ordem<K extends string> = { chave: K; dir: 1 | -1 };

export function Th<K extends string>({
  rotulo,
  chave,
  ordem,
  onOrdenar,
  numerico,
  className = "",
}: {
  rotulo: string;
  chave?: K;
  ordem?: Ordem<K>;
  onOrdenar?: (chave: K) => void;
  numerico?: boolean;
  className?: string;
}) {
  const ativo = chave != null && ordem?.chave === chave;
  const base = `sticky top-0 z-[1] whitespace-nowrap bg-surface-2 px-2.5 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted ${numerico ? "text-right" : "text-left"} ${className}`;
  if (!chave || !onOrdenar) return <th className={base}>{rotulo}</th>;
  return (
    <th className={base} aria-sort={ativo ? (ordem!.dir > 0 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onOrdenar(chave)} className="uppercase tracking-wider hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {rotulo}
        <span className={`ml-1 ${ativo ? "text-primary" : "opacity-0"}`}>{ordem?.dir === 1 && ativo ? "↑" : "↓"}</span>
      </button>
    </th>
  );
}

/** Alterna a ordenação: mesma coluna inverte, coluna nova começa pelo `inicial` (texto crescente, números decrescentes). */
export function proximaOrdem<K extends string>(atual: Ordem<K>, chave: K, textuais: K[] = []): Ordem<K> {
  if (atual.chave === chave) return { chave, dir: (atual.dir * -1) as 1 | -1 };
  return { chave, dir: textuais.includes(chave) ? 1 : -1 };
}

export function ordenar<T, K extends string>(linhas: T[], ordem: Ordem<K>, valor: (l: T, k: K) => number | string): T[] {
  return [...linhas].sort((a, b) => {
    const va = valor(a, ordem.chave);
    const vb = valor(b, ordem.chave);
    const r = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb), "pt-BR") : va - vb;
    return r * ordem.dir;
  });
}

export function BotaoCopiar({ montar, rotulo = "Copiar tabela" }: { montar: () => string; rotulo?: string }) {
  const { mostrar } = useToast();
  const [copiando, setCopiando] = useState(false);
  async function copiar() {
    setCopiando(true);
    try {
      await navigator.clipboard.writeText(montar());
      mostrar("Tabela copiada. Cole no Excel ou no Teams.", "success");
    } catch {
      mostrar("Não foi possível copiar. Verifique a permissão do navegador.", "destructive");
    } finally {
      setCopiando(false);
    }
  }
  return (
    <button
      type="button"
      onClick={copiar}
      disabled={copiando}
      className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      {rotulo}
    </button>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

/** Cabeça de tabela rolável: o contêiner limita a altura e o `Th` fica colado no topo. */
export function TabelaRolavel({ children, altura = "max-h-[68vh]" }: { children: ReactNode; altura?: string }) {
  return <div className={`overflow-auto rounded-md border border-border ${altura}`}>{children}</div>;
}
