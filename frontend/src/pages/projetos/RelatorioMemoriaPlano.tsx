import axios from "axios";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MemoriaCalculo } from "../../components/planoEvolucao/MemoriaCalculo";
import { OrientacaoRelatorio, RelatorioShell, TemaRelatorio, baixarPdfDoServidor, usePreferencia } from "../../components/relatorio/relatorioComum";
import { Spinner } from "../../components/ui/Spinner";
import { MemoriaResposta, dataBr } from "../../lib/planoEvolucao";

const CHAVE_TEMA = "caxhub-plano-memoria-tema";
const CHAVE_ORIENTACAO = "caxhub-plano-memoria-orientacao";

// Memória de cálculo da apuração do Plano de Evolução, impressa a partir da tela de Apuração (ou do Meu plano). Página própria fora do
// AppShell, tema e orientação na barra, "Imprimir" e "Baixar PDF" (o servidor abre esta mesma página num Chromium com o token de quem pediu,
// então o PDF sai igual e só mostra o que essa pessoa já enxergaria).
export function RelatorioMemoriaPlano() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [tema, escolherTema] = usePreferencia<TemaRelatorio>(CHAVE_TEMA, ["claro", "escuro"], "claro", params.get("tema"));
  const [orientacao, escolherOrientacao] = usePreferencia<OrientacaoRelatorio>(CHAVE_ORIENTACAO, ["retrato", "paisagem"], "retrato", params.get("orientacao"));
  const [dados, setDados] = useState<MemoriaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    axios
      .get<MemoriaResposta>(`/api/plano-evolucao/apuracoes/${id}/memoria`)
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível carregar a memória de cálculo." : "Não foi possível carregar a memória de cálculo."));
    return () => {
      cancelado = true;
    };
  }, [id]);

  // Sinal pro Chromium do servidor (PDF): só gera depois de "pronto" e desiste com "erro".
  useEffect(() => {
    const w = window as unknown as { __relatorioPronto?: boolean; __relatorioErro?: string };
    if (erro) w.__relatorioErro = erro;
    else w.__relatorioPronto = !!dados;
  }, [erro, dados]);

  async function baixarPdf() {
    setBaixando(true);
    setErroPdf(null);
    try {
      await baixarPdfDoServidor(`/api/plano-evolucao/apuracoes/${id}/memoria/pdf`, { tema, orientacao }, `memoria-de-calculo-${id}.pdf`);
    } catch (err) {
      setErroPdf((err as Error).message);
    } finally {
      setBaixando(false);
    }
  }

  return (
    <RelatorioShell
      titulo="Plano de Evolução · Memória de cálculo"
      tema={tema}
      onTema={escolherTema}
      orientacao={orientacao}
      onOrientacao={escolherOrientacao}
      podeBaixar={!!dados}
      podeImprimir={!!dados}
      baixandoPdf={baixando}
      onBaixarPdf={baixarPdf}
      erroPdf={erroPdf}
      larguraMax="max-w-4xl"
    >
      {!dados && !erro && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted">
          <Spinner /> Carregando…
        </div>
      )}
      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{erro}</p>}
      {dados && (
        <>
          <MemoriaCalculo memoria={dados.memoria} />
          {(dados.devolutivaEm || dados.contestacao || dados.desfecho) && (
            <section className="mt-5 break-inside-avoid">
              <h3 className="font-display text-[14px] font-semibold text-foreground">Devolutiva e contestação</h3>
              <ul className="mt-2 space-y-1.5 rounded-md border border-border px-3 py-2 text-[13px] text-foreground">
                {dados.devolutivaEm && <li>Devolutiva realizada em <b>{dataBr(dados.devolutivaEm)}</b>.</li>}
                {dados.contestacao && (
                  <li>
                    Contestação recebida{dados.contestacao.recebidaEm ? ` em ${dataBr(dados.contestacao.recebidaEm)}` : ""}: <span className="text-muted">{dados.contestacao.texto}</span>
                  </li>
                )}
                {dados.desfecho && (
                  <li>
                    Desfecho: <b>{dados.desfecho.resultado === "procedente" ? "contestação procedente (apuração reaberta)" : "apuração mantida"}</b>
                    {dados.desfecho.texto ? <span className="text-muted"> — {dados.desfecho.texto}</span> : null}
                  </li>
                )}
              </ul>
            </section>
          )}
        </>
      )}
    </RelatorioShell>
  );
}
