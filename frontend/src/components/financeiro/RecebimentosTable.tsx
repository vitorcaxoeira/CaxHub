import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";

export interface RecebimentoRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  titulo: string;
  codcli: number;
  nomcli: string;
  cliente: string;
  datpgt: string;
  vlrliq: number;
  codpor: string | null;
  despor: string | null;
  descco: string | null;
  // Símbolo da moeda do título pago (ex.: "R$", "U$") — null cai no "R$" padrão.
  moeda_sigla: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Filtro e ordem por coluna, resumo no rodapé e colunas calculadas (ListaServidor, 29/10/2026).
const COLUNAS: DefColuna<RecebimentoRow>[] = [
  { nome: "datpgt", titulo: "Data", fixa: true, classe: "font-mono text-muted", largura: 110, render: (r) => dateFormatter.format(new Date(r.datpgt)) },
  { nome: "titulo", titulo: "Título", classe: "font-mono text-muted", largura: 150, render: (r) => r.titulo },
  { nome: "cliente", titulo: "Cliente", classe: "text-foreground", largura: 300, texto: (r) => r.cliente, render: (r) => r.cliente },
  { nome: "despor", titulo: "Portador", classe: "text-muted", largura: 180, render: (r) => r.despor ?? "—" },
  { nome: "descco", titulo: "Conta", classe: "text-muted", largura: 180, render: (r) => r.descco ?? "—" },
  {
    nome: "vlrliq",
    titulo: "Valor",
    direita: true,
    largura: 150,
    classe: "font-semibold text-foreground",
    avisoResumo: "Soma valores de moedas diferentes quando há mais de uma",
    formatarResumo: (v) => currency.format(v),
    render: (r) => `${r.moeda_sigla ?? "R$"} ${currency.format(r.vlrliq)}`,
  },
];

export function RecebimentosTable({ url, params }: { url: string; params: Record<string, unknown> }) {
  return (
    <ListaServidor<RecebimentoRow>
      chave="financeiro.recebimentos"
      url={url}
      params={params}
      defs={COLUNAS}
      chaveLinha={(r, i) => `${r.codemp}-${r.codfil}-${r.numtit}-${i}`}
      rotulo="recebimentos"
      vazio="Nenhum recebimento encontrado com os filtros atuais."
    />
  );
}
