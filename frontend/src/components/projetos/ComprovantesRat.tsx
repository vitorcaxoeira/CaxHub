import axios from "axios";
import { useState, type ReactNode } from "react";
import { useBlobAutenticado } from "../../hooks/useBlobAutenticado";
import { reduzirImagem } from "../../utils/reduzirImagem";
import { BotoesCameraGaleria } from "../ui/BotoesCameraGaleria";
import { Modal } from "../ui/Modal";
import { Visualizador } from "../ui/Visualizador";

// Comprovante (foto/PDF) de despesa de viagem — ComprovanteRat no backend (routes/rats.ts).
// Sempre de uma RAT; `despesaId` nulo = "solto" na RAT, ainda sem despesa.
export interface Comprovante {
  id: number;
  despesaId: number | null;
  nomeArquivo: string;
  mimeType: string;
  tamanhoBytes: number;
  autorNome: string | null;
  criadoEm: string;
}

export interface OpcaoDespesaComprovante {
  id: number;
  rotulo: string;
}

// Arquivo escolhido no lançamento de uma despesa que ainda não existe — só sobe depois do POST
// da despesa (ver ModalLancarDespesa). `previa` = objectURL local, revogado por quem criou.
export interface ArquivoEmEspera {
  chave: string;
  arquivo: File;
  previa: string | null;
}

export const ACCEPT_COMPROVANTE = "image/*,application/pdf";

const classeBotao =
  "min-h-11 rounded-md border border-border px-3.5 py-1.5 text-sm text-muted transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

const urlArquivo = (id: number) => `/api/rats/comprovantes/${id}/arquivo`;

// Imagem que o navegador sabe desenhar — HEIC (iPhone, quando não vira JPEG na captura) só o
// Safari mostra; nos demais cai no cartão de arquivo, que abre em aba nova.
export function ehImagemExibivel(mimeType: string): boolean {
  return mimeType.startsWith("image/") && !/hei[cf]/.test(mimeType);
}

function mensagemErro(err: unknown, padrao: string): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error ?? padrao;
}

export async function enviarComprovante(ratId: number, arquivo: File, despesaId: number | null): Promise<void> {
  const form = new FormData();
  // JPEG (não webp como no 5S): o PDF único da RAT só embute JPEG e PNG.
  form.append("arquivo", await reduzirImagem(arquivo, { formato: "image/jpeg", qualidade: 0.85 }));
  if (despesaId != null) form.append("despesaId", String(despesaId));
  await axios.post(`/api/rats/${ratId}/comprovantes`, form);
}

// PDF (ou imagem que o navegador não desenha) abre em aba nova. A aba é aberta no clique, ANTES
// do await — aberta depois, o bloqueador de popup (sobretudo no celular) barra. Sem aba, baixa.
async function abrirEmAba(comprovante: Comprovante): Promise<void> {
  const aba = window.open("", "_blank");
  try {
    const { data } = await axios.get(urlArquivo(comprovante.id), { responseType: "blob" });
    const objectUrl = URL.createObjectURL(data);
    if (aba) {
      aba.location.href = objectUrl;
    } else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = comprovante.nomeArquivo;
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (err) {
    aba?.close();
    throw err;
  }
}

function baixarBlob(blob: Blob, nome: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = nome;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

async function baixarComprovante(comprovante: Comprovante): Promise<void> {
  const { data } = await axios.get(urlArquivo(comprovante.id), { responseType: "blob" });
  baixarBlob(data, comprovante.nomeArquivo);
}

type FormatoDownload = "pdf-prestacao" | "pdf-simples" | "zip";

// Baixa todos os comprovantes da RAT: PDF único (2 modos, montado no servidor) ou .zip com os
// originais (uma pasta por despesa). O nome vem do Content-Disposition; `padrao` cobre o caso de
// o header não vir exposto.
async function baixarTodos(ratId: number, formato: FormatoDownload, padrao: string): Promise<void> {
  const url =
    formato === "zip"
      ? `/api/rats/${ratId}/comprovantes/zip`
      : `/api/rats/${ratId}/comprovantes/pdf?modo=${formato === "pdf-prestacao" ? "prestacao" : "simples"}`;
  const resposta = await axios.get(url, { responseType: "blob" });
  const nome = /filename="([^"]+)"/.exec(String(resposta.headers["content-disposition"] ?? ""))?.[1] ?? padrao;
  baixarBlob(resposta.data, nome);
}

