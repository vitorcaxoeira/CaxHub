import { useMemo, useState } from "react";
import { TabelaLocal } from "../../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../../components/colunas/useColunasConfiguraveis";
import { formatHoras } from "../../../utils/horas";
import { formatMoeda } from "../../../utils/moeda";
import { ModalApontamentosDoResumo, type CelulaDoResumo } from "./ModalApontamentosDoResumo";
import { resumoPorFormaDeFaturamento, type LinhaResumoFaturamento, type SessaoDetalhe } from "./resumoFaturamento";

// Aba "Resumo por Forma de Faturamento" das sessões pendentes de confirmação (Meus Apontamentos). Usa as MESMAS sessões filtradas da aba de sessões (período,
// busca e consultores), então muda junto com os filtros. Os valores em R$ só aparecem para quem pode ver valores de proposta (o servidor nem os envia aos demais).

const horas = (minutos: number) => formatHoras(minutos / 60);
const mono = "font-mono text-sm tabular-nums text-foreground";
const LOCAIS: ColunaLocal[] = [
  { nome: "forma", tipo: "texto", obrigatoria: true },
  { nome: "minutosFaturados", tipo: "inteiro" },
  { nome: "valorHoraMedioFaturado", tipo: "decimal" },
  { nome: "valorFaturado", tipo: "decimal" },
  { nome: "minutosNaoFaturados", tipo: "inteiro" },
  { nome: "valorHoraMedioNaoFaturado", tipo: "decimal" },
  { nome: "valorNaoFaturado", tipo: "decimal" },
];

const ehTotal = (l: LinhaResumoFaturamento) => l.forma === "Total";

interface Acoes {
  abrir: (celula: CelulaDoResumo) => void;
}

/** Horas clicáveis: abrem os apontamentos que formam a soma. Zero fica sem link (não há o que mostrar). */
function LinkHoras({ linha, faturavel, minutos, abrir }: { linha: LinhaResumoFaturamento; faturavel: boolean; minutos: number; abrir: Acoes["abrir"] }) {
  if (minutos <= 0) return <>{horas(minutos)}</>;
  const tipo = faturavel ? "faturadas" : "não faturadas";
  return (
    <button
      type="button"
      onClick={() => abrir({ forma: ehTotal(linha) ? null : linha.forma, faturavel })}
      className="font-mono tabular-nums text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`Ver os apontamentos das horas ${tipo} (${ehTotal(linha) ? "todas as formas" : linha.forma})`}
    >
      {horas(minutos)}
    </button>
  );
}

