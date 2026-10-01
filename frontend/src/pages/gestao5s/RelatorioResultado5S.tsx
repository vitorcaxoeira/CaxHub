import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AvaliacaoResumo5S, AvaliacoesDoMes } from "../../components/gestao5s/AvaliacoesDoMes";
import { DetalheAvaliacaoImpressao, FalhaAvaliacao, contarFotos } from "../../components/gestao5s/DetalheAvaliacaoImpressao";
import { ImagensRelatorioProvider, ProgressoImagens } from "../../components/gestao5s/ImagemRelatorio";
import { DashboardResultado, DesempenhoPorSenso, EvolucaoMensalTabela, KpisResultado, RankingResultado } from "../../components/gestao5s/ResultadoSecoes";
import { Spinner } from "../../components/ui/Spinner";
import { cn } from "../../lib/cn";
import { DetalheAvaliacao5S, ModoImpressao5S, TipoArea, mensagemDeErro, rotuloMes } from "../../utils/gestao5s";

const dataHoraFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Tema e orientação do relatório são independentes do app: padrão claro (economiza tinta) e retrato
// (A4 em pé); a escolha feita na barra fica lembrada neste navegador.
type TemaRelatorio = "claro" | "escuro";
type OrientacaoRelatorio = "retrato" | "paisagem";
const CHAVE_TEMA = "caxhub-5s-relatorio-tema";
const CHAVE_ORIENTACAO = "caxhub-5s-relatorio-orientacao";

const MES_RE = /^\d{4}-\d{2}$/;

// Todas as avaliações finalizadas do mês "AAAA-MM" (o endpoint pagina em até 100), da mais recente
// pra mais antiga, como no Histórico. Sem `tipo` = setores + ambientes comuns.
async function buscarAvaliacoesDoMes(mes: string, tipo: TipoArea): Promise<AvaliacaoResumo5S[]> {
  const [ano, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(ano, m, 0).getDate();
  const params = {
    status: "finalizada",
    de: `${mes}-01`,
    ate: `${mes}-${String(ultimoDia).padStart(2, "0")}`,
    pageSize: 100,
    ...(tipo === "comum" ? { tipo } : {}),
  };
  const itens: AvaliacaoResumo5S[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await axios.get<{ total: number; itens: AvaliacaoResumo5S[] }>("/api/5s/avaliacoes", { params: { ...params, page } });
    itens.push(...data.itens);
    if (itens.length >= data.total || data.itens.length === 0) break;
  }
  return itens;
}

// Roda `fn` sobre os itens com no máximo `limite` chamadas simultâneas, preservando a ordem.
async function emLotes<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida = new Array<R>(itens.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, async () => {
      while (proximo < itens.length) {
        const k = proximo++;
        saida[k] = await fn(itens[k]);
      }
    })
  );
  return saida;
}

interface ProgressoDetalhes {
  feitos: number;
  total: number;
}

// Detalhe (GET /5s/avaliacoes/:id) de cada avaliação do mês e, nas avaliações-pai (área agrupadora),
// de cada ambiente filho. Falha em um item vira `null` no mapa e não derruba o resto.
async function buscarDetalhes(itens: AvaliacaoResumo5S[], aoProgredir: (p: ProgressoDetalhes) => void): Promise<Map<number, DetalheAvaliacao5S | null>> {
  const mapa = new Map<number, DetalheAvaliacao5S | null>();
  let feitos = 0;
  let total = itens.length;
  const buscar = async (id: number) => {
    const detalhe = await axios
      .get<DetalheAvaliacao5S>(`/api/5s/avaliacoes/${id}`)
      .then(({ data }) => data)
      .catch(() => null);
    mapa.set(id, detalhe);
    aoProgredir({ feitos: ++feitos, total });
    return detalhe;
  };
  aoProgredir({ feitos, total });
  const principais = await emLotes(itens, 4, (a) => buscar(a.id));
  const idsFilhas = principais.flatMap((d) => d?.filhas.map((f) => f.id) ?? []);
  total += idsFilhas.length;
  aoProgredir({ feitos, total });
  await emLotes(idsFilhas, 4, buscar);
  return mapa;
}

