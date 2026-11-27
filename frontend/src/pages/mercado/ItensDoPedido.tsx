import { useState } from "react";
import { toneBadge, type Tone } from "../../components/ui/badges";
import { Tabs } from "../../components/ui/Tabs";
import { TabelaLocal } from "../../components/colunas/TabelaLocal";
import type { ColunaLocal } from "../../components/colunas/aplicarLocal";
import type { DefColuna } from "../../components/colunas/useColunasConfiguraveis";

// Abas "Itens de Produto" e "Itens de Serviço" da visualização do pedido (portadas do CaxHub_Dash, 27/11/2026). Cada tabela tem filtro e
// ordem por coluna, resumo no rodapé e colunas calculadas (TabelaLocal).

export interface ItemProdutoDto {
  seqipd: number;
  codpro: string | null;
  produtoLabel: string;
  codder: string | null;
  complemento: string | null;
  qtdped: number;
  qtdaen: number | null;
  qtdfat: number | null;
  qtdcan: number | null;
  qtdabe: number | null;
  unimed: string | null;
  preuni: number | null;
  moedaSigla: string | null;
  vlrliq: number | null;
  datent: string | null;
  sitipdLabel: string;
  sitipdTone: Tone;
}

export interface ItemServicoDto {
  seqisp: number;
  codser: string | null;
  servicoLabel: string;
  complemento: string | null;
  qtdped: number;
  qtdrea: number | null;
  qtdfat: number | null;
  qtdcan: number | null;
  qtdabe: number | null;
  unimed: string | null;
  preuni: number;
  moedaSigla: string | null;
  vlrliq: number | null;
  datent: string | null;
  sitispLabel: string;
  sitispTone: Tone;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const currencyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtdFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const formatMoney = (v: number, simbolo?: string | null) => `${simbolo ?? "R$"} ${currencyFormatter.format(v)}`;
const fmtQtd = (v: number | null) => (v == null ? "—" : qtdFormatter.format(v));
const formatData = (valor: string | null) => (valor ? dateFormatter.format(new Date(valor)) : "—");

const selo = (rotulo: string, tom: Tone) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${toneBadge[tom]}`}>{rotulo}</span>;

// "código — descrição" é o texto do funil, da ordem e da dica da célula.
const textoProduto = (i: ItemProdutoDto) => `${i.codpro ?? "—"} — ${i.produtoLabel}`;
const textoServico = (i: ItemServicoDto) => `${i.codser ?? "—"} — ${i.servicoLabel}`;

const referencia = (codigo: string | null, descricao: string, complemento: string | null) => (
  <>
    <span className="font-mono">{codigo ?? "—"}</span> — {descricao}
    {complemento && <p className="text-[11px] italic text-muted">{complemento}</p>}
  </>
);

function colunaQuantidade<T>(nome: string, titulo: string, ler: (item: T) => number | null): DefColuna<T> {
  return { nome, titulo, direita: true, largura: 110, classe: "font-mono tabular-nums text-foreground", formatarResumo: (v) => fmtQtd(v), render: (i) => fmtQtd(ler(i)) };
}

function colunaValorLiquido<T extends { vlrliq: number | null; moedaSigla: string | null }>(): DefColuna<T> {
  return {
    nome: "vlrliq",
    titulo: "Valor Líquido",
    direita: true,
    largura: 140,
    classe: "font-mono tabular-nums text-foreground",
    avisoResumo: "Soma valores de moedas diferentes quando há mais de uma",
    formatarResumo: (v) => formatMoney(v),
    render: (i) => (i.vlrliq != null ? formatMoney(i.vlrliq, i.moedaSigla) : "—"),
  };
}

const COLUNAS_PRODUTO: DefColuna<ItemProdutoDto>[] = [
  { nome: "seqipd", titulo: "Seq.", fixa: true, direita: true, largura: 70, classe: "font-mono tabular-nums text-muted", render: (i) => i.seqipd },
  { nome: "produto", titulo: "Produto", largura: 320, quebra: true, classe: "text-foreground", texto: textoProduto, render: (i) => referencia(i.codpro, i.produtoLabel, i.complemento) },
  colunaQuantidade("qtdped", "Pedida", (i) => i.qtdped),
  colunaQuantidade("qtdaen", "A Entregar", (i) => i.qtdaen),
  colunaQuantidade("qtdfat", "Faturada", (i) => i.qtdfat),
  colunaQuantidade("qtdcan", "Cancelada", (i) => i.qtdcan),
  colunaQuantidade("qtdabe", "Em Aberto", (i) => i.qtdabe),
  { nome: "unimed", titulo: "UM", largura: 70, classe: "text-muted", render: (i) => i.unimed ?? "—" },
  { nome: "preuni", titulo: "Preço Unit.", direita: true, largura: 130, classe: "font-mono tabular-nums text-foreground", render: (i) => (i.preuni != null ? formatMoney(i.preuni, i.moedaSigla) : "—") },
  colunaValorLiquido<ItemProdutoDto>(),
  { nome: "datent", titulo: "Entrega", largura: 110, classe: "text-muted", render: (i) => formatData(i.datent) },
  { nome: "sitipdLabel", titulo: "Situação", largura: 150, render: (i) => selo(i.sitipdLabel, i.sitipdTone) },
];

const COLUNAS_SERVICO: DefColuna<ItemServicoDto>[] = [
  { nome: "servico", titulo: "Serviço", fixa: true, largura: 320, quebra: true, classe: "text-foreground", texto: textoServico, render: (i) => referencia(i.codser, i.servicoLabel, i.complemento) },
  colunaQuantidade("qtdped", "Pedida", (i) => i.qtdped),
  colunaQuantidade("qtdrea", "Realizada", (i) => i.qtdrea),
  colunaQuantidade("qtdfat", "Faturada", (i) => i.qtdfat),
  colunaQuantidade("qtdcan", "Cancelada", (i) => i.qtdcan),
  colunaQuantidade("qtdabe", "Em Aberto", (i) => i.qtdabe),
  { nome: "unimed", titulo: "UM", largura: 70, classe: "text-muted", render: (i) => i.unimed ?? "—" },
  { nome: "preuni", titulo: "Preço Unit.", direita: true, largura: 130, classe: "font-mono tabular-nums text-foreground", render: (i) => formatMoney(i.preuni, i.moedaSigla) },
  colunaValorLiquido<ItemServicoDto>(),
  { nome: "datent", titulo: "Entrega", largura: 110, classe: "text-muted", render: (i) => formatData(i.datent) },
  { nome: "sitispLabel", titulo: "Situação", largura: 150, render: (i) => selo(i.sitispLabel, i.sitispTone) },
];

const NUMERICAS = ["qtdfat", "qtdcan", "qtdabe", "preuni", "vlrliq"];
const decimais = (nomes: string[]) => nomes.map((nome): ColunaLocal => ({ nome, tipo: "decimal" }));

const LOCAIS_PRODUTO: ColunaLocal[] = [
  { nome: "seqipd", tipo: "inteiro", obrigatoria: true },
  { nome: "produto", tipo: "texto", obrigatoria: true },
  ...decimais(["qtdped", "qtdaen", ...NUMERICAS]),
  { nome: "unimed", tipo: "texto" },
  { nome: "datent", tipo: "data", utc: true },
  { nome: "sitipdLabel", tipo: "texto", obrigatoria: true },
];

const LOCAIS_SERVICO: ColunaLocal[] = [
  { nome: "servico", tipo: "texto", obrigatoria: true },
  ...decimais(["qtdped", "qtdrea", ...NUMERICAS]),
  { nome: "unimed", tipo: "texto" },
  { nome: "datent", tipo: "data", utc: true },
  { nome: "sitispLabel", tipo: "texto", obrigatoria: true },
];

const campo = (item: object, coluna: string): unknown => (item as Record<string, unknown>)[coluna];
const lerProduto = (i: ItemProdutoDto, coluna: string) => (coluna === "produto" ? textoProduto(i) : campo(i, coluna));
const lerServico = (i: ItemServicoDto, coluna: string) => (coluna === "servico" ? textoServico(i) : campo(i, coluna));

const ABAS = [
  { key: "produto", label: "Itens de Produto" },
  { key: "servico", label: "Itens de Serviço" },
];

/**
 * Abre em "Itens de Produto"; pedido que só tem serviço abre direto em "Itens de Serviço" (para não abrir numa aba vazia).
 * Os dois arrays vêm prontos do carregamento do pedido (estáveis entre renders, como a TabelaLocal pede).
 */
export function ItensDoPedido({ produto, servico }: { produto: ItemProdutoDto[]; servico: ItemServicoDto[] }) {
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const aba = escolhida ?? (produto.length === 0 && servico.length > 0 ? "servico" : "produto");
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <Tabs tabs={ABAS} activeKey={aba} onChange={setEscolhida} />
      {aba === "produto" ? (
        <TabelaLocal<ItemProdutoDto>
          key="produto"
          chave="mercado.pedido.itens-produto"
          defs={COLUNAS_PRODUTO}
          colunas={LOCAIS_PRODUTO}
          linhas={produto}
          ler={lerProduto}
          chaveLinha={(i) => String(i.seqipd)}
          vazio="Nenhum item de produto neste pedido."
        />
      ) : (
        <TabelaLocal<ItemServicoDto>
          key="servico"
          chave="mercado.pedido.itens-servico"
          defs={COLUNAS_SERVICO}
          colunas={LOCAIS_SERVICO}
          linhas={servico}
          ler={lerServico}
          chaveLinha={(i) => String(i.seqisp)}
          vazio="Nenhum item de serviço neste pedido."
        />
      )}
    </div>
  );
}
