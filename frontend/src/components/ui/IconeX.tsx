// Ícone de "X" compartilhado — botão de limpar busca, remover chip/tag etc. SVG inline,
// mesma convenção do resto do projeto (nenhuma lib de ícone instalada).
export function IconeX({ tamanho = 10 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
