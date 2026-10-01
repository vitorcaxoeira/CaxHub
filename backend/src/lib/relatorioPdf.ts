import fs from "fs";
import puppeteer, { Browser } from "puppeteer-core";

// Gera o PDF de uma página do próprio frontend (relatório de impressão) com um Chromium headless,
// então o arquivo sai idêntico ao "Imprimir → Salvar como PDF": texto selecionável, @page, quebras de
// página e links internos. A página é aberta com o token de quem pediu (localStorage), e só enxerga o
// que esse usuário já enxergaria.
//
// Configuração por ambiente:
//  - CHROME_PATH: executável do Chromium/Chrome. Na imagem Docker é o do apk (ver Dockerfile); em dev
//    cai nos caminhos comuns do Chrome/Edge do Windows ou do Linux.
//  - PDF_FRONTEND_URL: origem de onde o Chromium carrega o frontend. Em dev é o Vite
//    (http://localhost:5173); no docker-compose é http://frontend (o nginx, na rede interna).

const CANDIDATOS_CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
];

const TEMPO_MAXIMO_MS = 150_000;

export class RelatorioPdfError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function caminhoDoChrome(): string {
  // CHROME_PATH primeiro; se não existir (ex.: o apk muda o nome do binário), tenta os caminhos comuns.
  const achado = [process.env.CHROME_PATH, ...CANDIDATOS_CHROME].find((c): c is string => !!c && fs.existsSync(c));
  if (!achado) throw new RelatorioPdfError("Chromium não encontrado no servidor (defina CHROME_PATH)", 500);
  return achado;
}

export function origemDoFrontend(): string {
  return (process.env.PDF_FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
}

// Chromium consome bastante memória: uma geração por vez, as demais esperam na fila.
let fila: Promise<unknown> = Promise.resolve();
function naFila<T>(tarefa: () => Promise<T>): Promise<T> {
  const execucao = fila.then(tarefa, tarefa);
  fila = execucao.catch(() => undefined);
  return execucao;
}

const HOSTS_PERMITIDOS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

// `caminho` começa com "/" e é sempre da própria aplicação (o chamador monta; nunca vem do usuário).
export function gerarPdfDaPagina(caminho: string, token: string): Promise<Buffer> {
  return naFila(async () => {
    const origem = origemDoFrontend();
    const permitida = new URL(origem);
    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        executablePath: caminhoDoChrome(),
        headless: true,
        // --no-sandbox: o container roda como root; --disable-dev-shm-usage: /dev/shm do Docker é pequeno.
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      const page = await browser.newPage();
      page.setDefaultTimeout(TEMPO_MAXIMO_MS);
      await page.setViewport({ width: 1100, height: 1400 });

      // Só sai pra rede o que a página precisa: o próprio frontend (e a API, via proxy dele) e as fontes.
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (url.startsWith("data:") || url.startsWith("blob:")) return void req.continue();
        try {
          const u = new URL(url);
          if (u.origin === permitida.origin || HOSTS_PERMITIDOS.has(u.hostname)) return void req.continue();
        } catch {
          /* URL inválida: bloqueia abaixo */
        }
        void req.abort();
      });

      // Strings (não funções): o tsconfig do backend não tem a lib DOM, e o código roda no navegador.
      await page.evaluateOnNewDocument(`localStorage.setItem("token", ${JSON.stringify(token)})`);
      await page.goto(`${origem}${caminho}`, { waitUntil: "domcontentloaded" });

      // A página avisa quando carregou tudo (dados, detalhes e fotos) ou quando falhou. Além do aviso,
      // confere o DOM: sem foto pendente (placeholder `data-foto-pendente`) e com todas as <img>
      // completas — cinto de segurança pra o PDF nunca sair com quadro de foto vazio.
      await page.waitForFunction(
        `typeof window.__relatorioErro === 'string' || (window.__relatorioPronto === true
          && !document.querySelector('[data-foto-pendente]')
          && Array.from(document.images).every((i) => i.complete))`,
        { timeout: TEMPO_MAXIMO_MS }
      );
      const erro = await page.evaluate("window.__relatorioErro");
      if (typeof erro === "string") throw new RelatorioPdfError(erro, 422);
      await page.evaluate("document.fonts.ready.then(() => undefined)");

      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      return Buffer.from(pdf);
    } catch (error) {
      if (error instanceof RelatorioPdfError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw new RelatorioPdfError(/timeout/i.test(msg) ? "O relatório demorou demais para ser gerado" : `Falha ao gerar o PDF: ${msg}`);
    } finally {
      await browser?.close().catch(() => undefined);
    }
  });
}
