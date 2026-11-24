import { useMemo } from "react";
import { TabelaLocal } from "../colunas/TabelaLocal";
import type { ColunaLocal } from "../colunas/aplicarLocal";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import { ClienteLinha, PainelEficiencia, ROTULO_PROPOSTA, brlCompacto, hn, paraTsv, pct, tomEficiencia, tomTexto } from "../../lib/eficiencia";
import { BarraConsumo, BotaoCopiar, Cartao, Chip, Indicador, Vazio } from "./comum";

type Limiares = PainelEficiencia["meta"]["limiares"];

// Filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (TabelaLocal, 03/11/2026). A ordem de abertura é
// a de sempre (maior estouro primeiro); clicar num título reordena. Horas em minutos (hn formata).
const COLUNAS_LOCAIS: ColunaLocal[] = [
  { nome: "cliente", tipo: "texto", obrigatoria: true },
  { nome: "situacaoRotulo", tipo: "texto", obrigatoria: true },
  { nome: "propostas", tipo: "inteiro", obrigatoria: true },
  { nome: "propostasComEstouro", tipo: "inteiro", obrigatoria: true },
  { nome: "vendido", tipo: "decimal", obrigatoria: true },
  { nome: "executado", tipo: "decimal", obrigatoria: true },
  { nome: "consumoPct", tipo: "decimal" },
  { nome: "acima", tipo: "decimal", obrigatoria: true },
  { nome: "impacto", tipo: "decimal", obrigatoria: true },
  { nome: "saldo", tipo: "decimal", obrigatoria: true },
  { nome: "eficienciaPct", tipo: "decimal" },
];
const lerCliente = (c: ClienteLinha, nome: string): unknown =>
  nome === "situacaoRotulo"
    ? ROTULO_PROPOSTA[c.situacao]
    : nome === "consumoPct"
      ? c.consumo == null ? null : c.consumo * 100
      : nome === "eficienciaPct"
        ? c.eficiencia == null ? null : c.eficiencia * 100
        : (c as unknown as Record<string, unknown>)[nome];
const pctNum = (v: number) => pct(v / 100);

const COLUNAS_CLIENTES: DefColuna<ClienteLinha, Limiares>[] = [
  {
    nome: "cliente",
    titulo: "Cliente",
    fixa: true,
    largura: 280,
    texto: (c) => c.cliente,
    render: (c) => (
      <>
        <span className="block truncate font-medium text-foreground">{c.cliente}</span>
        {c.interna && <span className="block text-[11.5px] text-muted">interna (a própria empresa)</span>}
      </>
    ),
  },
  { nome: "situacaoRotulo", titulo: "Situação", largura: 140, render: (c) => <Chip tom={c.situacao}>{ROTULO_PROPOSTA[c.situacao]}</Chip> },
  { nome: "propostas", titulo: "Propostas", direita: true, largura: 90, classe: "font-mono tabular-nums", render: (c) => c.propostas },
  {
    nome: "propostasComEstouro",
    titulo: "Com estouro",
    direita: true,
    largura: 100,
    classe: (c) => `font-mono tabular-nums ${c.propostasComEstouro ? "text-destructive" : "text-muted"}`,
    render: (c) => c.propostasComEstouro || "—",
  },
  { nome: "vendido", titulo: "Vendido", direita: true, largura: 100, classe: "font-mono tabular-nums", formatarResumo: hn, render: (c) => hn(c.vendido) },
  { nome: "executado", titulo: "Executado", direita: true, largura: 100, classe: "font-mono tabular-nums", formatarResumo: hn, render: (c) => hn(c.executado) },
  {
    nome: "consumoPct",
    titulo: "Consumo",
    largura: 130,
    formatarResumo: pctNum,
    render: (c) => (
      <>
        <BarraConsumo consumo={c.consumo} />
        <span className="mt-1 block font-mono text-[11.5px] text-muted">{pct(c.consumo)}</span>
      </>
    ),
  },
  {
    nome: "acima",
    titulo: "Estouro",
    direita: true,
    largura: 100,
    classe: (c) => `font-mono tabular-nums ${c.acima ? "text-destructive" : "text-muted"}`,
    formatarResumo: hn,
    render: (c) => (c.acima ? `+${hn(c.acima)}` : "—"),
  },
  {
    nome: "impacto",
    titulo: "Impacto",
    direita: true,
    largura: 110,
    classe: "font-mono tabular-nums text-muted",
    formatarResumo: brlCompacto,
    render: (c) => (c.impacto > 0 ? brlCompacto(c.impacto) : "—"),
  },
  { nome: "saldo", titulo: "Saldo", direita: true, largura: 100, classe: "font-mono tabular-nums", formatarResumo: hn, render: (c) => (c.saldo ? hn(c.saldo) : "—") },
  {
    nome: "eficienciaPct",
    titulo: "Eficiência",
    direita: true,
    largura: 100,
    classe: (c, l) => `font-mono font-semibold tabular-nums ${tomTexto[tomEficiencia(c.eficiencia, l)]}`,
    formatarResumo: pctNum,
    render: (c) => pct(c.eficiencia),
  },
];

