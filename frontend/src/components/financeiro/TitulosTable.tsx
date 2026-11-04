import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";

export interface TituloRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  abrtpt: string;
  unidade: string;
  titulo: string;
  codcli: number;
  nomcli: string;
  cliente: string;
  nomemp: string;
  nomfil: string;
  datemi: string;
  vctpro: string;
  vlrori: number;
  vlrabe: number;
  // Símbolo da moeda do título (ex.: "R$", "U$") — null cai no "R$" padrão.
  moeda_sigla: string | null;
  sittit: string;
  dias_atraso: number;
  situacao: string;
  tom: "success" | "warning" | "destructive";
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const toneTag: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

// Filtro e ordem por coluna, resumo no rodapé e colunas calculadas (ListaServidor, 29/10/2026).
const COLUNAS: DefColuna<TituloRow>[] = [
  { nome: "unidade", titulo: "Emp/Fil", fixa: true, classe: "font-mono text-muted", largura: 90, render: (r) => r.unidade },
  { nome: "titulo", titulo: "Título", classe: "font-mono text-muted", largura: 150, render: (r) => r.titulo },
  { nome: "cliente", titulo: "Cliente", classe: "font-semibold text-foreground", largura: 300, texto: (r) => r.cliente, render: (r) => r.cliente },
  { nome: "datemi", titulo: "Emissão", classe: "font-mono text-muted", largura: 110, render: (r) => dateFormatter.format(new Date(r.datemi)) },
  { nome: "vctpro", titulo: "Vencimento", classe: "font-mono text-muted", largura: 110, render: (r) => dateFormatter.format(new Date(r.vctpro)) },
  {
    nome: "vlrori",
    titulo: "Valor original",
    direita: true,
    largura: 150,
    classe: "text-muted",
    formatarResumo: (v) => currencyFormatter.format(v),
    avisoResumo: "Soma valores de moedas diferentes quando há mais de uma",
    render: (r) => `${r.moeda_sigla ?? "R$"} ${currencyFormatter.format(r.vlrori)}`,
  },
  {
    nome: "vlrabe",
    titulo: "Valor em aberto",
    direita: true,
    largura: 150,
    classe: "font-semibold text-foreground",
    formatarResumo: (v) => currencyFormatter.format(v),
    avisoResumo: "Soma valores de moedas diferentes quando há mais de uma",
    render: (r) => `${r.moeda_sigla ?? "R$"} ${currencyFormatter.format(r.vlrabe)}`,
  },
  { nome: "dias_atraso", titulo: "Dias de atraso", direita: true, classe: "font-mono tabular-nums text-muted", largura: 110, render: (r) => r.dias_atraso },
  {
    nome: "situacao",
    titulo: "Situação",
    largura: 200,
    texto: (r) => r.situacao,
    render: (r) => (
      <span className={`inline-block whitespace-nowrap rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${toneTag[r.tom]}`}>
        {r.situacao}
      </span>
    ),
  },
];

export function TitulosTable({ url, params, recarga }: { url: string; params: Record<string, unknown>; recarga?: unknown }) {
  return (
    <ListaServidor<TituloRow>
      chave="financeiro.titulos-receber"
      url={url}
      recarga={recarga}
      params={params}
      defs={COLUNAS}
      chaveLinha={(r) => `${r.codemp}-${r.codfil}-${r.numtit}-${r.codtpt}`}
      rotulo="títulos"
      vazio="Nenhum título encontrado com os filtros atuais."
      rodape={(d) => (
        <div className="grid grid-cols-1 gap-px border-t border-border bg-border sm:grid-cols-3">
          <div className="bg-surface px-5 py-3">
            <p className="text-[10.5px] text-muted">Total Vencido (filtro atual)</p>
            <p className="font-mono text-sm font-semibold tabular-nums text-destructive">R$ {currencyFormatter.format(d?.totais?.vlr_vencido ?? 0)}</p>
          </div>
          <div className="bg-surface px-5 py-3">
            <p className="text-[10.5px] text-muted">Total A Vencer (filtro atual)</p>
            <p className="font-mono text-sm font-semibold tabular-nums text-success">R$ {currencyFormatter.format(d?.totais?.vlr_a_vencer ?? 0)}</p>
          </div>
          <div className="bg-surface px-5 py-3">
            <p className="text-[10.5px] text-muted">Total Pago (filtro atual)</p>
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">R$ {currencyFormatter.format(d?.totais?.vlr_pago ?? 0)}</p>
          </div>
        </div>
      )}
    />
  );
}
