import { useEffect, useState } from "react";

function formatarHHMMSS(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = Math.floor(segundos % 60);
  const par = (n: number) => String(n).padStart(2, "0");
  return `${par(h)}:${par(m)}:${par(s)}`;
}

// Cronômetro ao vivo da sessão em andamento — conta a partir de `inicioIso` (timestamp
// vindo do backend), atualizado a cada segundo no cliente. `null` = sem sessão aberta,
// não renderiza nada (quem usa decide o que mostrar nesse caso).
export function useCronometro(inicioIso: string | null): string | null {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!inicioIso) return;
    const intervalo = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(intervalo);
  }, [inicioIso]);

  if (!inicioIso) return null;
  const decorridoSegundos = Math.max(0, (agora - new Date(inicioIso).getTime()) / 1000);
  return formatarHHMMSS(decorridoSegundos);
}
