import { useEffect, useState } from "react";
import { decorridoDaSessao } from "../lib/sessaoEmCurso";

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
  /**
   * Minutos já decorridos nesta sessão, para somar ao realizado consolidado na exibição.
   * Zero quando não há sessão aberta.
   *
   * O backend NÃO inclui a sessão aberta em `horasRealizadas` de propósito: aquele número
   * é a base de que o limite da sessão é calculado (`início + saldo`), e somar o tempo em
   * curso ali encurtaria o limite a cada segundo. Quem mostra é que soma.
   */
  decorridoMinutos: number;
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

  if (!inicioIso) return { texto: null, atingiuLimite: false, decorridoMinutos: 0 };

  const limite = limiteIso ? new Date(limiteIso).getTime() : null;
  const atingiuLimite = limite != null && agora >= limite;
  // Mesma regra de recorte do realizado exibido — ver lib/sessaoEmCurso.
  const decorridoMinutos = decorridoDaSessao(inicioIso, limiteIso, agora);

  return {
    texto: formatarHHMMSS(decorridoMinutos * 60),
    atingiuLimite,
    decorridoMinutos: Math.floor(decorridoMinutos),
  };
}
