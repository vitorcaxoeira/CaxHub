import { useMemo, type ReactNode } from "react";
import { MultiSelectDropdown } from "../ui/MultiSelectDropdown";

export interface ContaOption {
  codemp: number;
  numcco: string;
  descco: string;
}

interface ContaFilterProps {
  opcoes: ContaOption[];
  selecionados: string[];
  onChange: (selecionados: string[]) => void;
  /** Botão no canto do campo (a estrela de padrão do filtro). */
  acessorio?: ReactNode;
}

// A mesma chave pode vir de mais de uma empresa: a lista mostra uma vez (o valor selecionado é a chave).
function unicos<T extends string | number>(opcoes: { value: T; label: string }[]) {
  const vistos = new Set<T>();
  return opcoes.filter((o) => (vistos.has(o.value) ? false : (vistos.add(o.value), true)));
}

export function ContaFilter({ opcoes, selecionados, onChange, acessorio }: ContaFilterProps) {
  const lista = useMemo(() => unicos(opcoes.map((o) => ({ value: o.numcco, label: o.descco }))), [opcoes]);
  return (
    <MultiSelectDropdown
      opcoes={lista}
      selecionados={selecionados}
      onChange={onChange}
      labelTodos="Todas as contas"
      labelSufixo="contas"
      acessorio={acessorio}
    />
  );
}
