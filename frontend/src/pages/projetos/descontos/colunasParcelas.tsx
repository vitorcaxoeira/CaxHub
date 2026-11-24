import type { DefColuna } from "../../../components/colunas/useColunasConfiguraveis";
import { fmtCompetencia, fmtData, fmtMoeda, Selo, TOM_SITUACAO, type SituacaoParcela } from "./comum";

// Linha e colunas da lista de parcelas de descontos (GET /api/descontos/parcelas), compartilhadas entre a tela Gestão de Descontos › Parcelas e a
// seção da Home do consultor. Constantes do módulo: o ListaServidor exige defs estáveis.

export interface ParcelaLista {
  id: number;
  processo: string;
  consultor: string;
  tipo: string;
  parcela: number;
  qtdParcelas: number;
  competencia: string;
  vencimento: string;
  valor: number;
  valorDescontado: number;
  restante: number;
  situacao: string;
  situacaoCodigo: SituacaoParcela;
  observacao: string | null;
}

const dinheiro = "font-mono text-sm tabular-nums text-foreground";
export const COLUNAS_PARCELAS: DefColuna<ParcelaLista>[] = [
  { nome: "processo", titulo: "Processo", fixa: true, largura: 150, resumos: ["contagem", "distintos"], classe: "font-mono text-sm font-semibold text-primary", render: (p) => p.processo },
  { nome: "consultor", titulo: "Consultor", largura: 190, classe: "text-sm text-foreground", texto: (p) => p.consultor, render: (p) => p.consultor },
  { nome: "tipo", titulo: "Tipo de desconto", largura: 150, classe: "text-sm text-muted", texto: (p) => p.tipo, render: (p) => p.tipo },
  { nome: "parcela", titulo: "Parcela", centro: true, largura: 90, classe: "font-mono text-sm text-muted", render: (p) => (p.parcela > p.qtdParcelas ? <span className="text-warning" title="Saldo transportado de uma parcela que não coube na nota">Saldo ({p.parcela})</span> : `${p.parcela}/${p.qtdParcelas}`) },
  { nome: "competencia", titulo: "Competência", largura: 110, classe: "font-mono text-sm text-foreground", render: (p) => fmtCompetencia(p.competencia) },
  { nome: "vencimento", titulo: "Vencimento", largura: 110, classe: "font-mono text-sm text-muted", render: (p) => fmtData(p.vencimento) },
  { nome: "valor", titulo: "Valor", direita: true, largura: 120, classe: dinheiro, formatarResumo: fmtMoeda, render: (p) => fmtMoeda(p.valor) },
  { nome: "valorDescontado", titulo: "Descontado", direita: true, largura: 120, classe: dinheiro, formatarResumo: fmtMoeda, render: (p) => fmtMoeda(p.valorDescontado) },
  { nome: "restante", titulo: "Restante", direita: true, largura: 120, classe: dinheiro, formatarResumo: fmtMoeda, render: (p) => fmtMoeda(p.restante) },
  { nome: "situacao", titulo: "Situação", largura: 170, render: (p) => <Selo texto={p.situacao} tone={TOM_SITUACAO[p.situacaoCodigo] ?? "neutral"} /> },
  { nome: "observacao", titulo: "Observação", ocultaPorPadrao: true, largura: 260, classe: "text-sm text-muted", texto: (p) => p.observacao, render: (p) => p.observacao ?? "—" },
];

/** Para a Home: o consultor já é o selecionado, então a coluna Consultor só repetiria o mesmo nome. */
export const COLUNAS_PARCELAS_SEM_CONSULTOR: DefColuna<ParcelaLista>[] = COLUNAS_PARCELAS.filter((c) => c.nome !== "consultor");
