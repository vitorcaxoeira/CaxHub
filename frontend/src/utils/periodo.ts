import { useCallback, useState } from "react";

// Período padrão dos filtros de data das telas financeiras. Mesma ideia (e mesmos rótulos) do campo
// "Período" do RH (components/rh/filtroStore.ts), com "Este mês" a mais, que é o padrão aqui.
// Datas LOCAIS (não toISOString, que é UTC e vira "amanhã" depois das 21h no Brasil).

export type PresetPeriodo = "mesAtual" | "mesAnterior" | "3m" | "6m" | "12m" | "ano" | "personalizado";

export const PRESETS_PERIODO: { valor: PresetPeriodo; rotulo: string }[] = [
  { valor: "mesAtual", rotulo: "Este mês" },
  { valor: "mesAnterior", rotulo: "Mês anterior" },
  { valor: "3m", rotulo: "Últimos 3 meses" },
  { valor: "6m", rotulo: "Últimos 6 meses" },
  { valor: "12m", rotulo: "Últimos 12 meses" },
  { valor: "ano", rotulo: "Este ano" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

function iso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function periodoDoPreset(preset: PresetPeriodo, hoje = new Date()): { de: string; ate: string } {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const ate = iso(hoje);
  switch (preset) {
    case "mesAnterior": return { de: iso(new Date(ano, mes - 1, 1)), ate: iso(new Date(ano, mes, 0)) };
    case "3m": return { de: iso(new Date(ano, mes - 2, 1)), ate };
    case "6m": return { de: iso(new Date(ano, mes - 5, 1)), ate };
    case "12m": return { de: iso(new Date(ano, mes - 11, 1)), ate };
    case "ano": return { de: iso(new Date(ano, 0, 1)), ate };
    case "mesAtual":
    default: return { de: iso(new Date(ano, mes, 1)), ate };
  }
}

export interface PeriodoEstado {
  preset: PresetPeriodo;
  de: string;
  ate: string;
  aplicarPreset: (p: PresetPeriodo) => void;
  alterarDe: (valor: string) => void;
  alterarAte: (valor: string) => void;
  /** Põe um período inteiro (padrão salvo): "personalizado" com De/Até, ou um preset relativo (recalculado agora). */
  definir: (p: { preset: string; de?: string; ate?: string }) => void;
}

/**
 * Estado do período de uma tela: abre no preset informado, com De/Até já preenchidos. `inicial` (De e Até, AAAA-MM-DD) abre em
 * "Personalizado" com essas datas (ex.: vindo de outra tela pelo `?de=&ate=`); incompleto ou invertido, vale o preset.
 */
export function usePeriodo(presetInicial: PresetPeriodo = "mesAtual", inicial?: { de?: string | null; ate?: string | null }): PeriodoEstado {
  const [estado, setEstado] = useState(() => {
    const { de, ate } = inicial ?? {};
    const valido = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (valido(de) && valido(ate) && de <= ate) return { preset: "personalizado" as PresetPeriodo, de, ate };
    return { preset: presetInicial, ...periodoDoPreset(presetInicial) };
  });

  const aplicarPreset = useCallback((preset: PresetPeriodo) => {
    setEstado((atual) => (preset === "personalizado" ? { ...atual, preset } : { preset, ...periodoDoPreset(preset) }));
  }, []);
  // Editar uma data à mão vira "Personalizado". Campo apagado é ignorado (o período nunca fica aberto).
  const alterarDe = useCallback((valor: string) => {
    if (valor) setEstado((atual) => ({ ...atual, preset: "personalizado", de: valor }));
  }, []);
  const alterarAte = useCallback((valor: string) => {
    if (valor) setEstado((atual) => ({ ...atual, preset: "personalizado", ate: valor }));
  }, []);

  const definir = useCallback((p: { preset: string; de?: string; ate?: string }) => {
    if (p.preset === "personalizado") {
      if (p.de && p.ate) setEstado({ preset: "personalizado", de: p.de, ate: p.ate });
      return;
    }
    const preset = p.preset as PresetPeriodo;
    setEstado({ preset, ...periodoDoPreset(preset) });
  }, []);

  return { ...estado, aplicarPreset, alterarDe, alterarAte, definir };
}
