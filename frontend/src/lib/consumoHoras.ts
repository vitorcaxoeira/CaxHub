// Escala de cor do consumo de horas (realizado sobre previsto). Mora aqui, e não no
// componente que a usa, porque duas telas dependem da MESMA leitura: o card do Quadro e o
// cabeçalho de grupo da Lista de Atividades. Se cada uma tivesse seu limiar, a mesma
// atividade apareceria "no limite" numa e "tranquila" na outra.

// A partir de quanto do previsto o consumo já é "alerta". O Cronograma não tem esse
// conceito — os alertas dele (estadoAlertaItem) são estouros booleanos do orçamento do
// item, sem noção de proximidade. 80% é a convenção usual de "chegando no limite".
export const LIMIAR_ALERTA_CONSUMO = 0.8;

// A barra e o percentual têm que contar a mesma história, por isso saem juntos daqui.
export function tomConsumo(avanco: number): { barra: string; texto: string } {
  if (avanco > 1) return { barra: "bg-destructive", texto: "font-semibold text-destructive" };
  if (avanco >= LIMIAR_ALERTA_CONSUMO) return { barra: "bg-warning", texto: "font-semibold text-warning" };
  return { barra: "bg-primary", texto: "" };
}
