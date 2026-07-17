export interface AlertasComerciaisDados {
  estagnadas: { qtd: number; valor: number; tone: "warning" | "destructive" };
  enviadasSemRetorno: { qtd: number; valor: number };
  vencidas: { qtd: number; valor: number };
  paradasAbertura: { qtd: number; valor: number };
}

interface AlertasComerciaisProps {
  dados: AlertasComerciaisDados;
  alertaAtivo: string | null;
  onSelectAlerta: (alerta: string | null) => void;
  estagnadaDias: number;
  onEstagnadaDiasChange: (dias: number) => void;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

const toneBg: Record<string, string> = { warning: "bg-warning", destructive: "bg-destructive" };
const toneText: Record<string, string> = { warning: "text-warning", destructive: "text-destructive" };

// Alertas de ação — clicar filtra a listagem de propostas abaixo (drill-down via
// o parâmetro `alerta` do GET /propostas). Clicar de novo no mesmo card limpa o filtro.
export function AlertasComerciais({ dados, alertaAtivo, onSelectAlerta, estagnadaDias, onEstagnadaDiasChange }: AlertasComerciaisProps) {
  const cards = [
    {
      key: "estagnadas",
      label: "Propostas Estagnadas",
      qtd: dados.estagnadas.qtd,
      valor: dados.estagnadas.valor,
      tone: dados.estagnadas.tone,
    },
    { key: "enviadas_sem_retorno", label: "Enviadas sem Retorno", qtd: dados.enviadasSemRetorno.qtd, valor: dados.enviadasSemRetorno.valor, tone: "warning" as const },
    { key: "vencidas", label: "Vencidas", qtd: dados.vencidas.qtd, valor: dados.vencidas.valor, tone: "destructive" as const },
    { key: "paradas_abertura", label: "Paradas na Abertura", qtd: dados.paradasAbertura.qtd, valor: dados.paradasAbertura.valor, tone: "warning" as const },
  ];

  function handleClick(key: string) {
    onSelectAlerta(alertaAtivo === key ? null : key);
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Alertas de Ação</p>
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-muted">Estagnada há mais de</span>
          <input
            type="number"
            min={1}
            max={365}
            value={estagnadaDias}
            onChange={(e) => onEstagnadaDiasChange(Math.max(1, Math.min(365, Number(e.target.value) || 15)))}
            className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-[11.5px] text-muted">dias</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const ativo = alertaAtivo === card.key;
          return (
            <button
              key={card.key}
              onClick={() => handleClick(card.key)}
              className={`rounded-lg border p-5 text-left transition ${
                ativo ? "border-primary bg-surface ring-1 ring-primary" : "border-border bg-surface hover:bg-surface-2"
              }`}
            >
              <p className="mb-2 text-[11.5px] text-muted">{card.label}</p>
              <span className={`block font-mono text-2xl font-semibold tabular-nums ${card.qtd > 0 ? toneText[card.tone] : "text-foreground"}`}>
                {card.qtd.toLocaleString("pt-BR")}
              </span>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                <span className={`h-1.5 w-1.5 flex-none rounded-full ${card.qtd > 0 ? toneBg[card.tone] : "bg-muted"}`} />
                {fmtMoney(card.valor)}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
