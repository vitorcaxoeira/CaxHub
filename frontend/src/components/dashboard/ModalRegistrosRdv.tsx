import { useMemo } from "react";
import { Modal } from "../ui/Modal";
import { TabelaLocal } from "../colunas/TabelaLocal";
import type { ColunaLocal } from "../colunas/aplicarLocal";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import type { GrupoRdv, ItemRdvEmRat, ItemTituloRdv } from "../../hooks/useRdvConsultor";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function formatarData(iso: string | null): string {
  return iso ? dataFormatter.format(new Date(`${iso}T00:00:00Z`)) : "—";
}


// O que o modal mostra: as despesas de RAT ainda não aprovada, ou uma faixa de títulos a
// pagar em aberto (vencidos / este mês / próximos meses).
export type SelecaoRdv =
  | { tipo: "rdv"; titulo: string; grupo: GrupoRdv<ItemRdvEmRat> }
  | { tipo: "titulos"; titulo: string; grupo: GrupoRdv<ItemTituloRdv> }
  // Total a receber: o RDV em RAT (segue o período) + todos os títulos em aberto, cada um com a
  // faixa de vencimento de onde veio, pra dar pra ler o total inteiro numa janela só.
  | { tipo: "total"; titulo: string; rdv: GrupoRdv<ItemRdvEmRat>; titulos: GrupoRdv<ItemTituloComFaixa>; total: number };

export type FaixaTitulo = "Vencido" | "No mês" | "Próximos meses";
export type ItemTituloComFaixa = ItemTituloRdv & { faixa: FaixaTitulo };

// Tabelas do modal com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (TabelaLocal, 03/11/2026).
const LOCAIS_RDV: ColunaLocal[] = [
  { nome: "numrat", tipo: "inteiro" },
  { nome: "sitratLabel", tipo: "texto" },
  { nome: "data", tipo: "data", utc: true },
  { nome: "desrdv", tipo: "texto" },
  { nome: "tipdesLabel", tipo: "texto" },
  { nome: "qtdrdv", tipo: "decimal" },
  { nome: "vlrunt", tipo: "decimal" },
  { nome: "vlrtot", tipo: "decimal" },
];
const brl = (v: number) => moeda.format(v);
const COLUNAS_RDV: DefColuna<ItemRdvEmRat>[] = [
  { nome: "numrat", titulo: "RAT", fixa: true, largura: 80, classe: "font-mono text-xs text-foreground", render: (d) => d.numrat },
  { nome: "sitratLabel", titulo: "Situação", largura: 110, classe: "text-xs text-muted", render: (d) => d.sitratLabel },
  { nome: "data", titulo: "Data", largura: 100, classe: "font-mono text-xs text-muted", render: (d) => formatarData(d.datemi ?? d.datemiRat) },
  { nome: "desrdv", titulo: "Descrição", largura: 260, classe: "text-xs text-foreground", texto: (d) => d.desrdv, render: (d) => d.desrdv ?? "—" },
  { nome: "tipdesLabel", titulo: "Tipo", largura: 130, classe: "text-xs text-muted", render: (d) => d.tipdesLabel },
  { nome: "qtdrdv", titulo: "Qtd", direita: true, largura: 70, classe: "font-mono text-xs tabular-nums text-muted", render: (d) => d.qtdrdv ?? "—" },
  { nome: "vlrunt", titulo: "Vlr unit.", direita: true, largura: 110, classe: "font-mono text-xs tabular-nums text-muted", formatarResumo: brl, render: (d) => brl(d.vlrunt) },
  { nome: "vlrtot", titulo: "Total", direita: true, largura: 110, classe: "font-mono text-xs tabular-nums text-foreground", formatarResumo: brl, render: (d) => brl(d.vlrtot) },
];
const LOCAIS_TITULOS: ColunaLocal[] = [
  { nome: "numtit", tipo: "texto", obrigatoria: true },
  { nome: "codfil", tipo: "inteiro" },
  { nome: "datemi", tipo: "data", utc: true },
  { nome: "vctpro", tipo: "data", utc: true },
  { nome: "faixa", tipo: "texto" },
  { nome: "obstcp", tipo: "texto" },
  { nome: "vlrori", tipo: "decimal" },
  { nome: "vlrabe", tipo: "decimal" },
];
const COLUNAS_TITULOS: DefColuna<ItemTituloRdv | ItemTituloComFaixa>[] = [
  { nome: "numtit", titulo: "Título", fixa: true, largura: 110, classe: "font-mono text-xs text-foreground", resumos: ["contagem"], render: (t) => t.numtit },
  { nome: "codfil", titulo: "Filial", largura: 70, classe: "font-mono text-xs text-muted", render: (t) => t.codfil },
  { nome: "datemi", titulo: "Emissão", largura: 100, classe: "font-mono text-xs text-muted", render: (t) => formatarData(t.datemi) },
  { nome: "vctpro", titulo: "Vencimento", largura: 100, classe: "font-mono text-xs text-foreground", render: (t) => formatarData(t.vctpro) },
  {
    nome: "faixa",
    titulo: "Faixa",
    largura: 120,
    classe: (t) => `text-xs ${"faixa" in t && t.faixa === "Vencido" ? "text-destructive" : "text-muted"}`,
    render: (t) => ("faixa" in t ? t.faixa : "—"),
  },
  { nome: "obstcp", titulo: "Observação", largura: 240, classe: "text-xs text-muted", texto: (t) => t.obstcp, render: (t) => t.obstcp ?? "—" },
  { nome: "vlrori", titulo: "Valor original", direita: true, largura: 120, classe: "font-mono text-xs tabular-nums text-muted", formatarResumo: brl, render: (t) => brl(t.vlrori) },
  { nome: "vlrabe", titulo: "Em aberto", direita: true, largura: 120, classe: "font-mono text-xs tabular-nums text-foreground", formatarResumo: brl, render: (t) => brl(t.vlrabe) },
];

