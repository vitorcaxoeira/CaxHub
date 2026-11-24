import type { ReactNode } from "react";
import { MultiSelectDropdown } from "../ui/MultiSelectDropdown";

export const SITUACOES = [
  { value: "AB_VENCER", label: "A Vencer" },
  { value: "AB_VENCIDO", label: "Vencido" },
  { value: "AP", label: "Aberto Protestado" },
  { value: "CO", label: "Aberto Cobrança" },
  { value: "LQ", label: "Liquidado Normal" },
  { value: "CA", label: "Cancelado" },
];

interface SituacaoFilterProps {
  selecionados: string[];
  onChange: (selecionados: string[]) => void;
  /** Botão no canto do campo (a estrela de padrão do filtro). */
  acessorio?: ReactNode;
}

export function SituacaoFilter({ selecionados, onChange, acessorio }: SituacaoFilterProps) {
  return (
    <MultiSelectDropdown
      opcoes={SITUACOES}
      selecionados={selecionados}
      onChange={onChange}
      labelTodos="Todas as situações"
      labelSufixo="situações"
      acessorio={acessorio}
    />
  );
}
