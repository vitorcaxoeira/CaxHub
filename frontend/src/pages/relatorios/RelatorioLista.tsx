import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { OrientacaoRelatorio, RelatorioShell, TemaRelatorio, baixarPdfDoServidor, usePreferencia } from "../../components/relatorio/relatorioComum";
import { Spinner } from "../../components/ui/Spinner";

// Relatório impresso genérico das listas do padrão de colunas (botão "Imprimir" do ListaServidor, 06/11/2026). A lista grava a especificação
// (título, url e parâmetros: filtros da tela, filtros e ordem por coluna, colunas visíveis e títulos) no localStorage e abre esta página em aba
// nova com a chave na URL. Aqui buscamos GET <url>/impressao (mesma consulta e mesmo escopo da lista) e montamos a tabela para o papel.
// Mesmo molde dos outros relatórios impressos (RelatorioShell): fora do AppShell, tema e orientação na barra, "Imprimir" do navegador.

interface Especificacao {
  titulo: string;
  url: string;
  params: Record<string, unknown>;
  criadoEm: number;
}

interface ColunaImpressa {
  nome: string;
  titulo: string;
  tipo: "texto" | "inteiro" | "decimal" | "data" | "booleano";
}

interface DadosImpressao {
  colunas: ColunaImpressa[];
  linhas: Record<string, unknown>[];
  total: number;
  truncado: boolean;
  limite: number;
  totais: Record<string, number>;
}

const PREFIXO = "caxhub-relatorio-lista:";
const UM_DIA = 24 * 60 * 60 * 1000;
const numero = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const diaHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Especificações antigas (mais de um dia) saem do localStorage para não acumular. */
function limparAntigas() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const chave = localStorage.key(i);
      if (!chave?.startsWith(PREFIXO)) continue;
      const espec = JSON.parse(localStorage.getItem(chave) ?? "{}") as Partial<Especificacao>;
      if (!espec.criadoEm || Date.now() - espec.criadoEm > UM_DIA) localStorage.removeItem(chave);
    }
  } catch {
    /* sem storage: nada a limpar */
  }
}

function lerEspecificacao(id: string | undefined): Especificacao | null {
  if (!id) return null;
  try {
    const bruto = localStorage.getItem(PREFIXO + id);
    return bruto ? (JSON.parse(bruto) as Especificacao) : null;
  } catch {
    return null;
  }
}

function celula(valor: unknown, tipo: ColunaImpressa["tipo"]): string {
  if (valor == null || valor === "") return "—";
  if (tipo === "decimal" && typeof valor === "number") return numero.format(valor);
  if (tipo === "booleano") return valor ? "Sim" : "Não";
  if (tipo === "data" && typeof valor === "string") {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return valor;
    const meiaNoiteUtc = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
    return meiaNoiteUtc ? dia.format(d) : diaHora.format(d);
  }
  return String(valor);
}

