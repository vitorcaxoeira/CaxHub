import axios from "axios";
import { useState } from "react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";

export interface OperacionalRow {
  numtit: string;
  codtpt: string;
  titulo: string;
  codcli: number;
  nomcli: string;
  cliente: string;
  datemi: string;
  vctpro: string;
  valor: number;
  dias_atraso: number;
  situacao: string;
  tom: "success" | "warning" | "destructive";
}

interface OperacionalTitulosTableProps {
  corte: string;
  empFilIds?: string;
  recarga?: unknown;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const toneBadge: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

// Filtro e ordem por coluna, resumo no rodapé e colunas calculadas (ListaServidor, 29/10/2026).
const COLUNAS: DefColuna<OperacionalRow>[] = [
  { nome: "titulo", titulo: "Título", fixa: true, classe: "font-mono text-muted", largura: 150, render: (r) => r.titulo },
  { nome: "cliente", titulo: "Cliente", classe: "text-foreground", largura: 300, texto: (r) => r.cliente, render: (r) => r.cliente },
  { nome: "datemi", titulo: "Emissão", classe: "font-mono text-muted", largura: 110, render: (r) => dateFormatter.format(new Date(r.datemi)) },
  { nome: "vctpro", titulo: "Vencimento", classe: "font-mono text-muted", largura: 110, render: (r) => dateFormatter.format(new Date(r.vctpro)) },
  { nome: "valor", titulo: "Valor", direita: true, largura: 140, classe: "font-semibold text-foreground", formatarResumo: fmtMoney, render: (r) => fmtMoney(r.valor) },
  { nome: "dias_atraso", titulo: "Dias Atraso", direita: true, classe: "font-mono tabular-nums text-muted", largura: 100, render: (r) => r.dias_atraso },
  {
    nome: "situacao",
    titulo: "Situação",
    largura: 160,
    texto: (r) => r.situacao,
    render: (r) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneBadge[r.tom]}`}>{r.situacao}</span>,
  },
];

export function OperacionalTitulosTable({ corte, empFilIds, recarga }: OperacionalTitulosTableProps) {
  const [query, setQuery] = useState("");
  const busca = useDebouncedValue(query.trim(), 300);
  const [exportando, setExportando] = useState(false);
  const [total, setTotal] = useState(0);

  async function handleExportar() {
    setExportando(true);
    try {
      const { data } = await axios.get("/api/financeiro/fluxo-caixa/operacional/titulos", {
        params: { corte, empFil: empFilIds, q: query || undefined, formato: "csv" },
        responseType: "blob",
      });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fluxo-caixa-${corte}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportando(false);
    }
  }

  return (
    <ListaServidor<OperacionalRow>
      chave="financeiro.fluxo-caixa.operacional"
      url="/api/financeiro/fluxo-caixa/operacional/titulos"
      params={{ empFil: empFilIds, corte, q: busca || undefined }}
      recarga={recarga}
      defs={COLUNAS}
      chaveLinha={(r, i) => `${r.numtit}-${r.codtpt}-${i}`}
      rotulo="títulos"
      vazio="Nenhum título encontrado com os filtros atuais."
      aoCarregar={(d) => setTotal(d.total)}
      topo={() => (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por cliente ou número do título..."
            className="min-w-[240px] flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            onClick={handleExportar}
            disabled={exportando || total === 0}
            title="Exporta todos os títulos do corte (os filtros por coluna não valem no CSV)"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-[11.5px] font-medium text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportando ? "Exportando..." : "Exportar CSV"}
          </button>
        </>
      )}
    />
  );
}
