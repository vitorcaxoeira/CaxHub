import type { CSSProperties } from "react";
import { cn } from "../../lib/cn";
import { Skeleton } from "../ui/Skeleton";
import { type FuncaoResumo, formatarResumo, funcoesDaColuna, NA_UNIDADE_DA_COLUNA, ROTULO_RESUMO, type TipoResumo } from "./resumo";

interface Props {
  titulo: string;
  tipo: TipoResumo | undefined;
  /** Funções que a coluna oferece (limita as do tipo). */
  permitidas?: FuncaoResumo[];
  funcao: FuncaoResumo | undefined;
  onEscolher: (funcao: FuncaoResumo | null) => void;
  valor: number | string | null | undefined;
  carregando: boolean;
  erro?: string | null;
  direita?: boolean;
  /** Classes a mais no `<td>` (ex.: a coluna congelada, parada à esquerda). */
  className?: string;
  /** Estilo do `<td>` (ex.: o `left` da coluna parada). */
  style?: CSSProperties;
  formatar?: (v: number) => string;
  /** Aviso ao lado de soma/média/... (ex.: unidades misturadas). */
  aviso?: string;
}

/** Uma célula do rodapé de resumo: o valor (quando há função escolhida) e, embaixo, a escolha da função, discreta. */
export function CelulaResumo({ titulo, tipo, permitidas, funcao, onEscolher, valor, carregando, erro, direita, formatar, aviso, className, style }: Props) {
  const funcoes = funcoesDaColuna(tipo, permitidas);
  if (!funcoes.length) return <td className={cn("px-[7px] py-1.5", className)} style={style} />;
  const escolhida = funcao && funcoes.includes(funcao) ? funcao : undefined;
  return (
    <td className={cn("px-[7px] py-1.5 align-top", direita ? "text-right" : "text-left", className)} style={style}>
      <div className={cn("flex flex-col gap-0.5", direita ? "items-end" : "items-start")}>
        {escolhida &&
          (carregando ? (
            <Skeleton className="h-4 w-16" />
          ) : (
            <span className="whitespace-nowrap font-mono text-[12.5px] font-semibold tabular-nums text-foreground" title={erro ?? `${ROTULO_RESUMO[escolhida]} de ${titulo}`}>
              {erro ? "—" : formatarResumo(valor ?? null, escolhida, tipo ?? "decimal", formatar)}
              {aviso && NA_UNIDADE_DA_COLUNA.has(escolhida) && (
                <span className="ml-1 cursor-help text-warning" title={aviso}>
                  ⚠
                </span>
              )}
            </span>
          ))}
        <select
          aria-label={`Resumo da coluna ${titulo}`}
          title={`Resumo da coluna ${titulo}, sobre todas as linhas do filtro`}
          value={escolhida ?? ""}
          onChange={(e) => onEscolher((e.target.value || null) as FuncaoResumo | null)}
          className={cn(
            "max-w-full cursor-pointer appearance-none truncate rounded bg-transparent px-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted transition hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            direita && "text-right",
          )}
        >
          <option value="">{escolhida ? "sem resumo" : "Σ resumo"}</option>
          {funcoes.map((f) => (
            <option key={f} value={f}>
              {ROTULO_RESUMO[f]}
            </option>
          ))}
        </select>
      </div>
    </td>
  );
}