export function RelatorioLista() {
  const { id } = useParams();
  const [busca] = useSearchParams();
  const espec = useMemo(() => lerEspecificacao(id), [id]);
  // `completo=1` (PDF do servidor): TODAS as linhas, sem o corte de 5.000 do relatório de tela. Tema e orientação vêm da URL no PDF.
  const completo = busca.get("completo") === "1";
  const [tema, escolherTema] = usePreferencia<TemaRelatorio>("caxhub-relatorio-lista-tema", ["claro", "escuro"] as const, "claro", busca.get("tema"));
  const [orientacao, escolherOrientacao] = usePreferencia<OrientacaoRelatorio>("caxhub-relatorio-lista-orientacao", ["retrato", "paisagem"] as const, "paisagem", busca.get("orientacao"));
  const [baixandoPdf, setBaixandoPdf] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const [dados, setDados] = useState<DadosImpressao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [geradoEm] = useState(() => new Date());

  useEffect(() => {
    limparAntigas();
    if (!espec) {
      setErro("Não encontrei o relatório. Volte à lista e clique em Imprimir de novo.");
      return;
    }
    document.title = espec.titulo;
    let cancelado = false;
    axios
      .get<DadosImpressao>(`${espec.url}/impressao`, { params: { ...espec.params, ...(completo ? { completo: "1" } : {}) } })
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(e.response?.data?.error ?? "Falha ao carregar o relatório"));
    return () => {
      cancelado = true;
    };
  }, [espec, completo]);

  // O Chromium do servidor espera este aviso para gerar o PDF (ver backend/src/lib/relatorioPdf.ts).
  useEffect(() => {
    const w = window as unknown as { __relatorioPronto?: boolean; __relatorioErro?: string };
    if (erro) w.__relatorioErro = erro;
    else if (dados) w.__relatorioPronto = true;
  }, [dados, erro]);

  async function baixarPdf() {
    if (!espec) return;
    setBaixandoPdf(true);
    setErroPdf(null);
    try {
      await baixarPdfDoServidor(`${espec.url}/pdf`, { titulo: espec.titulo, params: espec.params, orientacao, tema }, `${espec.titulo.replace(/[^a-z0-9]+/gi, "_")}.pdf`);
    } catch (e) {
      setErroPdf(e instanceof Error ? e.message : "Não foi possível gerar o PDF");
    } finally {
      setBaixandoPdf(false);
    }
  }

  const temTotais = dados != null && dados.colunas.some((c) => c.nome in dados.totais);
  const numerica = (c: ColunaImpressa) => c.tipo === "decimal" || c.tipo === "inteiro";

  return (
    <RelatorioShell
      titulo={`Relatório · ${espec?.titulo ?? "Lista"}`}
      tema={tema}
      onTema={escolherTema}
      orientacao={orientacao}
      onOrientacao={escolherOrientacao}
      podeImprimir={!!dados && dados.total > 0}
      podeBaixar={!!dados && dados.total > 0}
      baixandoPdf={baixandoPdf}
      onBaixarPdf={baixarPdf}
      erroPdf={erroPdf}
      larguraMax={orientacao === "paisagem" ? "max-w-[1047px] print:max-w-none" : "max-w-[718px] print:max-w-none"}
    >
      {!dados && !erro && (
        <div className="flex items-center justify-center py-10 print:hidden">
          <Spinner />
        </div>
      )}
      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

      {dados && espec && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-1">
            <h2 className="text-base font-bold text-foreground">{espec.titulo}</h2>
            <p className="text-[11px] text-muted">
              {dados.total} registro(s) · gerado em {diaHora.format(geradoEm)}
            </p>
          </div>
          {dados.truncado && (
            <p className="mb-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-[11.5px] text-foreground">
              Mostrando as primeiras {dados.limite} linhas. {completo ? "Passou do limite do PDF: filtre mais a lista." : "Para ter todas, use \"Exportar PDF\" ou \"Exportar Excel\"."}
            </p>
          )}
          <table className="w-full border-collapse text-[10.5px] leading-tight">
            <thead>
              <tr className="border-b border-border text-left">
                {dados.colunas.map((c) => (
                  <th key={c.nome} className={`px-1.5 py-1 font-semibold text-foreground ${numerica(c) ? "text-right" : ""}`}>
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((l, i) => (
                <tr key={i} className="break-inside-avoid border-b border-border/50">
                  {dados.colunas.map((c) => (
                    <td key={c.nome} className={`px-1.5 py-0.5 align-top text-foreground ${numerica(c) ? "text-right tabular-nums" : ""}`}>
                      {celula(l[c.nome], c.tipo)}
                    </td>
                  ))}
                </tr>
              ))}
              {dados.total === 0 && (
                <tr>
                  <td colSpan={dados.colunas.length} className="px-1.5 py-4 text-center text-muted">
                    Nenhum registro com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
            {temTotais && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  {dados.colunas.map((c, i) => (
                    <td key={c.nome} className={`px-1.5 py-1 text-foreground ${numerica(c) ? "text-right tabular-nums" : ""}`}>
                      {c.nome in dados.totais ? numero.format(dados.totais[c.nome]) : i === 0 ? "Total" : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </section>
      )}
    </RelatorioShell>
  );
}
