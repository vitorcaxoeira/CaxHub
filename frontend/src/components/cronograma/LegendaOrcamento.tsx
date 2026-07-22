// Legenda das cores usadas no bloco de orçamento do item — discreta, some no mobile
// (onde já não sobra espaço nem pro texto de saldo, ver OrcamentoItemLinha).
export function LegendaOrcamento({ className = "" }: { className?: string }) {
  const itens: { label: string; className: string }[] = [
    { label: "Realizado", className: "bg-primary" },
    { label: "Distribuído", className: "bg-primary/25" },
    { label: "Contratado", className: "border border-border bg-surface-2" },
  ];

  return (
    <div className={`hidden items-center gap-4 font-mono text-[10.5px] text-muted sm:flex ${className}`}>
      {itens.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={`inline-block h-[5px] w-[18px] rounded-full ${item.className}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
