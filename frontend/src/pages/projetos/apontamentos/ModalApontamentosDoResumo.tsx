import { useMemo } from "react";
import { Link } from "react-router-dom";
import { TabelaLocal } from "../../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../../components/colunas/useColunasConfiguraveis";
import { Modal } from "../../../components/ui/Modal";
import { formatHoras } from "../../../utils/horas";
import { formatMoeda } from "../../../utils/moeda";
import { rotuloItem } from "../atividadesRat";
import { sessoesDaCelula, totaisDasSessoes, valorDaSessao, type SessaoDetalhe } from "./resumoFaturamento";

// Os apontamentos (sessões pendentes de confirmação) que formam uma célula de horas do resumo por Forma de Faturamento. Usa as MESMAS sessões filtradas da
// tela e a mesma chave de agrupamento do resumo, então a soma daqui é a célula clicada. Valores em R$ só para quem pode ver valores.

export interface CelulaDoResumo {
  /** Nome da forma da linha; null = linha de Total (todas as formas). */
  forma: string | null;
  faturavel: boolean;
}

interface Linha {
  id: number;
  inicio: string;
  fim: string;
  minutos: number;
  consultor: string | null;
  codemp: number;
  codpro: number;
  cliente: string | null;
  item: string;
  observacao: string | null;
  valorHora: number | null;
  valor: number;
}

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const fmtDataHora = (iso: string) => dataHora.format(new Date(iso));
const mono = "font-mono text-[12.5px] tabular-nums text-foreground";

const LOCAIS: ColunaLocal[] = [
  { nome: "inicio", tipo: "data", obrigatoria: true },
  { nome: "fim", tipo: "data", obrigatoria: true },
  { nome: "minutos", tipo: "inteiro" },
  { nome: "consultor", tipo: "texto" },
  { nome: "codpro", tipo: "inteiro" },
  { nome: "cliente", tipo: "texto" },
  { nome: "item", tipo: "texto" },
  { nome: "observacao", tipo: "texto" },
  { nome: "valorHora", tipo: "decimal" },
  { nome: "valor", tipo: "decimal" },
];

function colunas(comConsultor: boolean, podeVerValores: boolean): DefColuna<Linha>[] {
  const defs: DefColuna<Linha>[] = [
    { nome: "inicio", titulo: "Início", fixa: true, largura: 130, classe: mono, render: (l) => fmtDataHora(l.inicio) },
    { nome: "fim", titulo: "Fim", largura: 130, classe: "font-mono text-[12.5px] tabular-nums text-muted", render: (l) => fmtDataHora(l.fim) },
    { nome: "minutos", titulo: "Horas", direita: true, largura: 90, classe: mono, formatarValor: (v) => formatHoras(Number(v) / 60), formatarResumo: (v) => formatHoras(Number(v) / 60), render: (l) => formatHoras(l.minutos / 60) },
  ];
  if (comConsultor) defs.push({ nome: "consultor", titulo: "Consultor", largura: 180, texto: (l) => l.consultor, classe: "text-sm text-foreground", render: (l) => <span className="block truncate">{l.consultor ?? "—"}</span> });
  defs.push(
    {
      nome: "codpro",
      titulo: "Proposta",
      largura: 90,
      classe: mono,
      render: (l) => (
        <Link to={`/projetos/proposta/${l.codemp}/${l.codpro}`} target="_blank" className="text-primary hover:underline">
          {l.codpro}
        </Link>
      ),
    },
    { nome: "cliente", titulo: "Cliente", largura: 200, texto: (l) => l.cliente, classe: "text-sm text-foreground", render: (l) => <span className="block truncate">{l.cliente ?? "—"}</span> },
    { nome: "item", titulo: "Item", largura: 240, texto: (l) => l.item, classe: "text-sm text-muted", render: (l) => <span className="block truncate">{l.item}</span> },
    { nome: "observacao", titulo: "Observação", largura: 260, texto: (l) => l.observacao, classe: "text-[12.5px] text-muted", render: (l) => <span className="block truncate">{l.observacao ?? "—"}</span> }
  );
  if (podeVerValores) {
    defs.push(
      { nome: "valorHora", titulo: "Vlr. hora", direita: true, largura: 100, dica: "Valor-hora de venda do item da proposta", classe: mono, render: (l) => formatMoeda(l.valorHora) },
      { nome: "valor", titulo: "Valor", direita: true, largura: 100, dica: "Horas × valor-hora do item", classe: `${mono} font-semibold`, formatarResumo: (v) => formatMoeda(Number(v)), render: (l) => formatMoeda(l.valor) }
    );
  }
  return defs;
}

export function ModalApontamentosDoResumo({
  celula,
  sessoes,
  podeVerValores,
  onFechar,
}: {
  celula: CelulaDoResumo;
  sessoes: SessaoDetalhe[];
  podeVerValores: boolean;
  onFechar: () => void;
}) {
  const escolhidas = useMemo(() => sessoesDaCelula(sessoes, celula.forma, celula.faturavel), [sessoes, celula]);
  const totais = useMemo(() => totaisDasSessoes(escolhidas), [escolhidas]);
  const linhas = useMemo<Linha[]>(
    () =>
      escolhidas.map((s) => ({
        id: s.id,
        inicio: s.inicio,
        fim: s.fim,
        minutos: s.duracaoMinutos,
        consultor: s.consultorNome,
        codemp: s.codemp,
        codpro: s.codpro,
        cliente: s.cliente,
        item: rotuloItem(s),
        observacao: s.observacao,
        valorHora: s.valorHoraItem ?? null,
        valor: Math.round(valorDaSessao(s) * 100) / 100,
      })),
    [escolhidas]
  );
  const comConsultor = escolhidas.some((s) => s.consultorNome);
  const defs = useMemo(() => colunas(comConsultor, podeVerValores), [comConsultor, podeVerValores]);
  const locais = useMemo(() => {
    const nomes = new Set(defs.map((d) => d.nome));
    return LOCAIS.filter((c) => nomes.has(c.nome));
  }, [defs]);
  const tipo = celula.faturavel ? "Horas Faturadas" : "Horas Não Faturadas";
  return (
    <Modal
      open
      onClose={onFechar}
      title={`Apontamentos · ${celula.forma ?? "Todas as formas"} · ${tipo}`}
      subtitulo={`${linhas.length} apontamento(s) · ${formatHoras(totais.minutos / 60)}${podeVerValores ? ` · R$ ${formatMoeda(totais.valor)}` : ""}`}
      className="max-w-6xl"
    >
      <TabelaLocal<Linha>
        chave="projetos.apontamentos.resumo-faturamento.detalhe"
        defs={defs}
        colunas={locais}
        linhas={linhas}
        chaveLinha={(l) => String(l.id)}
        paginacao={{ inicial: 25, rotulo: "apontamentos" }}
        vazio="Nenhum apontamento nesta célula."
      />
    </Modal>
  );
}
