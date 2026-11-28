import { MAX_DESCRICAO, MIN_DESCRICAO, erroDeDescricao, textoDaDescricao } from "../../lib/descricao-apontamento";

interface CampoDescricaoApontamentoProps {
  valor: string;
  onChange: (texto: string) => void;
  /** Descrição da atividade: mostrada só como INFORMAÇÃO, no bloco acima do campo. Nunca preenche o campo. */
  descricaoAtividade?: string | null;
  /** Descrição do item da proposta: não é mostrada, mas o texto também não pode repeti-la. */
  itemDescricao?: string | null;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Texto de exemplo. O padrão fala com quem executou; troque quando quem escreve é outra pessoa. */
  placeholder?: string;
  /** Ctrl/⌘ + Enter — só dispara com a descrição válida. */
  onAtalhoSalvar?: () => void;
}

/** Campo de descrição de apontamento: o MESMO em todo lugar em que se informa o que foi (ou está sendo) feito. */
export function CampoDescricaoApontamento({
  valor,
  onChange,
  descricaoAtividade,
  itemDescricao,
  rows = 4,
  autoFocus,
  disabled,
  onAtalhoSalvar,
  placeholder = "Descreva com as suas palavras o que você realizou...",
}: CampoDescricaoApontamentoProps) {
  const erro = erroDeDescricao(valor, [descricaoAtividade, itemDescricao]);
  const tamanho = textoDaDescricao(valor).length;
  const vazio = tamanho === 0;
  return (
    <div className="space-y-2">
      {descricaoAtividade && (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Atividade</p>
          <p className="mt-0.5 max-h-20 overflow-y-auto whitespace-pre-line text-[12.5px] leading-snug text-foreground">{descricaoAtividade}</p>
        </div>
      )}
      <textarea
        autoFocus={autoFocus}
        disabled={disabled}
        value={valor}
        maxLength={MAX_DESCRICAO}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !erro) onAtalhoSalvar?.();
        }}
        aria-label="Descrição do que foi realizado"
        placeholder={placeholder}
        className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      <div className="flex items-start justify-between gap-3 text-[11.5px] leading-snug">
        <p className={vazio || !erro ? "text-muted" : "text-destructive"} aria-live="polite">
          {vazio ? `Obrigatório: no mínimo ${MIN_DESCRICAO} caracteres, diferente da descrição da atividade.` : (erro ?? "")}
        </p>
        <span className={`flex-none font-mono tabular-nums ${erro ? "text-muted" : "text-success"}`}>
          {tamanho}/{tamanho < MIN_DESCRICAO ? MIN_DESCRICAO : MAX_DESCRICAO}
        </span>
      </div>
    </div>
  );
}
