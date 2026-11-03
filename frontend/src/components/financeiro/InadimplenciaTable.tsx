import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";

export interface InadimplenciaRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codcli: number;
  nomcli: string;
  cliente: string;
  vctpro: string;
  vlrabe: number;
  dias_atraso: number;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Filtro e ordem por coluna, resumo no rodapé e colunas calculadas (ListaServidor, 29/10/2026).
const COLUNAS: DefColuna<InadimplenciaRow>[] = [
  { nome: "numtit", titulo: "Título", fixa: true, classe: "font-mono text-muted", largura: 130, render: (r) => r.numtit },
  { nome: "cliente", titulo: "Cliente", classe: "text-foreground", largura: 300, texto: (r) => r.cliente, render: (r) => r.cliente },
  { nome: "vctpro", titulo: "Vencimento", classe: "font-mono text-muted", largura: 110, render: (r) => dateFormatter.format(new Date(r.vctpro)) },
  { nome: "dias_atraso", titulo: "Dias Atraso", direita: true, classe: "font-mono font-semibold tabular-nums text-destructive", largura: 110, render: (r) => r.dias_atraso },
  { nome: "vlrabe", titulo: "Valor Vencido", direita: true, classe: "font-semibold text-foreground", largura: 150, formatarResumo: (v) => currency.format(v), render: (r) => currency.format(r.vlrabe) },
];

export function InadimplenciaTable({ url, params }: { url: string; params: Record<string, unknown> }) {
  return (
    <ListaServidor<InadimplenciaRow>
      chave="financeiro.inadimplencia"
      url={url}
      params={params}
      defs={COLUNAS}
      chaveLinha={(r) => `${r.codemp}-${r.codfil}-${r.numtit}`}
      rotulo="títulos vencidos"
      vazio="Nenhum título vencido encontrado com os filtros atuais."
    />
  );
}