// Com responseType "blob" o corpo do erro (JSON) também vem como Blob — lê o texto pra mostrar
// a mensagem do servidor (ex.: "Esta RAT não tem comprovantes").
async function mensagemErroBlob(err: unknown, padrao: string): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      return (JSON.parse(await data.text()) as { error?: string }).error ?? padrao;
    } catch {
      return padrao;
    }
  }
  return mensagemErro(err, padrao);
}

function IconeArquivo({ nome, rotulo }: { nome: string; rotulo: string }) {
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center">
      <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-destructive">{rotulo}</span>
      <span className="line-clamp-2 break-all text-[10px] leading-tight text-muted">{nome}</span>
    </span>
  );
}

function rotuloTipo(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (/hei[cf]/.test(mimeType)) return "HEIC";
  return "ARQ";
}

interface CartaoProps {
  nome: string;
  // Imagem já carregada (objectURL) — nulo mostra o cartão de arquivo ou o esqueleto.
  imagemUrl: string | null;
  carregando?: boolean;
  tipo: string;
  onAbrir: () => void;
  onRemover?: () => void;
  onBaixar?: () => void;
  selecionado?: boolean;
  children?: ReactNode;
}

function Cartao({ nome, imagemUrl, carregando, tipo, onAbrir, onRemover, onBaixar, selecionado, children }: CartaoProps) {
  return (
    <div className="w-24 flex-none space-y-1">
      <div
        className={`relative h-24 w-24 overflow-hidden rounded-md border bg-surface-2 ${selecionado ? "border-primary ring-2 ring-primary" : "border-border"}`}
      >
        <button type="button" onClick={onAbrir} className="h-full w-full" title={nome}>
          {imagemUrl ? (
            <img src={imagemUrl} alt={nome} className="h-full w-full object-cover" />
          ) : carregando ? (
            <span className="block h-full w-full animate-pulse" />
          ) : (
            <IconeArquivo nome={nome} rotulo={tipo} />
          )}
        </button>
        {onBaixar && (
          <button
            type="button"
            onClick={onBaixar}
            aria-label={`Baixar ${nome}`}
            title="Baixar"
            className="absolute left-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-xs text-foreground shadow"
          >
            ⬇
          </button>
        )}
        {onRemover && (
          <button
            type="button"
            onClick={onRemover}
            aria-label={`Remover ${nome}`}
            className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-xs text-destructive shadow"
          >
            ✕
          </button>
        )}
        {selecionado && (
          <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">✓</span>
        )}
      </div>
      {children}
    </div>
  );
}

// Cartão de um comprovante já enviado: miniatura por blob autenticado quando é imagem.
function CartaoComprovante({
  comprovante,
  onAmpliar,
  onErro,
  onRemover,
  selecionado,
  onAlternar,
  children,
}: {
  comprovante: Comprovante;
  onAmpliar: (url: string) => void;
  onErro: (mensagem: string) => void;
  onRemover?: () => void;
  selecionado?: boolean;
  // Quando presente, clicar marca/desmarca em vez de abrir (seleção no lançamento).
  onAlternar?: () => void;
  children?: ReactNode;
}) {
  const imagem = ehImagemExibivel(comprovante.mimeType);
  const url = useBlobAutenticado(imagem ? urlArquivo(comprovante.id) : null);
  function abrir() {
    if (onAlternar) return onAlternar();
    if (imagem && url) return onAmpliar(url);
    abrirEmAba(comprovante).catch((err) => onErro(mensagemErro(err, "Falha ao abrir o comprovante")));
  }
  function baixar() {
    baixarComprovante(comprovante).catch((err) => onErro(mensagemErro(err, "Falha ao baixar o comprovante")));
  }
  return (
    <Cartao
      nome={comprovante.nomeArquivo}
      imagemUrl={url}
      carregando={imagem}
      tipo={rotuloTipo(comprovante.mimeType)}
      onAbrir={abrir}
      onRemover={onRemover}
      onBaixar={onAlternar ? undefined : baixar}
      selecionado={selecionado}
    >
      {children}
    </Cartao>
  );
}

interface ComprovantesRatProps {
  ratId: number;
  comprovantes: Comprovante[];
  // Para onde vai o que for enviado aqui: uma despesa, ou nulo = solto na RAT.
  despesaIdAlvo: number | null;
  podeAnexar: boolean;
  // Com opções, cada comprovante ganha o seletor de despesa (vincular/trocar/desvincular).
  opcoesDespesa?: OpcaoDespesaComprovante[];
  mostrarEnvio?: boolean;
  textoVazio?: string;
  onAlterado: () => void;
}

