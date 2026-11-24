import axios from "axios";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Spinner } from "../../components/ui/Spinner";

interface RelatorioDespesa {
  tipdes: number | null;
  tipdesLabel: string;
  desrdv: string | null;
  qtdrdv: number | null;
  vlrunt: number | null;
  vlrtot: number | null;
  datemi: string | null;
}

interface ResumoCategoria {
  categoria: string;
  qtdrdv: number;
  vlrtot: number;
}

interface RespostaRelatorio {
  rat: {
    numrat: number | null;
    datemi: string | null;
    consultorNome: string;
    cliente: string | null;
    codpro: number | null;
    numprj: number | null;
    codfpj: number | null;
    faturaCliente: boolean;
  };
  despesas: RelatorioDespesa[];
  resumoPorCategoria: ResumoCategoria[];
  total: number;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const numeroFormatter = new Intl.NumberFormat("pt-BR");
const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number | null) => (v == null ? "0,00" : currency.format(v));
const formatData = (v: string | null) => (v ? dateFormatter.format(new Date(v)) : "—");

// Relatório de Despesas de Viagem (RDV) de UMA RAT, no modelo já usado dentro do Senior (imagem
// que o Vitor mandou, 09/09/2026) — página própria, fora do AppShell (sem Sidebar/Topbar), pra
// window.print() imprimir só o relatório, não o app inteiro. Aberta numa aba própria pelo botão
// "Imprimir" em DespesasRatPainel.tsx. Busca tudo pronto em GET /:id/despesas/relatorio — o
// backend já resolve nome do consultor/cliente, "Faturar Cliente" derivado e o resumo por
// categoria, então esta página só formata e mostra.
export function RelatorioDespesasRat() {
  const { ratId } = useParams<{ ratId: string }>();
  const [dados, setDados] = useState<RespostaRelatorio | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    axios
      .get(`/api/rats/${ratId}/despesas/relatorio`)
      .then(({ data }) => setDados(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar o relatório"))
      .finally(() => setLoading(false));
  }, [ratId]);

  // O nome sugerido no "Salvar como PDF" do diálogo de impressão é o `document.title` da aba no
  // momento do print (Chrome/Edge/Firefox) — sem isto, sugeriria o título genérico da SPA.
  useEffect(() => {
    if (dados?.rat.numrat != null) document.title = `RDV ${dados.rat.numrat}`;
  }, [dados]);

  return (
    <div className="min-h-screen bg-background px-4 py-4 sm:px-6 sm:py-5 print:bg-white print:p-0">
      {/* Barra de ação — some ao imprimir (@media print), fica só o relatório no papel. */}
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 pb-4 print:hidden">
        <h1 className="text-base font-semibold text-foreground">Relatório de Despesas de Viagem</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!dados}
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

      <div className="mx-auto max-w-3xl">
        {loading && (
          <div className="flex items-center justify-center py-10 print:hidden">
            <Spinner />
          </div>
        )}
        {!loading && erro && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">{erro}</p>
        )}
        {!loading && dados && <Relatorio dados={dados} ratId={ratId ?? ""} />}
      </div>
    </div>
  );
}

