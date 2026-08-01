// Tempo já decorrido numa sessão de execução aberta, em minutos.
//
// Regra única de três consumidores: o cronômetro do card (que mostra em segundos), o
// realizado exibido do card e o da lista (que somam em minutos). Se cada um recortasse
// por conta própria, o cronômetro congelaria numa hora e o realizado continuaria subindo.
//
// O recorte no limite é o ponto: passando dele, o tempo PARA de contar. Deixar correr
// mostraria um tempo que não vai ser apontado — a sessão vai ser fechada no limite, não
// agora (ver backend/src/domain/limiteSessao.ts).
export function decorridoDaSessao(inicioIso: string | null, limiteIso: string | null | undefined, agora: number): number {
  if (!inicioIso) return 0;
  const inicio = new Date(inicioIso).getTime();
  const limite = limiteIso ? new Date(limiteIso).getTime() : null;
  const referencia = limite != null && agora >= limite ? limite : agora;
  return Math.max(0, (referencia - inicio) / 60_000);
}

// Realizado que a TELA mostra = o consolidado que veio do backend + o que está correndo
// agora.
//
// O backend não inclui a sessão aberta em `horasRealizadas` de propósito: aquele número é
// a base de que o limite da sessão é calculado (`início + saldo`), e somar o tempo em
// curso ali encurtaria o limite a cada segundo. Quem exibe é que soma.
export function realizadoExibido(
  linha: { horasRealizadas: number; sessaoAtualInicio: string | null; sessaoLimite: string | null },
  agora: number
): number {
  return linha.horasRealizadas + Math.floor(decorridoDaSessao(linha.sessaoAtualInicio, linha.sessaoLimite, agora));
}