// `doParametro` (query string) vence o localStorage: o PDF gerado no servidor abre esta página num
// navegador sem preferências e pede tema/orientação pela URL.
function lerPreferencia<T extends string>(chave: string, validos: readonly T[], padrao: T, doParametro?: string | null): T {
  const pedido = validos.find((x) => x === doParametro);
  if (pedido) return pedido;
  try {
    const v = localStorage.getItem(chave);
    return validos.find((x) => x === v) ?? padrao;
  } catch {
    return padrao;
  }
}

function gravarPreferencia(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* sem storage: vale só nesta aba */
  }
}

function Segmentado<T extends string>({ rotulo, opcoes, valor, onChange }: { rotulo: string; opcoes: readonly T[]; valor: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex overflow-hidden rounded-md border border-border text-xs font-medium">
      {opcoes.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={valor === o}
          onClick={() => onChange(o)}
          className={cn(
            "px-3 py-1.5 capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            valor === o ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// Relatório impresso do "Resultado geral 5S" (botão Imprimir do dashboard). Página própria, fora do
// AppShell, aberta numa aba: window.print() imprime a aba inteira, então sem Sidebar/Topbar só o
// relatório vai pro papel. Tema claro/escuro escolhido na barra (padrão claro), independente do tema do app. Reusa as
// mesmas seções da tela. Os dois modos (resumido/detalhado) imprimem o mesmo conteúdo por ora —
// o detalhado será evoluído depois de homologado.
export function RelatorioResultado5S() {
  const [params] = useSearchParams();
  const tipo: TipoArea = params.get("tipo") === "comum" ? "comum" : "setor";
  const modo: ModoImpressao5S = params.get("modo") === "detalhado" ? "detalhado" : "resumido";
  const de = params.get("de") ?? "";
  const ate = params.get("ate") ?? "";

  const [dados, setDados] = useState<DashboardResultado | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [emitidoEm] = useState(() => dataHoraFormatter.format(new Date()));
  const [tema, setTema] = useState<TemaRelatorio>(() => lerPreferencia(CHAVE_TEMA, ["claro", "escuro"], "claro", params.get("tema")));
  const [orientacao, setOrientacao] = useState<OrientacaoRelatorio>(() => lerPreferencia(CHAVE_ORIENTACAO, ["retrato", "paisagem"], "retrato", params.get("orientacao")));

  function escolherTema(t: TemaRelatorio) {
    setTema(t);
    gravarPreferencia(CHAVE_TEMA, t);
  }

  function escolherOrientacao(o: OrientacaoRelatorio) {
    setOrientacao(o);
    gravarPreferencia(CHAVE_ORIENTACAO, o);
  }

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate) || de > ate) {
      setErro("Período inválido para o relatório");
      setLoading(false);
      return;
    }
    axios
      .get<DashboardResultado>("/api/5s/dashboard", { params: { tipo, de, ate } })
      .then(({ data }) => setDados(data))
      .catch((err) => setErro(mensagemDeErro(err, "Falha ao carregar o relatório")))
      .finally(() => setLoading(false));
  }, [tipo, de, ate]);

  // Detalhado: avaliações finalizadas do ÚLTIMO mês do período (as mesmas do Histórico). No tipo
  // "setor" o resultado inclui o acumulado dos ambientes comuns vinculados, então vêm os dois tipos.
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoResumo5S[] | null>(null);
  useEffect(() => {
    if (modo !== "detalhado" || !MES_RE.test(ate) || !MES_RE.test(de) || de > ate) return;
    let cancelado = false;
    setAvaliacoes(null);
    buscarAvaliacoesDoMes(ate, tipo)
      .then((itens) => !cancelado && setAvaliacoes(itens))
      .catch((err) => {
        if (cancelado) return;
        setErro(mensagemDeErro(err, "Falha ao carregar as avaliações do mês"));
        setAvaliacoes([]);
      });
    return () => {
      cancelado = true;
    };
  }, [modo, tipo, de, ate]);

  // Detalhado é autossuficiente: quem recebe o PDF não tem acesso ao 5S, então o conteúdo de cada
  // avaliação (notas, fechamentos, fotos, observações da equipe) vai impresso, não em link.
  const [detalhes, setDetalhes] = useState<Map<number, DetalheAvaliacao5S | null> | null>(null);
  const [progressoDetalhes, setProgressoDetalhes] = useState<ProgressoDetalhes>({ feitos: 0, total: 0 });
  const [baixando, setBaixando] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const [fotos, setFotos] = useState<ProgressoImagens>({ total: 0, concluidas: 0 });
  const aoProgredirFotos = useCallback((p: ProgressoImagens) => setFotos(p), []);
  useEffect(() => {
    setDetalhes(null);
    if (!avaliacoes || avaliacoes.length === 0) return;
    let cancelado = false;
    buscarDetalhes(avaliacoes, (p) => !cancelado && setProgressoDetalhes(p)).then((mapa) => !cancelado && setDetalhes(mapa));
    return () => {
      cancelado = true;
    };
  }, [avaliacoes]);

  // O nome sugerido no "Salvar como PDF" é o document.title da aba no momento do print.
  useEffect(() => {
    if (de && ate) document.title = `Resultado 5S ${de} a ${ate}`;
  }, [de, ate]);

  const escuro = tema === "escuro";
  const semDados = !!dados && dados.areas.length === 0;
  const detalhado = modo === "detalhado";
  const lista = avaliacoes ?? [];
  const detalhesProntos = !!avaliacoes && (lista.length === 0 || !!detalhes);
  // Total de fotos vem dos DADOS (não do que já se registrou na tela): senão, no render em que os
  // detalhes chegam, `total` ainda é 0 e `0 >= 0` liberava o PDF antes de qualquer foto carregar.
  const fotosEsperadas = useMemo(() => {
    if (!detalhes) return 0;
    return (avaliacoes ?? []).reduce((n, a) => {
      const d = detalhes.get(a.id);
      return d ? n + contarFotos(d, d.filhas.map((f) => ({ id: f.id, nome: f.areaNome, detalhe: detalhes.get(f.id) ?? null }))) : n;
    }, 0);
  }, [detalhes, avaliacoes]);
  const fotosProntas = fotos.concluidas >= fotosEsperadas;
  const preparando = detalhado && (!detalhesProntos || !fotosProntas);

  // Sinal pro Chromium do servidor (PDF): só gera depois de "pronto" e desiste com "erro".
  useEffect(() => {
    const w = window as unknown as { __relatorioPronto?: boolean; __relatorioErro?: string };
    if (erro) w.__relatorioErro = erro;
    else if (semDados) w.__relatorioErro = "Nenhuma avaliação finalizada neste período";
    else w.__relatorioPronto = !loading && !!dados && !preparando;
  }, [erro, semDados, loading, dados, preparando]);

  async function baixarPdf() {
    setBaixando(true);
    setErroPdf(null);
    try {
      const { data } = await axios.post<Blob>("/api/5s/relatorio/pdf", { tipo, de, ate, modo, tema, orientacao }, { responseType: "blob", timeout: 180_000 });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resultado-5s-${tipo}-${de}_a_${ate}-${modo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      // Com responseType blob o corpo do erro também chega como Blob: lê o JSON de dentro.
      let mensagem = "Não foi possível gerar o PDF";
      const corpo = (err as { response?: { data?: unknown } })?.response?.data;
      if (corpo instanceof Blob) {
        try {
          mensagem = (JSON.parse(await corpo.text()) as { error?: string }).error ?? mensagem;
        } catch {
          /* corpo não era JSON */
        }
      }
      setErroPdf(mensagem);
    } finally {
      setBaixando(false);
    }
  }
  const periodo = de && ate ? (de === ate ? rotuloMes(de) : `${rotuloMes(de)} a ${rotuloMes(ate)}`) : "";

  return (
    // `tema-claro` / `dark` redefinem os tokens de cor neste trecho, independente do tema do app.
    <div
      className={cn(
        "min-h-screen bg-background px-4 py-4 text-foreground [-webkit-print-color-adjust:exact] [print-color-adjust:exact] sm:px-6 sm:py-5",
        escuro ? "dark relatorio-escuro print:p-[10mm]" : "tema-claro relatorio-claro print:bg-white print:p-0"
      )}
    >
      {/* Orientação da folha vem da barra. No escuro a margem da folha é zerada e o respiro vem do
          padding, pra o fundo escuro cobrir a página inteira. */}
      <style>{`@page { size: A4 ${orientacao === "retrato" ? "portrait" : "landscape"}; margin: ${escuro ? "0" : "10mm"}; }`}</style>

      {/* Barra de ação — some ao imprimir. */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 pb-4 print:hidden">
        <h1 className="text-base font-semibold text-foreground">Relatório · Resultado geral 5S</h1>
        <div className="flex items-center gap-2">
          {preparando && (
            <span className="mr-1 text-xs text-muted" role="status">
              {!detalhesProntos ? `Carregando avaliações ${progressoDetalhes.feitos}/${progressoDetalhes.total}…` : `Carregando fotos ${Math.min(fotos.concluidas, fotosEsperadas)}/${fotosEsperadas}…`}
            </span>
          )}
          <Segmentado rotulo="Orientação da folha" opcoes={["retrato", "paisagem"]} valor={orientacao} onChange={escolherOrientacao} />
          <Segmentado rotulo="Tema do relatório" opcoes={["claro", "escuro"]} valor={tema} onChange={escolherTema} />
          <button
            type="button"
            onClick={baixarPdf}
            disabled={!dados || semDados || baixando}
            className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {baixando ? "Gerando PDF…" : "Baixar PDF"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!dados || semDados || preparando}
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

      <div className="mx-auto max-w-6xl">
        {erroPdf && <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">{erroPdf}</p>}
        {loading && (
          <div className="flex items-center justify-center py-10 print:hidden">
            <Spinner />
          </div>
        )}
        {!loading && erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">{erro}</p>}
        {!loading && semDados && <p className="rounded-md border border-border bg-surface p-4 text-sm text-muted print:hidden">Nenhuma avaliação finalizada neste período.</p>}

        {dados && !semDados && (
          <div className="space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-foreground pb-3">
              <div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão 5S · {modo === "detalhado" ? "Detalhado" : "Resumido"}</p>
                <h2 className="font-display text-2xl font-bold">Resultado geral 5S</h2>
                <p className="text-sm text-muted">
                  {tipo === "setor" ? "Setores" : "Ambientes comuns"} · {periodo}
                </p>
              </div>
              <p className="text-[11px] text-muted">Emitido em {emitidoEm}</p>
            </header>

            <KpisResultado dados={dados} />
            <RankingResultado dados={dados} />
            <DesempenhoPorSenso dados={dados} />
            <EvolucaoMensalTabela dados={dados} />
            {detalhado && avaliacoes && <AvaliacoesDoMes mes={ate} itens={avaliacoes} comLinks />}
            {detalhado && detalhes && (
              <ImagensRelatorioProvider onProgresso={aoProgredirFotos}>
                <div className="space-y-5">
                  {lista.map((a) => {
                    const d = detalhes.get(a.id);
                    if (!d) return <FalhaAvaliacao key={a.id} id={a.id} />;
                    return <DetalheAvaliacaoImpressao key={a.id} av={d} filhas={d.filhas.map((f) => ({ id: f.id, nome: f.areaNome, detalhe: detalhes.get(f.id) ?? null }))} />;
                  })}
                </div>
              </ImagensRelatorioProvider>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
