// Barra de progresso fina reutilizada em vários lugares — 4px no cabeçalho da proposta,
// 3px embaixo de cada linha de atividade, e agora também no bloco de orçamento do item
// (múltiplas camadas sobrepostas, ver `camadas`). Só muda altura/cor/camadas via prop.
interface CamadaProgresso {
  // 0-1 — pode passar de 1 (estouro), mas a barra clampa em 100% da largura; o excesso
  // fica visível pela cor da camada, não por ela extrapolar o trilho.
  percentual: number;
  // Classe de fundo da camada (token semântico, ex.: "bg-primary", "bg-primary/30", "bg-warning").
  cor: string;
}

interface IndicadorProgressoProps {
  // Uso legado, uma camada só (a maioria dos casos hoje). Ignorado se `camadas` vier.
  avanco?: number;
  cor?: string;
  // Uso novo, múltiplas camadas ancoradas à esquerda sobre o mesmo trilho (ex.: bloco
  // de orçamento do item: distribuído atrás, realizado na frente).
  camadas?: CamadaProgresso[];
  // Traço divisor vertical numa posição fixa da barra — usado no estado "real acima do
  // previsto" pra marcar onde o distribuído termina, deixando visível o quanto o
  // realizado (camada da frente) já passou dele.
  marcador?: { percentual: number; cor: string };
  alturaPx?: number;
  className?: string;
}

export function IndicadorProgresso({ avanco, cor = "bg-primary", camadas, marcador, alturaPx = 4, className = "" }: IndicadorProgressoProps) {
  const trilhas: CamadaProgresso[] = camadas ?? (avanco != null ? [{ percentual: avanco, cor }] : []);
  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-surface-2 ${className}`} style={{ height: alturaPx }}>
      {trilhas.map((camada, i) => (
        <div
          key={i}
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] ${camada.cor}`}
          style={{ width: `${Math.max(0, Math.min(1, camada.percentual)) * 100}%` }}
        />
      ))}
      {marcador && (
        <div
          className={`absolute inset-y-0 w-px ${marcador.cor}`}
          style={{ left: `${Math.max(0, Math.min(1, marcador.percentual)) * 100}%` }}
        />
      )}
    </div>
  );
}
