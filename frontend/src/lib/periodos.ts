import { MultiSelectOption } from "../components/ui/MultiSelectDropdown";

// Opções fixas do filtro de mês — não vêm do backend (o domínio é sempre 1-12). Compartilhada
// entre a visão contábil (ResultadoAnalitico.tsx) e o filtro de período do Dashboard inicial
// (Home.tsx) — duas telas com o mesmo filtro "ano × mês" não podem ter listas de mês diferentes.
export const MESES_OPCOES: MultiSelectOption<number>[] = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];

const MESES_ABREVIADOS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

// "Ago/2026" — rótulo curto de um combo ano×mês, usado no cabeçalho do Dashboard inicial pra
// dizer qual período está sendo exibido.
export function rotuloMesAno(ano: number, mes: number): string {
  return `${MESES_ABREVIADOS[mes - 1] ?? mes}/${ano}`;
}
