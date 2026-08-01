import { useEffect, useState } from "react";

function formatarHHMMSS(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = Math.floor(segundos % 60);
  const par = (n: number) => String(n).padStart(2, "0");
  return `${par(h)}:${par(m)}:${par(s)}`;
}

export interface Cronometro {
  /** "HH:MM:SS" — congelado no limite depois que ele passa. `null` = sem sessão aberta. */
  texto: string | null;
  /** true a partir do instante em que o limite é atingido. */
  atingiuLimite: boolean;
}

// Cronômetro ao vivo da sessão em andamento — conta a partir de `inicioIso` (timestamp
// vindo do backend), atualizado a cada segundo no cliente.
//
// `limiteIso` é o instante em que a sessão precisa parar (teto de horas ou fim do
// expediente, ver backend/src/domain/limiteSessao.ts). Passando dele, o contador CONGELA:
// deixar correr mostraria um tempo que não vai ser apontado, que é justamente a confusão
// que o limite existe pra evitar. Quem consome decide o que fazer com `atingiuLimite` — a
// tela de Atividades usa pra pedir a baixa imediata em vez de esperar a varredura.
export function useCronometro(inicioIso: string | null, limiteIso?: string | null): Cronometro {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!inicioIso) return;
    const intervalo = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(intervalo);
  }, [inicioIso]);

  if (!inicioIso) return { texto: null, atingiuLimite: false };

  const inicio = new Date(inicioIso).getTime();
  const limite = limiteIso ? new Date(limiteIso).getTime() : null;
  const atingiuLimite = limite != null && agora >= limite;
  const referencia = atingiuLimite ? limite : agora;

  return { texto: formatarHHMMSS(Math.max(0, (referencia - inicio) / 1000)), atingiuLimite };
}