export function AbaClientes({ painel, verPropostasDoCliente }: { painel: PainelEficiencia; verPropostasDoCliente: (cliente: string) => void }) {
  const l = painel.meta.limiares;
  const clientes = painel.clientes;

  // Abre do maior estouro para o menor (a ordem de sempre); a tabela reordena pelo título.
  const linhas = useMemo(() => [...clientes].sort((a, b) => b.acima - a.acima), [clientes]);

  const comEstouro = clientes.filter((c) => c.situacao === "bad").length;
  const maior = [...clientes].sort((a, b) => b.acima - a.acima)[0];
  const totalAcima = clientes.reduce((t, c) => t + c.acima, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Indicador rotulo="Clientes" valor={clientes.length} sub="com propostas neste recorte" />
        <Indicador
          rotulo="Clientes com estouro"
          valor={<>{comEstouro}<span className="ml-1 text-[13px] font-medium text-muted">de {clientes.length}</span></>}
          sub={`${pct(clientes.length ? comEstouro / clientes.length : 0)} dos clientes`}
          medidor={clientes.length ? comEstouro / clientes.length : 0}
          tom={comEstouro ? "bad" : "ok"}
        />
        <Indicador
          rotulo="Maior estouro"
          valor={maior && maior.acima > 0 ? <>{hn(maior.acima)}<small className="ml-0.5 text-[13px] font-medium text-muted">h</small></> : "—"}
          sub={maior && maior.acima > 0 ? maior.cliente : "nenhum cliente acima do vendido"}
          tom={maior && maior.acima > 0 ? "bad" : "ok"}
        />
        <Indicador
          rotulo="Concentração no maior"
          valor={pct(maior && totalAcima > 0 ? maior.acima / totalAcima : 0)}
          sub="do estouro total em um cliente"
          medidor={maior && totalAcima > 0 ? maior.acima / totalAcima : 0}
          tom="bad"
        />
      </div>

      <Cartao
        titulo="Eficiência por cliente"
        nota="Clique num cliente para ver as propostas dele"
        acao={
          <BotaoCopiar
            montar={() =>
              paraTsv(
                ["Cliente", "Propostas", "Com estouro", "Vendido (h)", "Executado (h)", "Consumo %", "Estouro (h)", "Impacto (R$)", "Saldo (h)", "Eficiência %"],
                linhas.map((c) => [c.cliente, c.propostas, c.propostasComEstouro, (c.vendido / 60).toFixed(1), (c.executado / 60).toFixed(1), c.consumo == null ? "" : Math.round(c.consumo * 100), (c.acima / 60).toFixed(1), Math.round(c.impacto), (c.saldo / 60).toFixed(1), c.eficiencia == null ? "" : Math.round(c.eficiencia * 100)])
              )
            }
          />
        }
      >
        {linhas.length === 0 ? (
          <Vazio>Nenhum cliente neste recorte.</Vazio>
        ) : (
          <TabelaLocal<ClienteLinha, Limiares>
            chave="projetos.eficiencia.clientes"
            defs={COLUNAS_CLIENTES}
            colunas={COLUNAS_LOCAIS}
            linhas={linhas}
            ler={lerCliente}
            ctx={l}
            chaveLinha={(c) => String(c.codcli)}
            onLinha={(c) => verPropostasDoCliente(c.cliente)}
            vazio="Nenhum cliente neste recorte."
          />
        )}
      </Cartao>
    </div>
  );
}
