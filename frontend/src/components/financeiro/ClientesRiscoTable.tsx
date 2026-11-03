import axios from "axios";
import { useEffect, useState } from "react";
import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";

export interface ClienteRiscoRow {
  codcli: number;
  nomcli: string;
  cliente: string;
  valor_aberto: number;
  valor_vencido: number;
  atraso_medio: number;
  maior_atraso: number;
  score: number;
}

interface TituloDrillDown {
  numtit: string;
  codtpt: string;
  vctpro: string;
  valor: number;
  diasAtraso: number;
  situacaoLabel: string;
  situacaoTone: "success" | "warning" | "destructive";
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const toneBadge: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

function toneScore(score: number): "success" | "warning" | "destructive" {
  if (score < 34) return "success";
  if (score <= 66) return "warning";
  return "destructive";
}

// Filtro e ordem por coluna, resumo no rodapé e colunas calculadas (ListaServidor, 29/10/2026). Clique na linha abre os títulos do cliente.
const COLUNAS: DefColuna<ClienteRiscoRow>[] = [
  { nome: "cliente", titulo: "Cliente", fixa: true, classe: "text-foreground", largura: 320, texto: (r) => r.cliente, render: (r) => r.cliente },
  { nome: "valor_aberto", titulo: "Valor Aberto", direita: true, largura: 150, classe: "text-foreground", formatarResumo: fmtMoney, render: (r) => fmtMoney(r.valor_aberto) },
  { nome: "valor_vencido", titulo: "Valor Vencido", direita: true, largura: 150, classe: "text-destructive", formatarResumo: fmtMoney, render: (r) => fmtMoney(r.valor_vencido) },
  {
    nome: "atraso_medio",
    titulo: "Atraso Médio",
    direita: true,
    largura: 120,
    classe: "text-muted",
    formatarResumo: (v) => `${Math.round(v)} dias`,
    render: (r) => `${Math.round(r.atraso_medio)} dias`,
  },
  { nome: "maior_atraso", titulo: "Maior Atraso", direita: true, largura: 120, classe: "text-muted", formatarResumo: (v) => `${Math.round(v)} dias`, render: (r) => `${r.maior_atraso} dias` },
  {
    nome: "score",
    titulo: "Score",
    direita: true,
    largura: 100,
    dica: "Vencido × atraso médio, de 0 a 100 entre os clientes do recorte",
    formatarResumo: (v) => String(Math.round(v)),
    render: (r) => <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-semibold ${toneBadge[toneScore(r.score)]}`}>{r.score}</span>,
  },
];

function TitulosDoCliente({ codcli, empFilIds, base }: { codcli: number; empFilIds?: string; base: string }) {
  const [titulos, setTitulos] = useState<TituloDrillDown[] | null>(null);
  useEffect(() => {
    let cancelado = false;
    axios
      .get(`${base}/${codcli}/titulos`, { params: { empFil: empFilIds } })
      .then(({ data }) => !cancelado && setTitulos(data.rows))
      .catch(() => !cancelado && setTitulos([]));
    return () => {
      cancelado = true;
    };
  }, [codcli, empFilIds, base]);
  if (!titulos) return <p className="text-[11.5px] text-muted">Carregando títulos...</p>;
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr className="text-left text-muted">
          <th className="pb-1.5 pr-4 font-medium">Título</th>
          <th className="pb-1.5 pr-4 font-medium">Vencimento</th>
          <th className="pb-1.5 pr-4 text-right font-medium">Valor</th>
          <th className="pb-1.5 pr-4 text-right font-medium">Dias Atraso</th>
          <th className="pb-1.5 font-medium">Situação</th>
        </tr>
      </thead>
      <tbody>
        {titulos.map((t) => (
          <tr key={`${t.numtit}-${t.codtpt}`} className="border-t border-border/40">
            <td className="py-1.5 pr-4 font-mono text-foreground">
              {t.numtit} - {t.codtpt}
            </td>
            <td className="py-1.5 pr-4 font-mono text-muted">{dateFormatter.format(new Date(t.vctpro))}</td>
            <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-foreground">{fmtMoney(t.valor)}</td>
            <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-destructive">{t.diasAtraso}</td>
            <td className="py-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneBadge[t.situacaoTone]}`}>{t.situacaoLabel}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ClientesRiscoTable({ url, params, empFilIds, recarga }: { url: string; params: Record<string, unknown>; empFilIds?: string; recarga?: unknown }) {
  return (
    <ListaServidor<ClienteRiscoRow>
      chave="financeiro.fluxo-caixa.clientes-risco"
      url={url}
      params={params}
      recarga={recarga}
      defs={COLUNAS}
      pageSize={20}
      chaveLinha={(r) => String(r.codcli)}
      rotulo="clientes"
      vazio="Nenhum cliente em risco encontrado com os filtros atuais."
      detalhe={(r) => <TitulosDoCliente codcli={r.codcli} empFilIds={empFilIds} base={url} />}
    />
  );
}