function colunas(podeVerValores: boolean): DefColuna<LinhaResumoFaturamento, Acoes>[] {
  const hrsFat: DefColuna<LinhaResumoFaturamento, Acoes> = {
    nome: "minutosFaturados",
    titulo: "Hrs. Fat.",
    dica: "Horas Faturadas: itens da proposta com faturamento Normal (S) ou Antecipado (A)",
    direita: true,
    largura: 130,
    classe: mono,
    formatarValor: (v) => horas(Number(v)),
    formatarResumo: (v) => horas(Number(v)),
    render: (l, a) => <LinkHoras linha={l} faturavel minutos={l.minutosFaturados} abrir={a.abrir} />,
  };
  const vlrFat: DefColuna<LinhaResumoFaturamento, Acoes> = {
    nome: "valorFaturado",
    titulo: "Vlr. Fat.",
    dica: "Valor Faturado (R$): horas faturadas × valor-hora do item da proposta",
    direita: true,
    largura: 130,
    classe: "font-mono text-sm font-semibold tabular-nums text-success",
    formatarResumo: (v) => formatMoeda(Number(v)),
    render: (l) => formatMoeda(l.valorFaturado),
  };
  const hrsNao: DefColuna<LinhaResumoFaturamento, Acoes> = {
    nome: "minutosNaoFaturados",
    titulo: "Hrs. Não Fat.",
    dica: "Horas Não Faturadas: demais itens (sem faturamento, comercial, suporte, investimento) e sessões sem item",
    direita: true,
    largura: 130,
    classe: mono,
    formatarValor: (v) => horas(Number(v)),
    formatarResumo: (v) => horas(Number(v)),
    render: (l, a) => <LinkHoras linha={l} faturavel={false} minutos={l.minutosNaoFaturados} abrir={a.abrir} />,
  };
  const vlrNao: DefColuna<LinhaResumoFaturamento, Acoes> = {
    nome: "valorNaoFaturado",
    titulo: "Vlr. Não Fat.",
    dica: "Valor Não Faturado (R$): horas não faturadas × valor-hora do item da proposta",
    direita: true,
    largura: 130,
    classe: "font-mono text-sm tabular-nums text-warning",
    formatarResumo: (v) => formatMoeda(Number(v)),
    render: (l) => formatMoeda(l.valorNaoFaturado),
  };
  // Valor médio da hora = valor ÷ horas (ponderado). Sem Σ no rodapé: somar (ou tirar média de) médias não faz sentido; o Total já traz a média de todas as horas.
  const media = (nome: "valorHoraMedioFaturado" | "valorHoraMedioNaoFaturado", titulo: string, dica: string): DefColuna<LinhaResumoFaturamento, Acoes> => ({
    nome,
    titulo,
    dica,
    direita: true,
    largura: 130,
    classe: "font-mono text-sm tabular-nums text-muted",
    resumos: [],
    formatarValor: (v) => formatMoeda(Number(v)),
    render: (l) => formatMoeda(l[nome]),
  });
  const mediaFat = media("valorHoraMedioFaturado", "Méd./h Fat.", "Valor médio da hora faturada (R$): Vlr. Fat. ÷ Hrs. Fat.");
  const mediaNao = media("valorHoraMedioNaoFaturado", "Méd./h Não Fat.", "Valor médio da hora não faturada (R$): Vlr. Não Fat. ÷ Hrs. Não Fat.");
  const forma: DefColuna<LinhaResumoFaturamento, Acoes> = {
    nome: "forma",
    titulo: "Forma de Faturamento",
    fixa: true,
    largura: 280,
    texto: (l) => l.forma,
    classe: (l) => `text-sm ${ehTotal(l) ? "font-semibold text-foreground" : "text-foreground"}`,
    render: (l) => l.forma,
  };
  return podeVerValores ? [forma, hrsFat, mediaFat, vlrFat, hrsNao, mediaNao, vlrNao] : [forma, hrsFat, hrsNao];
}

export function AbaResumoFaturamento({ sessoes, podeVerValores, loading }: { sessoes: SessaoDetalhe[]; podeVerValores: boolean; loading: boolean }) {
  const { linhas, total } = useMemo(() => resumoPorFormaDeFaturamento(sessoes), [sessoes]);
  const [celula, setCelula] = useState<CelulaDoResumo | null>(null);
  const acoes = useMemo<Acoes>(() => ({ abrir: setCelula }), []);
  const defs = useMemo(() => colunas(podeVerValores), [podeVerValores]);
  const colunasLocais = useMemo(() => (podeVerValores ? LOCAIS : LOCAIS.filter((c) => !c.nome.startsWith("valor"))), [podeVerValores]);
  return (
    <div>
      <p className="mb-2 text-[12.5px] text-muted">
        Resumo das sessões pendentes de confirmação (as mesmas da outra aba, com os mesmos filtros), pela forma de faturamento da proposta. Faturadas são os itens com
        faturamento Normal ou Antecipado{podeVerValores ? "; o valor é horas × valor-hora do item da proposta e a média por hora é o valor ÷ horas" : ""}. Clique nas horas para ver os apontamentos.
      </p>
      <TabelaLocal<LinhaResumoFaturamento, Acoes>
        chave="projetos.apontamentos.resumo-faturamento"
        ctx={acoes}
        defs={defs}
        colunas={colunasLocais}
        linhas={linhas}
        chaveLinha={(l) => l.forma}
        linhaDeTotal={total}
        loading={loading}
        vazio="Nenhuma sessão pendente para resumir com os filtros atuais."
      />
      {celula && <ModalApontamentosDoResumo celula={celula} sessoes={sessoes} podeVerValores={podeVerValores} onFechar={() => setCelula(null)} />}
    </div>
  );
}