// Grade de comprovantes com Câmera/Galeria (celular) ou seletor de arquivo (desktop). Cada ação
// vai direto ao servidor e chama `onAlterado` pro pai recarregar a lista.
export function ComprovantesRat({
  ratId,
  comprovantes,
  despesaIdAlvo,
  podeAnexar,
  opcoesDespesa,
  mostrarEnvio = true,
  textoVazio,
  onAlterado,
}: ComprovantesRatProps) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);

  async function enviar(arquivos: File[]) {
    setEnviando(true);
    setErro(null);
    let falhas = 0;
    let ultimoErro = "";
    for (const arquivo of arquivos) {
      try {
        await enviarComprovante(ratId, arquivo, despesaIdAlvo);
      } catch (err) {
        falhas += 1;
        ultimoErro = mensagemErro(err, "Falha ao enviar o comprovante");
      }
    }
    if (falhas > 0) setErro(arquivos.length === 1 ? ultimoErro : `${falhas} de ${arquivos.length} arquivo(s) não foram enviados: ${ultimoErro}`);
    setEnviando(false);
    onAlterado();
  }

  async function remover(comprovante: Comprovante) {
    if (!window.confirm(`Remover o comprovante "${comprovante.nomeArquivo}"? O arquivo é apagado.`)) return;
    setErro(null);
    try {
      await axios.delete(`/api/rats/comprovantes/${comprovante.id}`);
      onAlterado();
    } catch (err) {
      setErro(mensagemErro(err, "Falha ao remover o comprovante"));
    }
  }

  async function vincular(comprovante: Comprovante, valor: string) {
    setErro(null);
    try {
      await axios.patch(`/api/rats/comprovantes/${comprovante.id}`, { despesaId: valor === "" ? null : Number(valor) });
      onAlterado();
    } catch (err) {
      setErro(mensagemErro(err, "Falha ao vincular o comprovante"));
    }
  }

  // A despesa atual do comprovante sempre aparece no seletor, mesmo que não esteja entre as
  // opções (ex.: com exclusão pendente) — senão o <select> mostraria outra coisa.
  function opcoesPara(comprovante: Comprovante): OpcaoDespesaComprovante[] {
    const opcoes = opcoesDespesa ?? [];
    if (comprovante.despesaId == null || opcoes.some((o) => o.id === comprovante.despesaId)) return opcoes;
    return [{ id: comprovante.despesaId, rotulo: `Despesa ${comprovante.despesaId}` }, ...opcoes];
  }

  return (
    <div className="space-y-2">
      {comprovantes.length === 0 && textoVazio && <p className="text-sm text-muted">{textoVazio}</p>}
      {(comprovantes.length > 0 || (podeAnexar && mostrarEnvio)) && (
        <div className="flex flex-wrap items-start gap-2">
          {comprovantes.map((comprovante) => (
            <CartaoComprovante
              key={comprovante.id}
              comprovante={comprovante}
              onAmpliar={setAmpliada}
              onErro={setErro}
              onRemover={podeAnexar ? () => void remover(comprovante) : undefined}
            >
              {podeAnexar && opcoesDespesa && (
                <select
                  aria-label={`Despesa do comprovante ${comprovante.nomeArquivo}`}
                  value={comprovante.despesaId ?? ""}
                  onChange={(e) => void vincular(comprovante, e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-1 py-1 text-[11px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Sem despesa</option>
                  {opcoesPara(comprovante).map((opcao) => (
                    <option key={opcao.id} value={opcao.id}>
                      {opcao.rotulo}
                    </option>
                  ))}
                </select>
              )}
            </CartaoComprovante>
          ))}
          {podeAnexar && mostrarEnvio && (
            <div className="flex flex-wrap gap-2">
              <BotoesCameraGaleria
                accept={ACCEPT_COMPROVANTE}
                rotuloDesktop="📎 Anexar"
                enviando={enviando}
                classeBotao={classeBotao}
                onSelecionar={(arquivos) => void enviar(arquivos)}
              />
            </div>
          )}
        </div>
      )}
      {erro && <p className="text-xs text-destructive">{erro}</p>}
      <Visualizador url={ampliada} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

interface SelecaoComprovantesLancamentoProps {
  soltos: Comprovante[];
  marcados: number[];
  onAlternarSolto: (id: number) => void;
  novos: ArquivoEmEspera[];
  onAdicionar: (arquivos: File[]) => void;
  onRemoverNovo: (chave: string) => void;
  desabilitado?: boolean;
}

// Comprovantes escolhidos no lançamento de uma despesa, antes de ela existir: soltos da RAT a
// vincular + arquivos novos (câmera/galeria) em espera. Controlado — quem aplica é o modal,
// depois do POST/PATCH da despesa.
export function SelecaoComprovantesLancamento({
  soltos,
  marcados,
  onAlternarSolto,
  novos,
  onAdicionar,
  onRemoverNovo,
  desabilitado,
}: SelecaoComprovantesLancamentoProps) {
  const [ampliada, setAmpliada] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {soltos.length > 0 && <p className="text-xs text-muted">Toque nos comprovantes já enviados à RAT para vinculá-los a esta despesa.</p>}
      <div className="flex flex-wrap items-start gap-2">
        {soltos.map((comprovante) => (
          <CartaoComprovante
            key={comprovante.id}
            comprovante={comprovante}
            onAmpliar={setAmpliada}
            onErro={() => {}}
            selecionado={marcados.includes(comprovante.id)}
            onAlternar={() => onAlternarSolto(comprovante.id)}
          />
        ))}
        {novos.map((novo) => (
          <Cartao
            key={novo.chave}
            nome={novo.arquivo.name}
            imagemUrl={novo.previa}
            tipo={rotuloTipo(novo.arquivo.type)}
            onAbrir={() => novo.previa && setAmpliada(novo.previa)}
            onRemover={() => onRemoverNovo(novo.chave)}
            selecionado
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <BotoesCameraGaleria accept={ACCEPT_COMPROVANTE} rotuloDesktop="📎 Anexar" desabilitado={desabilitado} classeBotao={classeBotao} onSelecionar={onAdicionar} />
        </div>
      </div>
      <Visualizador url={ampliada} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

export interface DespesaDaJanela {
  id: number;
  rotulo: string;
  podeAnexar: boolean;
}

interface JanelaComprovantesRatProps {
  ratId: number;
  numrat: number | null;
  comprovantes: Comprovante[];
  // Só as despesas que existem na RAT — rótulo já pronto ("Almoço · R$ 49,00 · 26/09/2026").
  despesas: DespesaDaJanela[];
  podeAnexar: boolean;
  onAlterado: () => void;
  onFechar: () => void;
}

// Janela com TODOS os comprovantes da RAT, agrupados: primeiro os soltos ("Sem despesa"), depois
// um bloco por despesa. Anexa mais (solto, vincula-se depois pelo seletor de cada cartão) e baixa
// tudo num .zip. Mesmo espírito da janela "Comprovantes da despesa" da linha (DespesasRatPainel).
export function JanelaComprovantesRat({ ratId, numrat, comprovantes, despesas, podeAnexar, onAlterado, onFechar }: JanelaComprovantesRatProps) {
  const [enviando, setEnviando] = useState(false);
  const [baixando, setBaixando] = useState<FormatoDownload | null>(null);
  const [menuBaixarAberto, setMenuBaixarAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcoesDespesa = despesas.filter((d) => d.podeAnexar).map(({ id, rotulo }) => ({ id, rotulo }));
  const soltos = comprovantes.filter((c) => c.despesaId == null);
  // Despesa que não está mais na lista (ex.: excluída) nunca fica com comprovante: o servidor
  // devolve pra RAT. O fallback só evita sumir com um comprovante se isso um dia acontecer.
  const idsConhecidos = new Set(despesas.map((d) => d.id));
  const orfaos = comprovantes.filter((c) => c.despesaId != null && !idsConhecidos.has(c.despesaId));
  const grupos = despesas
    .map((d) => ({ ...d, itens: comprovantes.filter((c) => c.despesaId === d.id) }))
    .filter((g) => g.itens.length > 0);

  async function enviar(arquivos: File[]) {
    setEnviando(true);
    setErro(null);
    let falhas = 0;
    let ultimoErro = "";
    for (const arquivo of arquivos) {
      try {
        await enviarComprovante(ratId, arquivo, null);
      } catch (err) {
        falhas += 1;
        ultimoErro = mensagemErro(err, "Falha ao enviar o comprovante");
      }
    }
    if (falhas > 0) setErro(arquivos.length === 1 ? ultimoErro : `${falhas} de ${arquivos.length} arquivo(s) não foram enviados: ${ultimoErro}`);
    setEnviando(false);
    onAlterado();
  }

  async function baixar(formato: FormatoDownload) {
    setMenuBaixarAberto(false);
    setBaixando(formato);
    setErro(null);
    const rat = numrat ?? ratId;
    const padrao = formato === "zip" ? `comprovantes-RAT-${rat}.zip` : `${formato === "pdf-prestacao" ? "prestacao-contas" : "comprovantes"}-RAT-${rat}.pdf`;
    try {
      await baixarTodos(ratId, formato, padrao);
    } catch (err) {
      setErro(await mensagemErroBlob(err, "Falha ao baixar os comprovantes"));
    } finally {
      setBaixando(null);
    }
  }

  const bloco = (chave: string, titulo: string, itens: Comprovante[]) => (
    <section key={chave} className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {titulo} <span className="text-muted/70">({itens.length})</span>
      </h3>
      <ComprovantesRat
        ratId={ratId}
        comprovantes={itens}
        despesaIdAlvo={null}
        podeAnexar={podeAnexar}
        opcoesDespesa={opcoesDespesa}
        mostrarEnvio={false}
        onAlterado={onAlterado}
      />
    </section>
  );

  return (
    <Modal
      open
      onClose={onFechar}
      title="Comprovantes da RAT"
      subtitulo={`RAT ${numrat ?? ratId} · ${comprovantes.length} ${comprovantes.length === 1 ? "arquivo" : "arquivos"}`}
      className="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {podeAnexar && (
            <BotoesCameraGaleria accept={ACCEPT_COMPROVANTE} rotuloDesktop="📎 Anexar" enviando={enviando} classeBotao={classeBotao} onSelecionar={(arquivos) => void enviar(arquivos)} />
          )}
          {/* Menu próprio (não ui/DropdownMenu): aquele renderiza num portal FORA do <dialog> e
              ficaria escondido atrás dele. */}
          <div className="relative sm:ml-auto">
            <button
              type="button"
              disabled={comprovantes.length === 0 || baixando != null}
              aria-haspopup="menu"
              aria-expanded={menuBaixarAberto}
              onClick={() => setMenuBaixarAberto((aberto) => !aberto)}
              onKeyDown={(e) => e.key === "Escape" && menuBaixarAberto && (e.stopPropagation(), setMenuBaixarAberto(false))}
              className={classeBotao}
            >
              {baixando ? (baixando === "zip" ? "Gerando ZIP…" : "Gerando PDF…") : "⬇ Baixar todos ▾"}
            </button>
            {menuBaixarAberto && (
              <>
                <button type="button" aria-label="Fechar menu" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuBaixarAberto(false)} />
                <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
                  <button type="button" role="menuitem" onClick={() => void baixar("pdf-prestacao")} className="block w-full px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                    <span className="block text-sm font-medium text-foreground">PDF · Prestação de contas</span>
                    <span className="block text-xs text-muted">Capa com o resumo da RAT e das despesas + comprovantes identificados e numerados</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => void baixar("pdf-simples")} className="block w-full border-t border-border px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                    <span className="block text-sm font-medium text-foreground">PDF · Só os comprovantes</span>
                    <span className="block text-xs text-muted">Todos os anexos em sequência, sem capa</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => void baixar("zip")} className="block w-full border-t border-border px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                    <span className="block text-sm font-medium text-foreground">ZIP · Arquivos originais</span>
                    <span className="block text-xs text-muted">Uma pasta por despesa, sem converter nada</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {erro && <p className="text-xs text-destructive">{erro}</p>}

        {comprovantes.length === 0 ? (
          <p className="text-sm text-muted">Nenhum comprovante anexado a esta RAT.</p>
        ) : (
          <>
            {soltos.length > 0 && bloco("soltos", "Sem despesa", soltos)}
            {grupos.map((g) => bloco(`d-${g.id}`, g.rotulo, g.itens))}
            {orfaos.length > 0 && bloco("orfaos", "Despesa não listada", orfaos)}
          </>
        )}
        {podeAnexar && soltos.length > 0 && (
          <p className="text-xs text-muted">Use o seletor abaixo de cada comprovante para vinculá-lo a uma despesa.</p>
        )}
      </div>
    </Modal>
  );
}
