import { AgingDashboard } from "../../components/financeiro/AgingDashboard";

const KPIS = [
  { label: "Total em aberto", value: "R$ 268.940,00", sub: "97 títulos · 22 fornecedores", tone: "neutral" as const },
  { label: "Vencido", value: "R$ 52.310,00", sub: "19% da carteira", tone: "destructive" as const },
  { label: "Prazo médio de pagamento", value: "33 dias", sub: "-3 dias vs. mês anterior", tone: "success" as const },
];

const BUCKETS = [
  { key: "aVencer", label: "A vencer", pct: 61, valor: "164.050,00", tone: "success" as const },
  { key: "d1_30", label: "1–30 dias", pct: 20, valor: "53.780,00", tone: "warning" as const },
  { key: "d31_60", label: "31–60 dias", pct: 12, valor: "32.270,00", tone: "warning" as const },
  { key: "d60", label: "60+ dias", pct: 7, valor: "18.840,00", tone: "destructive" as const },
];

const ROWS = [
  { nome: "Transportadora Vale Sul", doc: "NF 9.812 · 1/1", data: "20/07/2026", valor: "15.400,00", situacao: "A vencer", tone: "success" as const },
  { nome: "Metalúrgica Progresso", doc: "NF 9.775 · 2/2", data: "05/07/2026", valor: "8.230,00", situacao: "8 dias", tone: "warning" as const },
  { nome: "Embalagens Rio do Sul", doc: "NF 9.740 · 1/3", data: "22/06/2026", valor: "22.900,00", situacao: "22 dias", tone: "warning" as const },
  { nome: "Distribuidora Alto Vale", doc: "NF 9.688 · 1/1", data: "28/05/2026", valor: "18.840,00", situacao: "57 dias", tone: "destructive" as const },
  { nome: "Papelaria Central", doc: "NF 9.820 · 1/1", data: "31/07/2026", valor: "3.150,00", situacao: "A vencer", tone: "success" as const },
];

const toneTag: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

export function ContasPagar() {
  return (
    <div>
      <AgingDashboard
        eyebrow="Financeiro · Contas a Pagar"
        title="Carteira em aberto"
        subtitle="Dados de exemplo — ainda não sincronizamos as tabelas de Contas a Pagar do Senior ERP."
        dataLabel="Aging da carteira"
        kpis={KPIS}
        buckets={BUCKETS}
      />

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Fornecedor
                </th>
                <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                  Vencimento
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Valor
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Situação
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.doc} className="border-t border-border/60 transition hover:bg-surface-2">
                  <td className="px-5 py-3.5">
                    <div className="text-sm font-semibold text-foreground">{row.nome}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted">{row.doc}</div>
                  </td>
                  <td className="hidden px-5 py-3.5 font-mono text-sm text-muted sm:table-cell">{row.data}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                    R$ {row.valor}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${toneTag[row.tone]}`}>
                      {row.situacao}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
