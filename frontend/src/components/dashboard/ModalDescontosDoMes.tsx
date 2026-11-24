import axios from "axios";
import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Skeleton } from "../ui/Skeleton";
import { toneBadge, type Tone } from "../ui/badges";

// Detalhe dos descontos que saem da nota (aberto pelo link "Descontos" do card Valor-hora, na Home do consultor). Mostra, por competência, cada
// parcela que pesa na nota: tipo, processo, parcela, valor, vencimento, situação e o saldo que ainda resta do processo.
// Fonte: GET /api/descontos/competencias (o consultor só enxerga os próprios; gestor/admin, o consultor que estão olhando).

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

interface ItemDesconto {
  parcelaId: number;
  processo: string;
  tipo: string;
  numero: number;
  qtdParcelas: number;
  valor: number;
  valorDescontado: number;
  vencimento: string;
  situacao: string;
  situacaoRotulo: string;
  saldoRemanescente: number;
  observacao: string | null;
  transportada: boolean;
}
interface CompetenciaDesconto {
  competencia: string;
  total: number;
  fechada: boolean;
  parcial: boolean;
  itens: ItemDesconto[];
}

const TOM: Record<string, Tone> = { pendente: "warning", descontada: "success", parcial: "warning" };
const rotuloCompetencia = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

export function ModalDescontosDoMes({ codfor, competencias, onFechar }: { codfor?: number; competencias: string[]; onFechar: () => void }) {
  const [dados, setDados] = useState<CompetenciaDesconto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    axios
      .get<{ competencias: CompetenciaDesconto[] }>("/api/descontos/competencias", { params: { codfor, competencias: competencias.join(",") } })
      .then(({ data }) => !cancelado && setDados(data.competencias))
      .catch((e) => !cancelado && setErro(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Falha ao carregar os descontos") : "Falha ao carregar os descontos"));
    return () => {
      cancelado = true;
    };
  }, [codfor, competencias.join(",")]);


  return (
    <Modal open onClose={onFechar} title="Descontos deduzidos da nota" className="max-w-4xl">
      <div className="space-y-5">
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        {!dados && !erro && <Skeleton className="h-24 w-full" />}
        {dados?.map((c) => (
          <section key={c.competencia}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Competência {rotuloCompetencia(c.competencia)}
                <span className="ml-2 text-[11px] font-normal text-muted">{c.fechada ? "fechada" : "em aberto (previsão)"}</span>
              </h3>
              <p className="text-sm text-muted">
                Total deduzido: <strong className="font-mono text-foreground">−{moeda.format(c.total)}</strong>
              </p>
            </div>
            {c.parcial && (
              <p className="mb-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-[12.5px] text-foreground">
                Desconto parcial: a nota desta competência não cobriu todos os descontos. O que sobrou segue para a competência seguinte (veja a coluna “Saldo do
                processo”).
              </p>
            )}
            {c.itens.length === 0 ? (
              <p className="text-sm text-muted">Nenhum desconto nesta competência.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-3 py-1.5">Tipo</th>
                      <th className="px-3 py-1.5">Processo</th>
                      <th className="px-3 py-1.5">Parcela</th>
                      <th className="px-3 py-1.5 text-right">Valor</th>
                      <th className="px-3 py-1.5 text-right">Descontado</th>
                      <th className="px-3 py-1.5">Vencimento</th>
                      <th className="px-3 py-1.5">Situação</th>
                      <th className="px-3 py-1.5 text-right">Saldo do processo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.itens.map((i) => (
                      <tr key={i.parcelaId} className="border-t border-border/60 align-top">
                        <td className="px-3 py-1.5 text-foreground">
                          {i.tipo}
                          {i.observacao && <p className="text-[11px] text-muted">{i.observacao}</p>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-muted">{i.processo}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                          {i.numero > i.qtdParcelas ? (
                            <span className="text-warning" title="Saldo que não coube na nota do mês anterior">Saldo</span>
                          ) : (
                            <>
                              {i.numero}/{i.qtdParcelas}
                              {i.transportada && <span className="ml-1 text-[10.5px] text-warning" title="Veio de saldo que não coube na nota do mês anterior">saldo</span>}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{moeda.format(i.valor)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{i.situacao === "pendente" ? "—" : moeda.format(i.valorDescontado)}</td>
                        <td className="px-3 py-1.5">{dataFmt.format(new Date(i.vencimento))}</td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[TOM[i.situacao] ?? "neutral"]}`}>{i.situacaoRotulo}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted">{moeda.format(i.saldoRemanescente)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}
