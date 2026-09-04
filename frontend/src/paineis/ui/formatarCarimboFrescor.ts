// Formata o carimbo "dados de HH:mm" que PainelMoldura mostra pros painéis cuja origem
// pode ficar defasada (dominioSync != null) — hora de parede de São Paulo, nunca UTC
// (mesmo cuidado de mensagemFimCortado no backend: o servidor pode rodar em fuso
// diferente do time que está lendo a TV).
export function formatarCarimboFrescor(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}