function Cabecalho({ quantidade, rotulo, total }: { quantidade: number; rotulo: string; total: number }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <p className="text-[12.5px] text-muted">
        {quantidade} {rotulo}
        {quantidade === 1 ? "" : "s"}
      </p>
      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">Total: {moeda.format(total)}</p>
    </div>
  );
}

function TabelaRdv({ grupo, semCabecalho = false }: { grupo: GrupoRdv<ItemRdvEmRat>; semCabecalho?: boolean }) {
  return (
    <>
      {!semCabecalho && <Cabecalho quantidade={grupo.itens.length} rotulo="despesa" total={grupo.total} />}
      <TabelaLocal<ItemRdvEmRat>
        chave="dashboard.rdv.despesas"
        defs={COLUNAS_RDV}
        colunas={LOCAIS_RDV}
        linhas={grupo.itens}
        ler={(d, nome) => (nome === "data" ? d.datemi ?? d.datemiRat : (d as unknown as Record<string, unknown>)[nome])}
        chaveLinha={(d) => String(d.id)}
        vazio="Nenhuma despesa."
        alturaMax="max-h-[55vh]"
      />
    </>
  );
}

function TabelaTitulos({
  grupo,
  comFaixa = false,
  semCabecalho = false,
}: {
  grupo: GrupoRdv<ItemTituloRdv | ItemTituloComFaixa>;
  comFaixa?: boolean;
  semCabecalho?: boolean;
}) {
  const defs = useMemo(() => (comFaixa ? COLUNAS_TITULOS : COLUNAS_TITULOS.filter((c) => c.nome !== "faixa")), [comFaixa]);
  return (
    <>
      {!semCabecalho && <Cabecalho quantidade={grupo.itens.length} rotulo="título" total={grupo.total} />}
      <TabelaLocal<ItemTituloRdv | ItemTituloComFaixa>
        chave={comFaixa ? "dashboard.rdv.titulos-faixa" : "dashboard.rdv.titulos"}
        defs={defs}
        colunas={LOCAIS_TITULOS}
        linhas={grupo.itens}
        chaveLinha={(t) => `${t.codemp}-${t.codfil}-${t.numtit}`}
        vazio="Nenhum título."
        alturaMax="max-h-[55vh]"
      />
    </>
  );
}

function TabelaRdvTotal({ selecao }: { selecao: Extract<SelecaoRdv, { tipo: "total" }> }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">RDV em RAT + títulos a pagar em aberto</p>
        <p className="font-mono text-base font-semibold tabular-nums text-primary">Total: {moeda.format(selecao.total)}</p>
      </div>
      {selecao.rdv.itens.length > 0 && (
        <section>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">
            RDV em RATs Digitadas e Fechadas · {moeda.format(selecao.rdv.total)}
          </p>
          <TabelaRdv grupo={selecao.rdv} semCabecalho />
        </section>
      )}
      {selecao.titulos.itens.length > 0 && (
        <section>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">
            Títulos a pagar em aberto · {moeda.format(selecao.titulos.total)}
          </p>
          <TabelaTitulos grupo={selecao.titulos} comFaixa semCabecalho />
        </section>
      )}
    </div>
  );
}

export function ModalRegistrosRdv({ selecao, subtitulo, onClose }: { selecao: SelecaoRdv; subtitulo?: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={selecao.titulo} subtitulo={subtitulo} className="max-w-4xl">
      {selecao.tipo === "rdv" ? (
        <TabelaRdv grupo={selecao.grupo} />
      ) : selecao.tipo === "titulos" ? (
        <TabelaTitulos grupo={selecao.grupo} />
      ) : (
        <TabelaRdvTotal selecao={selecao} />
      )}
    </Modal>
  );
}
