// Parsers pequenos de query string reaproveitados por mais de uma rota — hoje o filtro de
// ano/mês da visão contábil (routes/contabil.ts) e o do Dashboard inicial (routes/dashboard.ts).
// Duas telas com o MESMO formato de parâmetro ("anos=2025,2026") não podem parsear cada uma
// do seu jeito, ou uma aceita algo que a outra rejeita silenciosamente.

// "2025,2026" -> [2025, 2026]. Ausente/vazio/só lixo -> null (quem chama decide o default).
export function parseIntListParam(value: unknown): number[] | null {
  if (typeof value !== "string" || value === "") return null;
  const items = value
    .split(",")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  return items.length > 0 ? items : null;
}
