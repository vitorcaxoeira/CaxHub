// Ponte com o CaxHub Desktop — o app Tauri que mostra a janela flutuante (pasta `desktop/`).
//
// O app é uma casca fina: carrega esta mesma aplicação web e injeta `window.__TAURI__`
// (withGlobalTauri), de onde saem os poucos comandos nativos que o navegador não tem —
// tamanho da janela, iniciar com o Windows, ficar no topo, notificação do sistema. Usa-se o
// objeto global em vez do pacote `@tauri-apps/api` de propósito: nenhuma dependência npm nova
// no frontend, então o build da imagem do deploy não muda.
//
// Fora do app (navegador comum) tudo aqui vira "não faz nada", e `/flutuante` continua
// funcionando como uma página comum.

interface TauriGlobal {
  core: { invoke: (comando: string, args?: Record<string, unknown>) => Promise<unknown> };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
    // Injetado pela casca antes da página carregar (initialization_script).
    __CAXHUB_DESKTOP__?: { hostname?: string };
  }
}

export type ModoJanela = "pilula" | "expandida";

export function estaNoApp(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI__;
}

async function invocar(comando: string, args?: Record<string, unknown>): Promise<void> {
  if (!estaNoApp()) return;
  try {
    await window.__TAURI__!.core.invoke(comando, args);
  } catch (erro) {
    // Falha de um comando nativo nunca pode derrubar a tela.
    console.warn(`[desktop:${comando}]`, erro);
  }
}

export function definirModo(modo: ModoJanela): Promise<void> {
  return invocar("definir_modo", { modo });
}

export function aplicarPreferencias(prefs: { abrirAoIniciar: boolean; sempreNoTopo: boolean }): Promise<void> {
  return invocar("aplicar_preferencias", prefs);
}

export function notificar(titulo: string, corpo: string): Promise<void> {
  return invocar("notificar", { titulo, corpo });
}

export function trazerParaFrente(): Promise<void> {
  return invocar("trazer_para_frente");
}

// Esconde na bandeja (não encerra): a página segue viva, então o cronômetro continua e o
// `pagehide` que agendaria a parada da sessão não dispara.
export function esconderJanela(): Promise<void> {
  return invocar("esconder_janela");
}

export function abrirNoNavegador(url: string): void {
  if (estaNoApp()) {
    void invocar("abrir_no_navegador", { url });
    return;
  }
  window.open(url, "_blank", "noopener");
}

export function nomeDoComputador(): string {
  return window.__CAXHUB_DESKTOP__?.hostname?.trim() || "CaxHub Desktop";
}

// ---------- Token de dispositivo ----------
// Guardado no localStorage do app (o WebView2 do CaxHub Desktop tem perfil próprio, separado do
// navegador). Troca por um JWT novo a cada abertura — ver backend/src/routes/desktop.ts.
const CHAVE_DISPOSITIVO = "caxhub-desktop-dispositivo";

export interface DispositivoSalvo {
  id: number;
  token: string;
}

export function lerDispositivo(): DispositivoSalvo | null {
  try {
    const bruto = localStorage.getItem(CHAVE_DISPOSITIVO);
    if (!bruto) return null;
    const dado = JSON.parse(bruto);
    return typeof dado?.id === "number" && typeof dado?.token === "string" ? dado : null;
  } catch {
    return null;
  }
}

export function gravarDispositivo(dispositivo: DispositivoSalvo): void {
  try {
    localStorage.setItem(CHAVE_DISPOSITIVO, JSON.stringify(dispositivo));
  } catch {
    // sem armazenamento: o app só vai pedir login de novo na próxima abertura
  }
}

export function apagarDispositivo(): void {
  try {
    localStorage.removeItem(CHAVE_DISPOSITIVO);
  } catch {
    // idem
  }
}
