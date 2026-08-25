// Gauge semicircular (0-100%) via SVG cru — sem lib de gráfico nova, mesmo espírito de
// DonutChart.tsx (conic-gradient) e PrevistoRealizadoAcumuladoChart.tsx (SVG cru), mas nenhum
// dos dois cobria "semicírculo com marca de referência", por isso componente novo.
interface GaugeChartProps {
  titulo: string;
  /** 0-100. */
  valor: number;
  /** 0-100, opcional — marca de referência (linha reta cruzando o arco). */
  referencia?: number | null;
  formatarValor?: (valor: number) => string;
}

const RAIO = 90;
const CENTRO_X = 100;
const CENTRO_Y = 100;

// p em [0,100] -> ponto no arco, varrendo da esquerda (p=0) até a direita (p=100) por cima.
function pontoNoArco(p: number, raio: number) {
  const clamped = Math.min(100, Math.max(0, p));
  const theta = (clamped / 100) * Math.PI;
  return {
    x: CENTRO_X - raio * Math.cos(theta),
    y: CENTRO_Y - raio * Math.sin(theta),
  };
}

function arcoPath(pInicio: number, pFim: number, raio: number): string {
  const inicio = pontoNoArco(pInicio, raio);
  const fim = pontoNoArco(pFim, raio);
  const largeArc = pFim - pInicio > 50 ? 1 : 0;
  return `M ${inicio.x} ${inicio.y} A ${raio} ${raio} 0 ${largeArc} 1 ${fim.x} ${fim.y}`;
}

const formatarValorPadrao = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;

export function GaugeChart({ titulo, valor, referencia, formatarValor = formatarValorPadrao }: GaugeChartProps) {
  const marca = referencia != null ? pontoNoArco(referencia, RAIO) : null;
  const marcaInterna = referencia != null ? pontoNoArco(referencia, RAIO - 22) : null;

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted">{titulo}</p>
      <svg viewBox="0 0 200 125" className="w-full" role="img" aria-label={`${titulo}: ${formatarValor(valor)}`}>
        <path d={arcoPath(0, 100, RAIO)} fill="none" stroke="var(--muted)" strokeOpacity={0.25} strokeWidth={18} strokeLinecap="round" />
        <path d={arcoPath(0, valor, RAIO)} fill="none" stroke="var(--success)" strokeWidth={18} strokeLinecap="round" />
        {marca && marcaInterna && (
          <line x1={marcaInterna.x} y1={marcaInterna.y} x2={marca.x} y2={marca.y} stroke="var(--primary)" strokeWidth={3} strokeLinecap="round" />
        )}
        <text x={10} y={118} className="fill-muted" fontSize={9} textAnchor="start">
          0,00%
        </text>
        <text x={190} y={118} className="fill-muted" fontSize={9} textAnchor="end">
          100,00%
        </text>
        {referencia != null && marca && (
          <text
            x={marca.x}
            y={marca.y - 10}
            className="fill-primary"
            fontSize={10}
            fontWeight={600}
            textAnchor={referencia > 85 ? "end" : referencia < 15 ? "start" : "middle"}
          >
            {formatarValor(referencia)}
          </text>
        )}
        <text x={CENTRO_X} y={95} textAnchor="middle" className="fill-foreground font-mono font-semibold" fontSize={26}>
          {formatarValor(valor)}
        </text>
      </svg>
    </section>
  );
}
