import axios from "axios";
import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { cn } from "../../lib/cn";
import { MESES_CURTOS, Unidade, fmtResumo } from "../../lib/metasComercial";

export const mensagemDe = (e: unknown, padrao: string) => (axios.isAxiosError(e) ? e.response?.data?.error ?? padrao : padrao);

export const campo =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
/** Campo que se ajusta ao texto (seletores): `campo` traz w-full, então o conflito é resolvido pelo cn/twMerge, não concatenando classes. */
export const campoAuto = cn(campo, "w-auto");
export const botaoPrimario =
  "rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
export const botaoSecundario =
  "rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
export const botaoPerigo =
  "rounded-md border border-destructive/40 bg-surface px-3 py-1.5 text-[13px] font-medium text-destructive transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export function Cabecalho({ titulo, descricao, children }: { titulo: string; descricao: string; children?: ReactNode }) {
  return (
    <>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Comercial · Gestão de Metas</p>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-foreground">{titulo}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{descricao}</p>
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </>
  );
}

export function Aviso({ tom = "erro", children }: { tom?: "erro" | "info"; children: ReactNode }) {
  const cls = tom === "erro" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-surface-2 text-muted";
  return <p className={`mb-4 rounded-md border px-4 py-2 text-sm ${cls}`}>{children}</p>;
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Cartao({ titulo, nota, acao, children, className = "" }: { titulo?: string; nota?: ReactNode; acao?: ReactNode; children: ReactNode; className?: string }) {
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

// ---------------------------------------------------------------- anos

export interface AnoResumo {
  ano: number;
  participantes: number;
}

/** Anos cadastrados + o ano escolhido (na URL: ?ano=). Sem ?ano, o ano corrente se existir, senão o mais recente. */
export function useAnosMetas() {
  const [params, setParams] = useSearchParams();
  const [anos, setAnos] = useState<AnoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const recarregarAnos = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let cancelado = false;
    axios
      .get<{ anos: AnoResumo[] }>("/api/metas-comercial/anos")
      .then(({ data }) => !cancelado && setAnos(data.anos))
      .catch((e) => !cancelado && setErro(mensagemDe(e, "Não foi possível carregar os anos de metas.")));
    return () => {
      cancelado = true;
    };
  }, [recarga]);

  const pedido = Number(params.get("ano"));
  const corrente = new Date().getFullYear();
  const ano =
    anos == null ? null : anos.some((a) => a.ano === pedido) ? pedido : anos.some((a) => a.ano === corrente) ? corrente : anos[0]?.ano ?? null;

  const escolherAno = useCallback(
    (novo: number) =>
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.set("ano", String(novo));
        return n;
      }),
    [setParams]
  );

  return { anos, ano, escolherAno, recarregarAnos, erro };
}

