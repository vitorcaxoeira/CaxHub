import { useNavigate } from "react-router-dom";
import { ListaServidor } from "../colunas/ListaServidor";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import { toneBadge, type Tone } from "../ui/badges";

// Aba Lista de Mercado › Listar Pedidos (03/11/2026, trazido do CaxHub_Dash): filtro e ordem por coluna, colunas configuráveis, resumo no
// rodapé e colunas calculadas (ListaServidor + registrarListaConsultavel em GET /pedidos). Os rótulos já vêm do servidor, que filtra por
// eles. A aba Por Cliente continua com a própria tabela (LinhaPedido em pages/mercado/ListarPedidos.tsx).

export interface PedidoLista {
  codemp: number;
  codfil: number;
  numped: number;
  cliente: string;
  datemi: string;
  datprv: string | null;
  obsmot: string | null;
  vlrbse: number | null;
  vlrliq: number | null;
  pedcli: string | null;
  situacao: string;
  sitpedTone: Tone;
  numrat: string | null;
  ratId: number | null;
  consultor: string | null;
  propostaCodpro: number | null;
  propostaCodlev2: number | null;
  proposta: string | null;
  propostaDescricao: string | null;
  modalidade: string | null;
  modalidadeTone: Tone | null;
  situacaoProposta: string | null;
  situacaoPropostaTone: Tone | null;
  faturamento: string | null;
  formaPagamento: string | null;
  condicaoPagamento: string | null;
}

type Navegar = (rota: string) => void;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const currencyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number) => `R$ ${currencyFormatter.format(v)}`;
const fmtData = (v: string | null) => (v ? dateFormatter.format(new Date(v)) : "—");

function Selo({ texto, tone }: { texto: string | null; tone: Tone | null }) {
  if (texto == null || tone == null) return <span className="text-sm text-muted">—</span>;
  return (
    <span className={`inline-block max-w-full truncate whitespace-nowrap align-bottom rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[tone]}`} title={texto}>
      {texto}
    </span>
  );
}

const texto = (v: string | null) => v ?? "—";

