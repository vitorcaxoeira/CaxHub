import { useEffect, useMemo, useRef, useState } from "react";
import { analisarFormula, type ColunaDisponivel, FUNCOES, type No } from "../../lib/formulas/formula";
import { cn } from "../../lib/cn";
import { Modal } from "../ui/Modal";
import { type ColunaCalculadaNova, type ColunaCalculadaSalva, type FormatoCalculada, formatarCalculada, ROTULO_FORMATO } from "./colunasCalculadas";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** Editando uma existente; sem ela, nova. */
  inicial?: ColunaCalculadaSalva;
  /** Colunas da lista que entram em fórmula. */
  disponiveis: ColunaDisponivel[];
  /** A fórmula nas primeiras linhas da lista (prévia ao vivo). */
  previa?: (arvore: No) => (number | null)[];
  podePublicar: boolean;
  onSalvar: (dados: ColunaCalculadaNova) => Promise<void>;
}

const campo =
  "w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chip =
  "rounded border border-border bg-surface-2/60 px-1.5 py-0.5 text-[11.5px] text-foreground transition hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Editor de coluna calculada (28/10/2026): título, fórmula (com botões que inserem colunas e funções na posição do cursor), erro em
 * português com a posição, prévia nas primeiras linhas, formato e, para admin/master, publicar para todos da lista.
 */
export function EditorColunaCalculada({ aberto, onFechar, inicial, disponiveis, previa, podePublicar, onSalvar }: Props) {
  const [titulo, setTitulo] = useState("");
  const [formula, setFormula] = useState("");
  const [formato, setFormato] = useState<FormatoCalculada>("numero");
  const [casas, setCasas] = useState(2);
  const [publicada, setPublicada] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!aberto) return;
    setTitulo(inicial?.titulo ?? "");
    setFormula(inicial?.formula ?? "");
    setFormato(inicial?.formato ?? "numero");
    setCasas(inicial?.casas ?? 2);
    setPublicada(inicial?.publicada ?? false);
    setErroServidor(null);
  }, [aberto, inicial]);

  const analise = useMemo(() => (formula.trim() ? analisarFormula(formula, disponiveis) : null), [formula, disponiveis]);
  const valoresPrevia = analise?.ok && previa ? previa(analise.arvore) : null;
  const colunasDaLista = disponiveis.filter((c) => c.tipo !== "texto");

  /** Insere no cursor (ou no fim) e devolve o foco à fórmula, com o cursor logo depois do que entrou. */
  const inserir = (texto: string) => {
    const el = area.current;
    const ini = el?.selectionStart ?? formula.length;
    const fim = el?.selectionEnd ?? formula.length;
    const novo = formula.slice(0, ini) + texto + formula.slice(fim);
    setFormula(novo);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + texto.length, ini + texto.length);
    });
  };

  const salvar = async () => {
    if (!analise?.ok || !titulo.trim()) return;
    setGravando(true);
    setErroServidor(null);
    try {
      await onSalvar({ titulo: titulo.trim(), formula: formula.trim(), arvore: analise.arvore, formato, casas, publicada });
      onFechar();
    } catch (e) {
      setErroServidor(e instanceof Error ? e.message : "Falha ao gravar");
    } finally {
      setGravando(false);
    }
  };

  return (
    <Modal open={aberto} onClose={onFechar} title={inicial ? "Editar coluna calculada" : "Nova coluna calculada"} subtitulo="Contas com as colunas da própria linha" className="max-w-2xl" fecharPorFora={false}>
      <div className="space-y-4">
        <label className="block text-[12px] text-muted">
          Título
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={60} placeholder="Ex.: Diferença %" className={cn(campo, "mt-1")} />
        </label>

        <div>
          <label className="block text-[12px] text-muted" htmlFor="formula-calculada">
            Fórmula
          </label>
          <textarea
            id="formula-calculada"
            ref={area}
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            rows={3}
            maxLength={500}
            spellCheck={false}
            placeholder="([Consumo ERP] - [Quantidade Plannix]) / [Consumo ERP] * 100"
            className={cn(campo, "mt-1 resize-y font-mono", analise && !analise.ok && "border-destructive")}
          />
          <p className={cn("mt-1 min-h-[1.25rem] text-[12px]", analise && !analise.ok ? "text-destructive" : "text-muted")}>
            {!analise
              ? "Use + − * / ^, parênteses, vírgula decimal (1,5) e ; entre argumentos. Vazio na conta dá vazio; divisão por zero dá vazio."
              : analise.ok
                ? valoresPrevia && valoresPrevia.length
                  ? `Prévia nas primeiras linhas: ${valoresPrevia.map((v) => formatarCalculada(v, formato, casas)).join(" · ")}`
                  : "Fórmula válida."
                : `${analise.erro}${analise.posicao !== null ? ` (posição ${analise.posicao + 1})` : ""}`}
          </p>
        </div>

        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">Colunas (clique para inserir)</p>
          <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {colunasDaLista.map((c) => (
              <button key={c.nome} type="button" className={chip} onClick={() => inserir(`[${c.titulo}]`)} title={c.tipo === "data" ? "Data: só dentro de DIAS" : undefined}>
                {c.titulo}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">Funções</p>
          <div className="flex flex-wrap gap-1">
            {FUNCOES.map((f) => (
              <button key={f.nome} type="button" className={cn(chip, "font-mono")} onClick={() => inserir(`${f.nome}(`)} title={`${f.assinatura}: ${f.descricao}`}>
                {f.nome}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="text-[12px] text-muted">
            Formato
            <select value={formato} onChange={(e) => setFormato(e.target.value as FormatoCalculada)} className={cn(campo, "mt-1 w-44")}>
              {(Object.keys(ROTULO_FORMATO) as FormatoCalculada[]).map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FORMATO[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-muted">
            Casas decimais
            <select value={casas} onChange={(e) => setCasas(Number(e.target.value))} className={cn(campo, "mt-1 w-24")}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {podePublicar && (
            <label className="flex items-center gap-2 pb-2 text-sm text-foreground" title="Todos os usuários passam a ver esta coluna nesta lista">
              <input type="checkbox" checked={publicada} onChange={(e) => setPublicada(e.target.checked)} className="accent-primary" />
              Publicar para todos
            </label>
          )}
        </div>

        {erroServidor && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erroServidor}</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onFechar} className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-surface-2">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={!analise?.ok || !titulo.trim() || gravando}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {gravando ? "Gravando..." : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
