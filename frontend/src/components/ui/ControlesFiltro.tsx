import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { CAIXA_CONTROLE, ICONE_CONTROLE } from "./estilos";

// Controles de filtro nativos (select, texto, data, caixa de marcação) na mesma moldura dos seletores de lista (03/11/2026): mesma altura,
// borda e foco, e o `acessorio` (a estrela de padrão do filtro) no canto superior direito. Sem acessório, o controle só fica no visual comum.

const ENTRADA =
  "h-full min-w-0 flex-1 rounded-md bg-surface text-base sm:text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70";

interface SelectFiltroProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  acessorio?: ReactNode;
  /** Classes da moldura (largura etc.). */
  className?: string;
}

export function SelectFiltro({ acessorio, className, children, ...resto }: SelectFiltroProps) {
  return (
    <div className={cn(CAIXA_CONTROLE, className)}>
      <select {...resto} className={cn(ENTRADA, "appearance-none pl-3", acessorio ? "pr-14" : "pr-8")}>
        {children}
      </select>
      <ChevronDown {...ICONE_CONTROLE} className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted", acessorio ? "right-8" : "right-3")} />
      {acessorio}
    </div>
  );
}

interface CampoFiltroProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  icone?: LucideIcon;
  acessorio?: ReactNode;
  /** Classes da moldura (largura etc.). */
  className?: string;
}

/** Campo de texto, número ou data. `icone` (ex.: Search) fica dentro, à esquerda. */
export function CampoFiltro({ icone: Icone, acessorio, className, ...resto }: CampoFiltroProps) {
  return (
    <div className={cn(CAIXA_CONTROLE, className)}>
      {Icone && <Icone {...ICONE_CONTROLE} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />}
      <input {...resto} className={cn(ENTRADA, Icone ? "pl-9" : "pl-3", acessorio ? "pr-8" : "pr-3")} />
      {acessorio}
    </div>
  );
}

interface CaixaMarcacaoFiltroProps {
  marcado: boolean;
  onChange: (marcado: boolean) => void;
  acessorio?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Caixa de marcação ("Só com saldo", "Só atrasadas"...) como um controle de filtro, com o rótulo clicável. */
export function CaixaMarcacaoFiltro({ marcado, onChange, acessorio, children, className }: CaixaMarcacaoFiltroProps) {
  return (
    <div className={cn(CAIXA_CONTROLE, className)}>
      <label className={cn("flex flex-1 cursor-pointer items-center gap-2 rounded-md pl-3 text-sm text-foreground", acessorio ? "pr-8" : "pr-3")}>
        <input type="checkbox" checked={marcado} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 shrink-0 accent-primary" />
        {children}
      </label>
      {acessorio}
    </div>
  );
}

interface MolduraFiltroProps {
  /** Rótulo curto antes do conteúdo (ex.: "Vencimento"). */
  rotulo?: string;
  acessorio?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Moldura para um grupo de campos que valem como UM filtro (ex.: par De/Até): um só padrão para o grupo. */
export function MolduraFiltro({ rotulo, acessorio, children, className }: MolduraFiltroProps) {
  return (
    // h-auto/min-h-9 + flex-wrap: no celular o grupo (ex.: Vencimento + duas datas) quebra de linha em vez de alargar a página.
    <div className={cn(CAIXA_CONTROLE, "h-auto min-h-9 max-w-full flex-wrap items-center gap-x-2 gap-y-1 py-1 pl-3 text-sm", acessorio ? "pr-8" : "pr-3", className)}>
      {rotulo && <span className="shrink-0 text-muted">{rotulo}</span>}
      {children}
      {acessorio}
    </div>
  );
}

/** Campo de data embutido numa MolduraFiltro (sem borda própria). */
export const DATA_EMBUTIDA =
  "h-7 min-w-0 rounded bg-transparent px-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface ParDatasFiltroProps {
  rotulo: string;
  de: string;
  ate: string;
  onDe: (valor: string) => void;
  onAte: (valor: string) => void;
  acessorio?: ReactNode;
}

/** Par De/Até de datas como UM filtro (ex.: Vencimento, Emissão), com um só padrão para as duas pontas. */
export function ParDatasFiltro({ rotulo, de, ate, onDe, onAte, acessorio }: ParDatasFiltroProps) {
  return (
    <MolduraFiltro rotulo={`${rotulo}:`} acessorio={acessorio}>
      <input type="date" aria-label={`${rotulo}, de`} className={DATA_EMBUTIDA} value={de} onChange={(e) => onDe(e.target.value)} />
      <span className="text-muted">até</span>
      <input type="date" aria-label={`${rotulo}, até`} className={DATA_EMBUTIDA} value={ate} onChange={(e) => onAte(e.target.value)} />
    </MolduraFiltro>
  );
}
