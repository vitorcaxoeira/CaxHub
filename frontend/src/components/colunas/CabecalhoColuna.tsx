import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { FiltroColunaServidor, type ColunaComFiltro, type FiltroColuna, type RespostaValores } from "./FiltroColunaServidor";
import { type OrdemColuna, posicaoNaOrdem } from "./estadoColunas";

// Cabeçalho de coluna com ORDENAÇÃO e FILTRO (24/10/2026): o título é um botão (clique alterna crescente, decrescente e sem ordem;
// Shift+clique soma a coluna aos critérios, com o número da prioridade quando há mais de uma) e, ao lado, o funil com as abas Condição e
// Valores (FiltroColunaServidor). Vai DENTRO de um <th>; quem monta a tabela põe o `aria-sort` (ver ariaSort em estadoColunas.ts).

export interface FiltroDoCabecalho {
  coluna: ColunaComFiltro;
  /** Filtro ativo desta coluna, se houver. */
  atual: FiltroColuna | null;
  onAplicar: (filtro: FiltroColuna | null) => void;
  carregarValores: (termo: string) => Promise<RespostaValores>;
  formatarValor: (valor: unknown) => string;
}

interface Props {
  /** Nome da coluna como a API a conhece (o que vai em `?o=` e `?f=`). */
  nome: string;
  titulo: ReactNode;
  ordem: OrdemColuna[];
  /** Chamado ao clicar no título; `aditivo` = Shift. Sem ele, a coluna não é ordenável. */
  onOrdenar?: (nome: string, aditivo: boolean) => void;
  /** Sem ele, a coluna não tem funil. */
  filtro?: FiltroDoCabecalho | null;
  /** Texto de ajuda do título (ex.: "Chave"). */
  dica?: string;
}

function Seta({ direcao }: { direcao: "asc" | "desc" }) {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {direcao === "asc" ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
    </svg>
  );
}

export function CabecalhoColuna({ nome, titulo, ordem, onOrdenar, filtro, dica }: Props) {
  const pos = posicaoNaOrdem(ordem, nome);
  const rotuloOrdem = pos ? (pos.direcao === "asc" ? "crescente" : "decrescente") : null;
  return (
    <span className="inline-flex items-center gap-0.5 normal-case">
      {onOrdenar ? (
        <button
          type="button"
          onClick={(e) => onOrdenar(nome, e.shiftKey)}
          title={`${dica ? `${dica}. ` : ""}Clique para ordenar${rotuloOrdem ? ` (agora ${rotuloOrdem}${ordem.length > 1 ? `, critério ${pos!.prioridade}` : ""})` : ""}; Shift+clique soma outra coluna`}
          className={cn(
            "inline-flex items-center gap-1 rounded px-0.5 font-mono text-[10px] font-medium uppercase tracking-wider transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pos ? "text-primary" : "text-muted hover:text-foreground",
          )}
        >
          <span>{titulo}</span>
          {pos && (
            <span className="inline-flex items-center gap-px">
              <Seta direcao={pos.direcao} />
              {ordem.length > 1 && <span className="font-mono text-[8.5px] tabular-nums">{pos.prioridade}</span>}
            </span>
          )}
        </button>
      ) : (
        <span title={dica}>{titulo}</span>
      )}
      {filtro && filtro.coluna.operadores.length > 0 && (
        <FiltroColunaServidor coluna={filtro.coluna} filtro={filtro.atual} onAplicar={filtro.onAplicar} carregarValores={filtro.carregarValores} formatarValor={filtro.formatarValor} />
      )}
    </span>
  );
}
