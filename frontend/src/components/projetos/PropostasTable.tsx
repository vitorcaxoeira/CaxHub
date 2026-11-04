import axios from "axios";
import { useEffect, useState } from "react";
import { formatHoras } from "../../utils/horas";
import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";

// Lista de propostas com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (ListaServidor, trazido
// do CaxHub_Dash em 03/11/2026). Os rótulos (situação, depto., modalidade, forma de faturamento) já vêm do servidor, que filtra por eles.

export interface PropostaRow {
  codemp: number;
  codpro: number;
  codcli: number;
  nomcli: string;
  cliente: string;
  datpro: string | null;
  datret: string | null;
  sitpro: number | null;
  numprj: number | null;
  valor: number;
  horas: number;
  pripro: number | null;
  depexe: string;
  modalidade: string;
  forfat: string;
  despro: string | null;
  situacao: string;
  tom: "success" | "warning" | "destructive" | "neutral";
}

interface PropostaItemDrillDown {
  seqite: number;
  codser: string;
  despro: string | null;
  horas: number;
  valhor: number;
  valor: number;
  depexeLabel: string;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtData = (v: string | null) => (v ? dateFormatter.format(new Date(v)) : "—");

const toneTag: Record<string, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "bg-muted/15 text-muted",
};

const COLUNAS: DefColuna<PropostaRow>[] = [
  {
    nome: "codpro",
    titulo: "Proposta",
    fixa: true,
    largura: 100,
    resumos: ["contagem", "distintos"],
    render: (r) => (
      <>
        <div className="text-sm font-semibold text-foreground">{r.codpro}</div>
        {r.numprj != null && r.numprj !== 0 && <div className="mt-0.5 font-mono text-[11px] text-muted">Projeto {r.numprj}</div>}
      </>
    ),
  },
  { nome: "numprj", ocultaPorPadrao: true, titulo: "Projeto", largura: 90, classe: "font-mono text-muted", resumos: ["contagem", "distintos", "vazios"], render: (r) => r.numprj ?? "—" },
  { nome: "cliente", titulo: "Cliente", largura: 260, classe: "text-foreground", texto: (r) => r.cliente, render: (r) => r.cliente },
  { nome: "datpro", titulo: "Data", largura: 100, classe: "font-mono text-muted", render: (r) => fmtData(r.datpro) },
  { nome: "datret", titulo: "Aprovação", largura: 100, classe: "font-mono text-muted", render: (r) => fmtData(r.datret) },
  { nome: "despro", titulo: "Descrição", largura: 200, classe: "text-muted", texto: (r) => r.despro, render: (r) => r.despro ?? "—" },
  { nome: "depexe", titulo: "Depto. Executor", largura: 160, classe: "text-muted", texto: (r) => r.depexe, render: (r) => r.depexe },
  { nome: "modalidade", ocultaPorPadrao: true, titulo: "Modalidade", largura: 140, classe: "text-muted", texto: (r) => r.modalidade, render: (r) => r.modalidade },
  { nome: "forfat", titulo: "Forma Fat.", largura: 130, classe: "text-muted", texto: (r) => r.forfat, render: (r) => r.forfat },
  {
    nome: "horas",
    titulo: "Horas",
    direita: true,
    largura: 90,
    classe: "font-mono tabular-nums text-muted",
    formatarResumo: (v) => formatHoras(v),
    render: (r) => formatHoras(r.horas),
  },
  {
    nome: "valor",
    titulo: "Valor",
    direita: true,
    largura: 140,
    classe: "font-mono font-semibold tabular-nums text-foreground",
    formatarResumo: fmtMoney,
    render: (r) => fmtMoney(r.valor),
  },
  {
    nome: "situacao",
    titulo: "Situação",
    largura: 170,
    texto: (r) => r.situacao,
    render: (r) => (
      <span className={`inline-block whitespace-nowrap rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${toneTag[r.tom]}`}>
        {r.situacao}
      </span>
    ),
  },
];

/** Itens de uma proposta (linha aberta da lista). */
function ItensProposta({ codemp, codpro }: { codemp: number; codpro: number }) {
  const [itens, setItens] = useState<PropostaItemDrillDown[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    axios
      .get(`/api/projetos/propostas/${codemp}/${codpro}/itens`)
      .then(({ data }) => !cancelado && setItens(data.rows))
      .catch(() => !cancelado && setErro(true));
    return () => {
      cancelado = true;
    };
  }, [codemp, codpro]);

  if (erro) return <p className="text-[11.5px] text-destructive">Falha ao carregar os itens.</p>;
  if (!itens) return <p className="text-[11.5px] text-muted">Carregando itens...</p>;
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr className="text-left text-muted">
          <th className="pb-1.5 pr-4 font-medium">Seq.</th>
          <th className="pb-1.5 pr-4 font-medium">Serviço</th>
          <th className="pb-1.5 pr-4 font-medium">Descrição</th>
          <th className="pb-1.5 pr-4 font-medium">Depto. Executor</th>
          <th className="pb-1.5 pr-4 text-right font-medium">Horas</th>
          <th className="pb-1.5 pr-4 text-right font-medium">Valor/Hora</th>
          <th className="pb-1.5 text-right font-medium">Valor</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((item) => (
          <tr key={item.seqite} className="border-t border-border/40">
            <td className="py-1.5 pr-4 font-mono text-muted">{item.seqite}</td>
            <td className="py-1.5 pr-4 font-mono text-foreground">{item.codser}</td>
            <td className="py-1.5 pr-4 text-foreground">{item.despro ?? "—"}</td>
            <td className="py-1.5 pr-4 text-muted">{item.depexeLabel}</td>
            <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-muted">{formatHoras(item.horas)}</td>
            <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-muted">{fmtMoney(item.valhor)}</td>
            <td className="py-1.5 text-right font-mono tabular-nums text-foreground">{fmtMoney(item.valor)}</td>
          </tr>
        ))}
        {itens.length === 0 && (
          <tr>
            <td colSpan={7} className="py-2 text-center text-muted">
              Sem itens cadastrados.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function PropostasTable({ url, params }: { url: string; params: Record<string, unknown> }) {
  return (
    <ListaServidor<PropostaRow>
      chave="projetos.propostas"
      url={url}
      params={params}
      defs={COLUNAS}
      chaveLinha={(r) => `${r.codemp}-${r.codpro}`}
      rotulo="propostas"
      vazio="Nenhuma proposta encontrada com os filtros atuais."
      detalhe={(r) => <ItensProposta codemp={r.codemp} codpro={r.codpro} />}
      rodape={(d) => (
        <div className="grid grid-cols-1 gap-px border-t border-border bg-border sm:grid-cols-2">
          <div className="bg-surface px-5 py-3">
            <p className="text-[10.5px] text-muted">Valor total (filtro atual)</p>
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{fmtMoney(d?.totais?.valor ?? 0)}</p>
          </div>
          <div className="bg-surface px-5 py-3">
            <p className="text-[10.5px] text-muted">Horas totais (filtro atual)</p>
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatHoras(d?.totais?.horas ?? 0)}</p>
          </div>
        </div>
      )}
    />
  );
}
