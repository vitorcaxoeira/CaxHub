import axios from "axios";
import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Skeleton } from "../ui/Skeleton";

// Detalhe da bonificação que compõe a nota (aberto pelo link "Bonificação na nota" do card Valor-hora, na Home do consultor). Mostra, por competência e por
// processo, cada indicador que gerou valor: o resultado, os pontos, o valor base e o valor que somou à nota. Só entra bonificação FECHADA de processo que
// "compõe a nota". Fonte: GET /api/bonificacao/competencias (o consultor só enxerga a própria; gestor/admin, o consultor que estão olhando).

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const pontosFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

interface ItemBonificacao {
  resultadoId: number;
  processoId: number;
  processo: string;
  indicador: string;
  unidade: string;
  resultado: number | null;
  pontos: number | null;
  valorBase: number | null;
  valor: number;
}
interface CompetenciaBonificacao {
  competencia: string;
  total: number;
  itens: ItemBonificacao[];
}

const rotuloCompetencia = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

/** Resultado do indicador com a unidade ("12,25", "50,85%", "8 h"). */
function resultadoFmt(valor: number | null, unidade: string): string {
  if (valor == null) return "—";
  if (unidade === "percentual") return `${numero.format(valor)}%`;
  if (unidade === "horas") return `${numero.format(valor)} h`;
  return numero.format(valor);
}

export function ModalBonificacaoDoMes({ codfor, competencias, onFechar }: { codfor?: number; competencias: string[]; onFechar: () => void }) {
  const [dados, setDados] = useState<CompetenciaBonificacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    axios
      .get<{ competencias: CompetenciaBonificacao[] }>("/api/bonificacao/competencias", { params: { codfor, competencias: competencias.join(",") } })
      .then(({ data }) => !cancelado && setDados(data.competencias))
      .catch((e) => !cancelado && setErro(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Falha ao carregar a bonificação") : "Falha ao carregar a bonificação"));
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codfor, competencias.join(",")]);

  return (
    <Modal open onClose={onFechar} title="Bonificação somada à nota" className="max-w-4xl">
      <div className="space-y-5">
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        {!dados && !erro && <Skeleton className="h-24 w-full" />}
        {dados?.map((c) => {
          const processos = [...new Set(c.itens.map((i) => i.processo))];
          return (
            <section key={c.competencia}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Competência {rotuloCompetencia(c.competencia)}
                  <span className="ml-2 text-[11px] font-normal text-muted">fechada</span>
                </h3>
                <p className="text-sm text-muted">
                  Total na nota: <strong className="font-mono text-success">+{moeda.format(c.total)}</strong>
                </p>
              </div>
              {c.itens.length === 0 ? (
                <p className="text-sm text-muted">Nenhuma bonificação fechada nesta competência.</p>
              ) : (
                processos.map((nome) => {
                  const itens = c.itens.filter((i) => i.processo === nome);
                  return (
                    <div key={nome} className="mb-3 overflow-x-auto rounded-md border border-border">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 bg-surface-2 px-3 py-1.5">
                        <span className="text-[12.5px] font-semibold text-foreground">{nome}</span>
                        <span className="font-mono text-[12px] tabular-nums text-muted">{moeda.format(itens.reduce((s, i) => s + i.valor, 0))}</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead className="text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                          <tr>
                            <th className="px-3 py-1.5">Indicador</th>
                            <th className="px-3 py-1.5 text-right">Resultado</th>
                            <th className="px-3 py-1.5 text-right">Pontos</th>
                            <th className="px-3 py-1.5 text-right">Valor base</th>
                            <th className="px-3 py-1.5 text-right">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itens.map((i) => (
                            <tr key={i.resultadoId} className="border-t border-border/60">
                              <td className="px-3 py-1.5 text-foreground">{i.indicador}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{resultadoFmt(i.resultado, i.unidade)}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{i.pontos == null ? "—" : pontosFmt.format(i.pontos)}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted">{i.valorBase == null ? "—" : moeda.format(i.valorBase)}</td>
                              <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-foreground">{moeda.format(i.valor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })
              )}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
