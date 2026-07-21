// Só suporta o padrão "minuto hora * * *" (horário fixo diário) — é o único formato
// usado pelos jobs de sync hoje. Se algum dia um job precisar de uma expressão cron
// mais complexa, trocar por uma lib de parsing (ex: cron-parser) em vez de estender isto.
export function proximaExecucao(cronExpr: string, agora: Date = new Date()): Date {
  const [minStr, hourStr] = cronExpr.split(" ");
  const min = Number(minStr);
  const hour = Number(hourStr);
  const proxima = new Date(agora);
  proxima.setHours(hour, min, 0, 0);
  if (proxima.getTime() <= agora.getTime()) {
    proxima.setDate(proxima.getDate() + 1);
  }
  return proxima;
}