function Relatorio({ dados, ratId }: { dados: RespostaRelatorio; ratId: string }) {
  const { rat, despesas, resumoPorCategoria, total } = dados;
  return (
    // Fundo/texto sempre claro — é um documento pra impressão, não segue o tema escuro do app
    // (nem em tela, nem no papel).
    <div className="rounded-lg border border-border bg-white text-black print:border-0 print:rounded-none">
      <div className="border-b-2 border-black px-4 py-3">
        <h2 className="text-center text-xl font-bold uppercase tracking-wide">Relatório de Despesas de Viagem</h2>
      </div>

      <div className="grid grid-cols-[1fr_auto] border-b border-black">
        <div className="border-r border-black p-3">
          <p className="text-[11px] font-medium uppercase text-neutral-500">Consultor</p>
          <p className="text-sm">{rat.consultorNome}</p>
        </div>
        <div className="flex">
          <div className="flex flex-col justify-center gap-1 border-r border-black px-3 py-2">
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className={`flex h-3.5 w-3.5 items-center justify-center border border-black text-[9px] leading-none ${rat.faturaCliente ? "font-bold" : ""}`}>
                {rat.faturaCliente ? "X" : ""}
              </span>
              Faturar Cliente
            </label>
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className={`flex h-3.5 w-3.5 items-center justify-center border border-black text-[9px] leading-none ${!rat.faturaCliente ? "font-bold" : ""}`}>
                {!rat.faturaCliente ? "X" : ""}
              </span>
              Não Fatura
            </label>
          </div>
          <div className="px-3 py-2">
            <p className="text-[11px] font-medium uppercase text-neutral-500">Data de Emissão</p>
            <p className="text-sm">{formatData(rat.datemi)}</p>
            <p className="mt-1.5 text-[11px] font-medium uppercase text-neutral-500">Ref. RAT</p>
            <p className="text-sm">{rat.numrat != null ? numeroFormatter.format(rat.numrat) : "—"}</p>
          </div>
        </div>
      </div>

      <table className="w-full border-collapse border-b border-black text-sm">
        <thead>
          <tr className="border-b border-black">
            <th className="w-16 border-r border-black px-2 py-1 text-left text-[11px] font-medium uppercase text-neutral-500">Proposta</th>
            <th className="w-16 border-r border-black px-2 py-1 text-left text-[11px] font-medium uppercase text-neutral-500">Projeto</th>
            <th className="w-16 border-r border-black px-2 py-1 text-left text-[11px] font-medium uppercase text-neutral-500">Fase</th>
            <th className="px-2 py-1 text-left text-[11px] font-medium uppercase text-neutral-500">Nome do Cliente</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border-r border-black px-2 py-1">{rat.codpro ?? "—"}</td>
            <td className="border-r border-black px-2 py-1">{rat.numprj ?? "—"}</td>
            <td className="border-r border-black px-2 py-1">{rat.codfpj ?? "—"}</td>
            <td className="px-2 py-1">{rat.cliente ?? "—"}</td>
          </tr>
        </tbody>
      </table>

      <table className="w-full border-collapse border-b-2 border-black text-sm">
        <thead>
          <tr className="border-b border-black">
            <th className="w-10 border-r border-black px-2 py-1 text-left text-[11px] font-medium uppercase text-neutral-500">Tipo</th>
            <th className="border-r border-black px-2 py-1 text-left text-[11px] font-medium uppercase text-neutral-500">Descrição</th>
            <th className="w-16 border-r border-black px-2 py-1 text-right text-[11px] font-medium uppercase text-neutral-500">Qtd.</th>
            <th className="w-20 border-r border-black px-2 py-1 text-right text-[11px] font-medium uppercase text-neutral-500">Unitário</th>
            <th className="w-20 border-r border-black px-2 py-1 text-right text-[11px] font-medium uppercase text-neutral-500">Total</th>
            <th className="w-24 px-2 py-1 text-right text-[11px] font-medium uppercase text-neutral-500">Data</th>
          </tr>
        </thead>
        <tbody>
          {despesas.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-2 py-3 text-center text-neutral-500">
                Nenhuma despesa lançada nesta RAT.
              </td>
            </tr>
          ) : (
            despesas.map((d, i) => (
              <tr key={i} className="border-t border-neutral-300">
                <td className="border-r border-neutral-300 px-2 py-1">{d.tipdes ?? "—"}</td>
                <td className="border-r border-neutral-300 px-2 py-1">{d.desrdv ?? "—"}</td>
                <td className="border-r border-neutral-300 px-2 py-1 text-right tabular-nums">{d.qtdrdv ?? "—"}</td>
                <td className="border-r border-neutral-300 px-2 py-1 text-right tabular-nums">{formatMoney(d.vlrunt)}</td>
                <td className="border-r border-neutral-300 px-2 py-1 text-right tabular-nums">{formatMoney(d.vlrtot)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatData(d.datemi)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="px-4 py-3">
        <p className="mb-1.5 text-sm font-semibold underline">Despesas pagas pelo Colaborador</p>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {resumoPorCategoria.map((r) => (
              <tr key={r.categoria} className="border-t border-neutral-300 first:border-t-0">
                <td className="py-0.5 italic">{r.categoria}</td>
                <td className="w-20 py-0.5 text-right tabular-nums">{String(r.qtdrdv).padStart(2, "0")}</td>
                <td className="w-24 py-0.5 text-right tabular-nums">{formatMoney(r.vlrtot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-y-2 border-black px-4 py-2">
        <p className="font-semibold">Valor Total da RDV (A Receber)</p>
        <p className="font-mono text-base font-bold tabular-nums">{formatMoney(total)}</p>
      </div>

      <div className="flex flex-col items-center gap-1 px-4 py-10">
        <div className="w-64 border-t border-black" />
        <p className="text-[11px]">Assinatura do Consultor</p>
      </div>

      <p className="px-4 pb-3 text-center text-[10px] text-neutral-400 print:hidden">RAT {ratId} · CaxHub</p>
    </div>
  );
}
