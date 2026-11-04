import axios from "axios";
import { useEffect, useState } from "react";
import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";

// Ranking de representantes com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (ListaServidor +
// registrarListaConsultavel em GET /projetos/propostas/representantes-ranking, 03/11/2026). A linha abre as propostas abertas do representante.

export interface RepresentanteRow {
  codrep: number;
  nomrep: string;
  propostasAbertas: number;
  valorPipeline: number;
  ganhas: number;
  perdidas: number;
  winRatePct: number | null;
  cicloMedioDias: number | null;
}

interface PropostaAbertaDrillDown {
  codpro: number;
  codcli: number;
  nomcli: string;
  datpro: string | null;
  valor: number;
  situacaoLabel: string;
  situacaoTone: "success" | "warning" | "destructive" | "neutral";
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const toneBadge: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

const COLUNAS: DefColuna<RepresentanteRow>[] = [
  { nome: "nomrep", titulo: "Representante", fixa: true, largura: 240, classe: "text-sm text-foreground", texto: (r) => r.nomrep, render: (r) => r.nomrep },
  {
    nome: "propostasAbertas",
    titulo: "Propostas Abertas",
    direita: true,
    largura: 130,
    classe: "font-mono text-sm tabular-nums text-foreground",
    render: (r) => r.propostasAbertas.toLocaleString("pt-BR"),
  },
  { nome: "valorPipeline", titulo: "Valor Pipeline", direita: true, largura: 150, classe: "font-mono text-sm tabular-nums text-foreground", formatarResumo: fmtMoney, render: (r) => fmtMoney(r.valorPipeline) },
  { nome: "ganhas", titulo: "Ganhas", direita: true, largura: 90, classe: "font-mono text-sm tabular-nums text-muted", render: (r) => r.ganhas },
  { nome: "perdidas", titulo: "Perdidas", direita: true, largura: 90, classe: "font-mono text-sm tabular-nums text-muted", render: (r) => r.perdidas },
  {
    nome: "winRatePct",
    titulo: "Win Rate",
    direita: true,
    largura: 100,
    classe: "font-mono text-sm tabular-nums text-foreground",
    formatarResumo: (v) => `${v.toFixed(1)}%`,
    render: (r) => (r.winRatePct === null ? "—" : `${r.winRatePct.toFixed(1)}%`),
  },
  {
    nome: "cicloMedioDias",
    titulo: "Ciclo Médio",
    direita: true,
    largura: 110,
    classe: "font-mono text-sm tabular-nums text-muted",
    formatarResumo: (v) => `${Math.round(v)} dias`,
    render: (r) => (r.cicloMedioDias === null ? "—" : `${Math.round(r.cicloMedioDias)} dias`),
  },
];

/** Propostas abertas de um representante (linha aberta do ranking), com os mesmos filtros da tela. */
function PropostasAbertas({ codrep, params }: { codrep: number; params: Record<string, string | undefined> }) {
  const [propostas, setPropostas] = useState<PropostaAbertaDrillDown[] | null>(null);
  const chave = JSON.stringify(params);
  useEffect(() => {
    let cancelado = false;
    axios
      .get(`/api/projetos/propostas/representantes-ranking/${codrep}/propostas-abertas`, { params: JSON.parse(chave) })
      .then(({ data }) => !cancelado && setPropostas(data.rows))
      .catch(() => !cancelado && setPropostas([]));
    return () => {
      cancelado = true;
    };
  }, [codrep, chave]);

  if (!propostas) return <p className="text-[11.5px] text-muted">Carregando propostas...</p>;
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr className="text-left text-muted">
          <th className="pb-1.5 pr-4 font-medium">Proposta</th>
          <th className="pb-1.5 pr-4 font-medium">Cliente</th>
          <th className="pb-1.5 pr-4 font-medium">Data</th>
          <th className="pb-1.5 pr-4 text-right font-medium">Valor</th>
          <th className="pb-1.5 font-medium">Situação</th>
        </tr>
      </thead>
      <tbody>
        {propostas.map((p) => (
          <tr key={p.codpro} className="border-t border-border/40">
            <td className="py-1.5 pr-4 font-mono text-foreground">{p.codpro}</td>
            <td className="py-1.5 pr-4 text-foreground">
              {p.codcli} - {p.nomcli}
            </td>
            <td className="py-1.5 pr-4 font-mono text-muted">{p.datpro ? dateFormatter.format(new Date(p.datpro)) : "—"}</td>
            <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-foreground">{fmtMoney(p.valor)}</td>
            <td className="py-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneBadge[p.situacaoTone]}`}>{p.situacaoLabel}</span>
            </td>
          </tr>
        ))}
        {propostas.length === 0 && (
          <tr>
            <td colSpan={5} className="py-2 text-center text-muted">
              Sem propostas abertas.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function RankingRepresentantes({
  params,
  empFiltroParams,
}: {
  /** Filtros do topo da tela (clientes, representantes, tipo de venda, modalidade, período). */
  params: Record<string, string | undefined>;
  /** Os mesmos filtros sem o de representante: o detalhe da linha já é de um representante. */
  empFiltroParams: Record<string, string | undefined>;
}) {
  return (
    <ListaServidor<RepresentanteRow>
      chave="projetos.propostas.representantes"
      url="/api/projetos/propostas/representantes-ranking"
      params={params}
      defs={COLUNAS}
      chaveLinha={(r) => String(r.codrep)}
      detalhe={(r) => <PropostasAbertas codrep={r.codrep} params={empFiltroParams} />}
      rotulo="representantes"
      vazio="Nenhum representante encontrado com os filtros atuais."
      pageSize={20}
      opcoesPorPagina={[20, 50, 100]}
    />
  );
}
