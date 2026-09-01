import axios from "axios";
import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { Pagination } from "../ui/Pagination";
import { formatarMes, ValorClicado } from "./MatrizContabil";

// Espelha o retorno de GET /contabil/resultado/lancamentos (backend/src/routes/contabil.ts).
interface LancamentoDetalhe {
  numlct: string;
  ctared: number;
  // "1234 - Descrição da conta" — só exibida quando `ctareds.length > 1` (mais de uma conta
  // real compõe o valor clicado, ver ValorClicado/LinhaMatrizContabil.ctareds).
  contaRotulo: string;
  datlct: string;
  codccu: string;
  debcreLabel: string;
  valor: number;
  cpllct: string | null;
  orilctLabel: string;
  sitlctLabel: string;
}

interface RespostaLancamentos {
  lancamentos: LancamentoDetalhe[];
  total: number;
  // Soma de `valor` em TODOS os lançamentos que batem o filtro (não só a página atual) — tem
  // que bater exatamente com o valor da célula clicada; é a própria conferência do drilldown.
  valorTotal: number;
  page: number;
  pageSize: number;
}

const dataFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const moeda = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ModalDetalheLancamentosProps extends ValorClicado {
  // Mesmo filtro de centro de custo ativo na tela — sem propagar, a lista traria mais
  // lançamento do que a célula soma (ver regra 4 do pedido: filtros precisam chegar aqui).
  codccu: string[];
  onClose: () => void;
}

export function ModalDetalheLancamentos({ ctareds, mesReferencia, rotulo, codccu, onClose }: ModalDetalheLancamentosProps) {
  const [dados, setDados] = useState<RespostaLancamentos | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    axios
      .get("/api/contabil/resultado/lancamentos", {
        params: {
          ctareds: ctareds.join(","),
          mesReferencia,
          codccu: codccu.length > 0 ? codccu.join(",") : undefined,
          page,
          pageSize: 50,
        },
      })
      .then(({ data }) => {
        setDados(data);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os lançamentos"))
      .finally(() => setLoading(false));
    // `ctareds` é um array novo a cada render do pai — comparar pelo conteúdo (join) evita
    // refetch em loop por identidade de referência.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctareds.join(","), mesReferencia, codccu.join(","), page]);

  const mostrarColunaConta = ctareds.length > 1;

  return (
    <Modal open onClose={onClose} title={rotulo} subtitulo={formatarMes(mesReferencia)} className="max-w-3xl">
      {loading && !dados ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : erro ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
      ) : dados && dados.lancamentos.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Nenhum lançamento encontrado pra este valor.</p>
      ) : dados ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted">
              {dados.total} lançamento{dados.total === 1 ? "" : "s"}
            </p>
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">Total: {moeda.format(dados.valorTotal)}</p>
          </div>
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-2">
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Data</th>
                  {mostrarColunaConta && (
                    <th className="px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Conta</th>
                  )}
                  <th className="px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Histórico</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Origem</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">C. Custo</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">D/C</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Valor</th>
                </tr>
              </thead>
              <tbody>
                {dados.lancamentos.map((l) => (
                  <tr key={`${l.numlct}-${l.ctared}`} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">{dataFormatter.format(new Date(l.datlct))}</td>
                    {mostrarColunaConta && <td className="px-3 py-2 text-xs text-muted">{l.contaRotulo}</td>}
                    <td className="max-w-[220px] truncate px-3 py-2 text-xs text-foreground" title={l.cpllct ?? undefined}>
                      {l.cpllct ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{l.orilctLabel}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{l.codccu}</td>
                    <td className="px-3 py-2 text-xs text-muted">{l.debcreLabel}</td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums ${
                        l.valor < 0 ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {moeda.format(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dados.total > dados.pageSize && (
            <div className="-mx-4 -mb-4 mt-1">
              <Pagination page={dados.page} pageSize={dados.pageSize} total={dados.total} loading={loading} onPageChange={setPage} label="lançamentos" />
            </div>
          )}
        </>
      ) : null}
    </Modal>
  );
}
