import axios from "axios";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

// Peças comuns dos relatórios impressos do CaxHub (Resultado 5S, Cronograma): página própria fora do
// AppShell, tema claro/escuro e orientação da folha escolhidos na barra (e lembrados neste
// navegador), botão "Imprimir" e "Baixar PDF" (gerado no servidor com Chromium, idêntico ao imprimir).
// Padrão e motivos: ver o relatório do 5S (RelatorioResultado5S.tsx), de onde isto foi extraído.

export type TemaRelatorio = "claro" | "escuro";
export type OrientacaoRelatorio = "retrato" | "paisagem";

// `doParametro` (query string) vence o localStorage: o PDF gerado no servidor abre a página num
// navegador sem preferências e pede tema/orientação pela URL.
export function lerPreferencia<T extends string>(chave: string, validos: readonly T[], padrao: T, doParametro?: string | null): T {
  const pedido = validos.find((x) => x === doParametro);
  if (pedido) return pedido;
  try {
    const v = localStorage.getItem(chave);
    return validos.find((x) => x === v) ?? padrao;
  } catch {
    return padrao;
  }
}

export function gravarPreferencia(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* sem storage: vale só nesta aba */
  }
}

// Estado de uma preferência do relatório (tema, orientação, escala…) com lembrança no navegador.
export function usePreferencia<T extends string>(chave: string, validos: readonly T[], padrao: T, doParametro?: string | null) {
  const [valor, setValor] = useState<T>(() => lerPreferencia(chave, validos, padrao, doParametro));
  function escolher(novo: T) {
    setValor(novo);
    gravarPreferencia(chave, novo);
  }
  return [valor, escolher] as const;
}

export function Segmentado<T extends string>({
  rotulo,
  opcoes,
  valor,
  onChange,
  rotulos,
}: {
  rotulo: string;
  opcoes: readonly T[];
  valor: T;
  onChange: (v: T) => void;
  // Texto mostrado no lugar do próprio valor (ex.: "ambos" → "Tabela + Gantt").
  rotulos?: Partial<Record<T, string>>;
}) {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex overflow-hidden rounded-md border border-border text-xs font-medium">
      {opcoes.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={valor === o}
          onClick={() => onChange(o)}
          className={cn(
            "px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            rotulos?.[o] ? "" : "capitalize",
            valor === o ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
          )}
        >
          {rotulos?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

// Baixa o PDF gerado no servidor. Com responseType blob o corpo do erro também chega como Blob: lê o
// JSON de dentro pra devolver a mensagem de verdade.
export async function baixarPdfDoServidor(url: string, corpo: Record<string, unknown>, nomeArquivo: string): Promise<void> {
  try {
    const { data } = await axios.post<Blob>(url, corpo, { responseType: "blob", timeout: 180_000 });
    const href = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = href;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch (err) {
    let mensagem = "Não foi possível gerar o PDF";
    const resposta = (err as { response?: { data?: unknown } })?.response?.data;
    if (resposta instanceof Blob) {
      try {
        mensagem = (JSON.parse(await resposta.text()) as { error?: string }).error ?? mensagem;
      } catch {
        /* corpo não era JSON */
      }
    }
    throw new Error(mensagem);
  }
}

interface RelatorioShellProps {
  titulo: string;
  tema: TemaRelatorio;
  onTema: (t: TemaRelatorio) => void;
  orientacao: OrientacaoRelatorio;
  onOrientacao: (o: OrientacaoRelatorio) => void;
  // Antes dos controles de folha/tema: status de carregamento e controles próprios de cada relatório.
  controlesExtras?: ReactNode;
  // Habilita "Baixar PDF" (há conteúdo) e "Imprimir" (há conteúdo e nada ainda carregando). "Baixar PDF" é
  // opcional: só aparece quando o relatório passa `onBaixarPdf` (o de Produtividade só imprime, pra não abrir
  // um Chromium no servidor — o imprimir do navegador já salva em PDF).
  podeBaixar?: boolean;
  podeImprimir: boolean;
  baixandoPdf?: boolean;
  onBaixarPdf?: () => void;
  erroPdf?: string | null;
  // Largura máxima do CONTEÚDO (Tailwind), 6xl como o do 5S; o cronograma usa a largura da folha pra prévia
  // ficar parecida com o papel (a barra de ações segue em 6xl).
  larguraMax?: string;
  children: ReactNode;
}

// Moldura do relatório: fundo/tema próprios, `@page` pela orientação e barra de ação que some ao
// imprimir. `tema-claro` / `dark` redefinem os tokens de cor neste trecho, independente do app; no
// escuro a margem da folha é zerada e o respiro vem do padding, pro fundo cobrir a página inteira.
export function RelatorioShell({
  titulo,
  tema,
  onTema,
  orientacao,
  onOrientacao,
  controlesExtras,
  podeBaixar,
  podeImprimir,
  baixandoPdf,
  onBaixarPdf,
  erroPdf,
  larguraMax = "max-w-6xl",
  children,
}: RelatorioShellProps) {
  const escuro = tema === "escuro";
  return (
    <div
      className={cn(
        "min-h-screen bg-background px-4 py-4 text-foreground [-webkit-print-color-adjust:exact] [print-color-adjust:exact] sm:px-6 sm:py-5",
        escuro ? "dark relatorio-escuro print:p-[10mm]" : "tema-claro relatorio-claro print:bg-white print:p-0"
      )}
    >
      <style>{`@page { size: A4 ${orientacao === "retrato" ? "portrait" : "landscape"}; margin: ${escuro ? "0" : "10mm"}; }`}</style>

      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 pb-4 print:hidden">
        <h1 className="text-base font-semibold text-foreground">{titulo}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {controlesExtras}
          <Segmentado rotulo="Orientação da folha" opcoes={["retrato", "paisagem"] as const} valor={orientacao} onChange={onOrientacao} />
          <Segmentado rotulo="Tema do relatório" opcoes={["claro", "escuro"] as const} valor={tema} onChange={onTema} />
          {onBaixarPdf && (
            <button
              type="button"
              onClick={onBaixarPdf}
              disabled={!podeBaixar || baixandoPdf}
              className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {baixandoPdf ? "Gerando PDF…" : "Baixar PDF"}
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!podeImprimir}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Imprimir
          </button>
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Fechar
          </button>
        </div>
      </div>

      <div className={cn("mx-auto", larguraMax)}>
        {erroPdf && <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">{erroPdf}</p>}
        {children}
      </div>
    </div>
  );
}