const COLUNAS: DefColuna<PedidoLista, Navegar>[] = [
  {
    nome: "numped",
    titulo: "Pedido",
    fixa: true,
    largura: 90,
    resumos: ["contagem", "distintos"],
    render: (p, navegar) => (
      <button
        onClick={(e) => {
          e.stopPropagation();
          navegar(`/mercado/pedido/${p.codemp}/${p.codfil}/${p.numped}`);
        }}
        className="font-mono text-sm font-semibold text-primary hover:underline"
      >
        {p.numped}
      </button>
    ),
  },
  { nome: "cliente", titulo: "Cliente", largura: 220, classe: "text-sm text-foreground", texto: (p) => p.cliente, render: (p) => p.cliente },
  {
    nome: "situacao",
    titulo: "Situação",
    largura: 150,
    title: (p) => p.obsmot ?? p.situacao,
    render: (p) => <Selo texto={p.situacao} tone={p.sitpedTone} />,
  },
  {
    nome: "numrat",
    titulo: "Rat",
    largura: 90,
    render: (p, navegar) =>
      p.ratId != null ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navegar(`/projetos/rat/${p.ratId}`);
          }}
          className="font-mono text-sm text-primary hover:underline"
        >
          {p.numrat}
        </button>
      ) : (
        <span className="font-mono text-sm text-muted">{texto(p.numrat)}</span>
      ),
  },
  { nome: "consultor", titulo: "Consultor", largura: 150, classe: "text-sm text-muted", texto: (p) => p.consultor, render: (p) => texto(p.consultor) },
  {
    nome: "proposta",
    titulo: "Proposta",
    largura: 120,
    render: (p, navegar) =>
      p.propostaCodpro != null ? (
        <span className="inline-flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navegar(`/projetos/proposta/${p.codemp}/${p.propostaCodpro}`);
            }}
            className="font-mono text-sm text-primary hover:underline"
          >
            {p.propostaCodpro}
          </button>
          {p.propostaCodlev2 != null && p.propostaCodlev2 !== 0 && (
            <>
              <span className="text-sm text-muted">→</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navegar(`/projetos/proposta/${p.codemp}/${p.propostaCodlev2}`);
                }}
                className="font-mono text-sm text-primary hover:underline"
              >
                {p.propostaCodlev2}
              </button>
            </>
          )}
        </span>
      ) : (
        <span className="text-sm text-muted">—</span>
      ),
  },
  { nome: "propostaDescricao", titulo: "Desc. Proposta", largura: 220, classe: "text-sm text-muted", texto: (p) => p.propostaDescricao, render: (p) => texto(p.propostaDescricao) },
  { nome: "modalidade", titulo: "Mod. Prop.", largura: 130, render: (p) => <Selo texto={p.modalidade} tone={p.modalidadeTone} /> },
  { nome: "situacaoProposta", titulo: "Sit. Prop.", largura: 150, render: (p) => <Selo texto={p.situacaoProposta} tone={p.situacaoPropostaTone} /> },
  { nome: "faturamento", titulo: "Faturamento", largura: 130, classe: "text-sm text-muted", texto: (p) => p.faturamento, render: (p) => texto(p.faturamento) },
  {
    nome: "vlrbse",
    titulo: "Valor Serviços",
    dica: "Soma dos valores dos itens de serviços do pedido (E120PED.VlrBse)",
    direita: true,
    largura: 130,
    classe: "font-mono text-sm tabular-nums text-foreground",
    formatarResumo: formatMoney,
    render: (p) => (p.vlrbse != null ? formatMoney(p.vlrbse) : "—"),
  },
  {
    nome: "vlrliq",
    titulo: "Valor Líquido",
    direita: true,
    largura: 130,
    classe: "font-mono text-sm tabular-nums text-foreground",
    formatarResumo: formatMoney,
    render: (p) => (p.vlrliq != null ? formatMoney(p.vlrliq) : "—"),
  },
  { nome: "obsmot", titulo: "Obs. Mot.", largura: 160, classe: "text-sm text-muted", texto: (p) => p.obsmot, render: (p) => texto(p.obsmot) },
  { nome: "datemi", titulo: "Emissão", largura: 100, classe: "font-mono text-sm text-muted", render: (p) => fmtData(p.datemi) },
  { nome: "datprv", ocultaPorPadrao: true, titulo: "Previsão", largura: 100, classe: "font-mono text-sm text-muted", render: (p) => fmtData(p.datprv) },
  { nome: "pedcli", ocultaPorPadrao: true, titulo: "Ped. Cliente", largura: 120, classe: "font-mono text-sm text-muted", texto: (p) => p.pedcli, render: (p) => texto(p.pedcli) },
  { nome: "formaPagamento", titulo: "Forma Pgto", largura: 120, classe: "text-sm text-muted", texto: (p) => p.formaPagamento, render: (p) => texto(p.formaPagamento) },
  {
    nome: "condicaoPagamento", ocultaPorPadrao: true,
    titulo: "Cond. Pgto",
    largura: 120,
    classe: "text-sm text-muted",
    texto: (p) => p.condicaoPagamento,
    render: (p) => texto(p.condicaoPagamento),
  },
];

// Dentro de um cliente expandido (aba Por Cliente) a coluna Cliente é o cabeçalho do próprio grupo: sai da tabela. Constante do módulo
// porque ListaServidor exige defs estáveis.
const COLUNAS_SEM_CLIENTE = COLUNAS.filter((c) => c.nome !== "cliente");

/**
 * `semCliente`: tabela de UM cliente (aba Por Cliente) — sem a coluna Cliente (Qtd./Valor já estão na linha do cliente). `chave` separa a
 * arrumação das colunas (e as calculadas) da aba Lista. Nenhuma das duas tem rodapé de total; o resumo por coluna é opcional (ícone Σ).
 */
export function TabelaPedidos({
  params,
  recarga,
  chave = "mercado.pedidos",
  semCliente = false,
  tituloImpressao = "Listar Pedidos",
}: {
  params: Record<string, unknown>;
  recarga?: unknown;
  chave?: string;
  semCliente?: boolean;
  /** Título do relatório impresso (na aba Por Cliente, o nome do cliente). */
  tituloImpressao?: string;
}) {
  const navigate = useNavigate();
  return (
    <ListaServidor<PedidoLista, Navegar>
      chave={chave}
      url="/api/pedidos"
      params={params}
      recarga={recarga}
      defs={semCliente ? COLUNAS_SEM_CLIENTE : COLUNAS}
      exportavel="pedidos"
      rotuloExportar="Exportar Excel"
      imprimir={{ titulo: tituloImpressao }}
      pdf={{ titulo: tituloImpressao, arquivo: "pedidos" }}
      ctx={navigate}
      chaveLinha={(p) => `${p.codemp}-${p.codfil}-${p.numped}`}
      rotulo="pedidos"
      vazio="Nenhum pedido encontrado com esses filtros."
      pageSize={30}
      opcoesPorPagina={[30, 50, 100, 200]}
    />
  );
}
