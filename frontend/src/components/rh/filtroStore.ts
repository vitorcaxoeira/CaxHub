import { useSyncExternalStore } from "react";

// Filtro único das telas de RH. Fica em um store de módulo (e no localStorage) para que o recorte
// escolhido numa tela continue valendo ao trocar de tela: quem está olhando "Suporte Sapiens" em
// Turnover quer ver o mesmo recorte em Absenteísmo.

export type PresetPeriodo = "12m" | "6m" | "3m" | "ano" | "mesAnterior" | "personalizado";

export interface FiltroRhEstado {
  preset: PresetPeriodo;
  de: string;
  ate: string;
  empresa: number | null;
  filial: number | null;
  tipcol: number[];
  ccu: string | null;
  local: number | null;
  cargo: string | null;
}

const CHAVE = "caxhub.rh.filtro.v1";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export const PRESETS: { valor: PresetPeriodo; rotulo: string }[] = [
  { valor: "12m", rotulo: "Últimos 12 meses" },
  { valor: "6m", rotulo: "Últimos 6 meses" },
  { valor: "3m", rotulo: "Últimos 3 meses" },
  { valor: "ano", rotulo: "Este ano" },
  { valor: "mesAnterior", rotulo: "Mês anterior" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

export function periodoDoPreset(preset: PresetPeriodo, hoje = new Date()): { de: string; ate: string } {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  // Todas as datas em UTC meia-noite, para iso() não escorregar um dia no fuso do Brasil.
  const utc = (a: number, m: number, d: number) => new Date(Date.UTC(a, m, d));
  const hojeUtc = utc(ano, mes, hoje.getDate());
  switch (preset) {
    case "6m": return { de: iso(utc(ano, mes - 5, 1)), ate: iso(hojeUtc) };
    case "3m": return { de: iso(utc(ano, mes - 2, 1)), ate: iso(hojeUtc) };
    case "ano": return { de: iso(utc(ano, 0, 1)), ate: iso(hojeUtc) };
    case "mesAnterior": return { de: iso(utc(ano, mes - 1, 1)), ate: iso(utc(ano, mes, 0)) };
    case "12m":
    default: return { de: iso(utc(ano, mes - 11, 1)), ate: iso(hojeUtc) };
  }
}

function padrao(): FiltroRhEstado {
  return { preset: "12m", ...periodoDoPreset("12m"), empresa: null, filial: null, tipcol: [], ccu: null, local: null, cargo: null };
}

function carregar(): FiltroRhEstado {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return padrao();
    const salvo = JSON.parse(bruto) as Partial<FiltroRhEstado>;
    const base = padrao();
    const estado: FiltroRhEstado = { ...base, ...salvo };
    // Preset relativo ("12m") é recalculado a cada abertura: "últimos 12 meses" de ontem não é o de hoje.
    if (estado.preset !== "personalizado") Object.assign(estado, periodoDoPreset(estado.preset));
    return estado;
  } catch {
    return padrao();
  }
}

let estado: FiltroRhEstado = carregar();
const ouvintes = new Set<() => void>();

function publicar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(estado));
  } catch {
    // localStorage indisponível (navegação privada): o filtro só não persiste entre recargas.
  }
  ouvintes.forEach((o) => o());
}

export function atualizarFiltro(parcial: Partial<FiltroRhEstado>) {
  estado = { ...estado, ...parcial };
  publicar();
}

export function aplicarPreset(preset: PresetPeriodo) {
  if (preset === "personalizado") atualizarFiltro({ preset });
  else atualizarFiltro({ preset, ...periodoDoPreset(preset) });
}

export function limparRecorte() {
  atualizarFiltro({ empresa: null, filial: null, tipcol: [], ccu: null, local: null, cargo: null });
}

export function useFiltroRh(): FiltroRhEstado {
  return useSyncExternalStore(
    (cb) => {
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    () => estado
  );
}

/** Quantos recortes de cadastro (fora o período) estão ativos. */
export function recortesAtivos(f: FiltroRhEstado): number {
  return [f.empresa, f.filial, f.ccu, f.local, f.cargo].filter((v) => v != null).length + (f.tipcol.length ? 1 : 0);
}

/** Parâmetros da query string da API de RH. */
export function paramsDoFiltro(f: FiltroRhEstado): Record<string, string> {
  const p: Record<string, string> = { de: f.de, ate: f.ate };
  if (f.empresa != null) p.empresa = String(f.empresa);
  if (f.filial != null) p.filial = String(f.filial);
  if (f.tipcol.length) p.tipcol = f.tipcol.join(",");
  if (f.ccu) p.ccu = f.ccu;
  if (f.local != null) p.local = String(f.local);
  if (f.cargo) p.cargo = f.cargo;
  return p;
}
