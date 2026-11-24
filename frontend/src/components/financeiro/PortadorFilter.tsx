import { useMemo, type ReactNode } from "react";
import { MultiSelectDropdown } from "../ui/MultiSelectDropdown";

export interface PortadorOption {
  codemp: number;
  codpor: string;
  despor: string;
}

interface PortadorFilterProps {
  opcoes: PortadorOption[];
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

export function PortadorFilter({ opcoes, selecionados, onChange, acessorio }: PortadorFilterProps) {
  const lista = useMemo(() => unicos(opcoes.map((o) => ({ value: o.codpor, label: o.despor }))), [opcoes]);
  return (
    <MultiSelectDropdown
      opcoes={lista}
      selecionados={selecionados}
      onChange={onChange}
      labelTodos="Todos os portadores"
      labelSufixo="portadores"
      acessorio={acessorio}
    />
  );
}