export function SeletorAno({ anos, ano, onEscolher, onCriado }: { anos: AnoResumo[]; ano: number | null; onEscolher: (ano: number) => void; onCriado: () => void }) {
  const { mostrar } = useToast();
  const [aberto, setAberto] = useState(false);
  const [novoAno, setNovoAno] = useState("");
  const [copiarDe, setCopiarDe] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function abrir() {
    const maior = anos.reduce((m, a) => Math.max(m, a.ano), new Date().getFullYear() - 1);
    setNovoAno(String(maior + 1));
    setCopiarDe(anos.length > 0 ? String(Math.max(...anos.map((a) => a.ano))) : "");
    setErro(null);
    setAberto(true);
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    setGravando(true);
    setErro(null);
    try {
      const n = Number(novoAno);
      await axios.post("/api/metas-comercial/anos", { ano: n, copiarDe: copiarDe === "" ? undefined : Number(copiarDe) });
      mostrar(`Metas de ${n} criadas.`, "success");
      setAberto(false);
      onCriado();
      onEscolher(n);
    } catch (err) {
      setErro(mensagemDe(err, "Não foi possível criar o ano."));
    } finally {
      setGravando(false);
    }
  }

  return (
    <>
      <label htmlFor="metas-ano" className="sr-only">Ano</label>
      <select id="metas-ano" value={ano ?? ""} onChange={(e) => onEscolher(Number(e.target.value))} className={campoAuto}>
        {anos.map((a) => (
          <option key={a.ano} value={a.ano}>
            {a.ano}
          </option>
        ))}
      </select>
      <button type="button" onClick={abrir} className={botaoSecundario}>
        Novo ano
      </button>
      <Modal open={aberto} onClose={() => setAberto(false)} title="Novo ano de metas">
        <form onSubmit={criar} className="space-y-3 p-4">
          <div>
            <label htmlFor="na-ano" className="mb-1 block text-[13px] font-medium text-foreground">Ano</label>
            <input id="na-ano" inputMode="numeric" value={novoAno} onChange={(e) => setNovoAno(e.target.value)} className={campo} required autoFocus />
          </div>
          <div>
            <label htmlFor="na-copia" className="mb-1 block text-[13px] font-medium text-foreground">Copiar de</label>
            <select id="na-copia" value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)} className={campo}>
              <option value="">Começar do zero (pesos padrão da planilha)</option>
              {anos.map((a) => (
                <option key={a.ano} value={a.ano}>
                  {a.ano}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[12px] text-muted">Copia pesos, metas da empresa, pessoas e indicadores. Os lançamentos mensais não são copiados.</p>
          </div>
          {erro && <Aviso>{erro}</Aviso>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAberto(false)} className={botaoSecundario}>
              Cancelar
            </button>
            <button type="submit" disabled={gravando} className={botaoPrimario}>
              {gravando ? "Criando…" : "Criar"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- visual

/** Barra de atingimento. 100% = cheia e verde; passar de 100% mantém a barra cheia (o número diz quanto). */
export function BarraAtingimento({ valor, className = "" }: { valor: number | null; className?: string }) {
  const v = valor == null ? 0 : Math.max(0, Math.min(1, valor));
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full bg-border ${className}`} aria-hidden="true">
      <span className={`block h-full rounded-full ${valor != null && valor >= 1 ? "bg-success" : "bg-primary"}`} style={{ width: `${v * 100}%` }} />
    </span>
  );
}

export const tomDoAtingimento = (x: number | null): string => (x == null ? "text-muted" : x >= 1 ? "text-success" : "text-foreground");

interface PontoGrafico {
  mes: number;
  meta: number;
  realizado: number | null;
}

/** Meta × realizado acumulados mês a mês (SVG cru, sem biblioteca; o projeto não tem lib de gráfico). */
export function GraficoAcumulado({ pontos, unidade, titulo, legenda = ["Meta acumulada", "Realizado acumulado"] }: { pontos: PontoGrafico[]; unidade: Unidade; titulo: string; legenda?: [string, string] }) {
  const W = 640;
  const H = 220;
  const ML = 56;
  const MR = 12;
  const MT = 12;
  const MB = 26;
  const maximo = Math.max(1, ...pontos.map((p) => Math.max(p.meta, p.realizado ?? 0)));
  const x = (i: number) => ML + (i * (W - ML - MR)) / 11;
  const y = (v: number) => MT + (1 - v / maximo) * (H - MT - MB);
  const linha = (pega: (p: PontoGrafico) => number | null) => {
    let d = "";
    let aberto = false;
    pontos.forEach((p, i) => {
      const v = pega(p);
      if (v == null) {
        aberto = false;
        return;
      }
      d += `${aberto ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      aberto = true;
    });
    return d.trim();
  };
  const marcas = [0, 0.5, 1];
  return (
    <figure className="min-w-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={titulo}>
        {marcas.map((m) => (
          <g key={m}>
            <line x1={ML} x2={W - MR} y1={y(maximo * m)} y2={y(maximo * m)} className="stroke-border" strokeWidth="1" />
            <text x={ML - 6} y={y(maximo * m) + 3} textAnchor="end" className="fill-muted" fontSize="10">
              {fmtResumo(unidade, maximo * m).replace("R$ ", "")}
            </text>
          </g>
        ))}
        {pontos.map((p, i) => (
          <text key={p.mes} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted" fontSize="10">
            {MESES_CURTOS[i]}
          </text>
        ))}
        <path d={linha((p) => p.meta)} fill="none" className="stroke-muted" strokeWidth="2" strokeDasharray="5 4" />
        <path d={linha((p) => p.realizado)} fill="none" className="stroke-primary" strokeWidth="2.5" />
        {pontos.map((p, i) => p.realizado != null && <circle key={p.mes} cx={x(i)} cy={y(p.realizado)} r="3" className="fill-primary" />)}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-muted" /> {legenda[0]}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-primary" /> {legenda[1]}
        </span>
      </figcaption>
    </figure>
  );
}
