export type Tone = "success" | "warning" | "destructive" | "neutral";

export const toneBadge: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

// Domínio "USU_LPriPro": 1=Alta/Urgente, 2=Média — o resto (baixa/nula) fica neutro.
export function priproTone(pripro: number | null): Tone {
  if (pripro === 1) return "destructive";
  if (pripro === 2) return "warning";
  return "neutral";
}
