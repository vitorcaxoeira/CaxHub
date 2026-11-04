import { useMemo } from "react";
import { TabelaLocal } from "../colunas/TabelaLocal";
import type { ColunaLocal } from "../colunas/aplicarLocal";
import type { DefColuna } from "../colunas/useColunasConfiguraveis";
import { ClienteFinanceiro, LinhaFinanceira, PainelEficiencia, PropostaFinanceira, brl, brlCompacto, paraTsv, pct, rs, tomEficiencia, tomTexto } from "../../lib/eficiencia";
import { BarraConsumo, BotaoCopiar, Cartao, Indicador, Vazio } from "./comum";

type Limiares = PainelEficiencia["meta"]["limiares"];

// Tabelas com filtro e ordem por coluna, colunas configuráveis, resumo no rodapé e colunas calculadas (TabelaLocal, 03/11/2026). Abrem na
// ordem de sempre (maior estouro em R$ primeiro); clicar num título reordena.
const COLUNAS_VALORES_LOCAIS: ColunaLocal[] = [
  { nome: "valorVendido", tipo: "decimal", obrigatoria: true },
  { nome: "valorExecutado", tipo: "decimal", obrigatoria: true },
  { nome: "consumoPct", tipo: "decimal" },
  { nome: "valorAcima", tipo: "decimal", obrigatoria: true },
  { nome: "valorSaldo", tipo: "decimal", obrigatoria: true },
  { nome: "eficienciaPct", tipo: "decimal" },
  { nome: "receitaPorHora", tipo: "decimal" },
];
const LOCAIS_CLIENTES: ColunaLocal[] = [{ nome: "cliente", tipo: "texto", obrigatoria: true }, { nome: "propostas", tipo: "inteiro", obrigatoria: true }, ...COLUNAS_VALORES_LOCAIS];
const LOCAIS_PROPOSTAS: ColunaLocal[] = [
  { nome: "cliente", tipo: "texto", obrigatoria: true },
  { nome: "codpro", tipo: "inteiro", obrigatoria: true },
  { nome: "sitproRotulo", tipo: "texto" },
  ...COLUNAS_VALORES_LOCAIS,
];
const lerFinanceiro = (x: LinhaFinanceira, nome: string): unknown =>
  nome === "consumoPct"
    ? x.consumo == null ? null : x.consumo * 100
    : nome === "eficienciaPct"
      ? x.eficiencia == null ? null : x.eficiencia * 100
      : (x as unknown as Record<string, unknown>)[nome];
const pctNum = (v: number) => pct(v / 100);

function colunasValores<T extends LinhaFinanceira>(): DefColuna<T, Limiares>[] {
  return [
    { nome: "valorVendido", titulo: "Vendido", direita: true, largura: 110, classe: "font-mono tabular-nums", formatarResumo: rs, render: (x) => rs(x.valorVendido) },
    { nome: "valorExecutado", titulo: "Executado", direita: true, largura: 110, classe: "font-mono tabular-nums", formatarResumo: rs, render: (x) => rs(x.valorExecutado) },
    {
      nome: "consumoPct",
      titulo: "Consumo",
      largura: 120,
      formatarResumo: pctNum,
      render: (x) => (
        <>
          <BarraConsumo consumo={x.consumo} />
          <span className="mt-1 block font-mono text-[11.5px] text-muted">{pct(x.consumo)}</span>
        </>
      ),
    },
    {
      nome: "valorAcima",
      titulo: "Estouro",
      direita: true,
      largura: 110,
      classe: (x) => `font-mono tabular-nums ${x.valorAcima > 0 ? "text-destructive" : "text-muted"}`,
      formatarResumo: rs,
      render: (x) => (x.valorAcima > 0 ? rs(x.valorAcima) : "—"),
    },
    { nome: "valorSaldo", titulo: "Saldo", direita: true, largura: 110, classe: "font-mono tabular-nums", formatarResumo: rs, render: (x) => (x.valorSaldo > 0 ? rs(x.valorSaldo) : "—") },
    {
      nome: "eficienciaPct",
      titulo: "Eficiência",
      direita: true,
      largura: 100,
      classe: (x, l) => `font-mono font-semibold tabular-nums ${tomTexto[tomEficiencia(x.eficiencia, l)]}`,
      formatarResumo: pctNum,
      render: (x) => pct(x.eficiencia),
    },
    {
      nome: "receitaPorHora",
      titulo: "R$/h exec.",
      direita: true,
      largura: 100,
      classe: "font-mono tabular-nums text-muted",
      formatarResumo: rs,
      render: (x) => (x.receitaPorHora == null ? "—" : rs(x.receitaPorHora)),
    },
  ];
}

const COLUNAS_CLIENTES: DefColuna<ClienteFinanceiro, Limiares>[] = [
  {
    nome: "cliente",
    titulo: "Cliente",
    fixa: true,
    largura: 220,
    texto: (c) => c.cliente,
    render: (c) => (
      <>
        <span className="block truncate font-medium text-foreground">{c.cliente}</span>
        {c.interna && <span className="block text-[11.5px] text-muted">interna (a própria empresa)</span>}
      </>
    ),
  },
  { nome: "propostas", titulo: "Propostas", direita: true, largura: 90, classe: "font-mono tabular-nums", render: (c) => c.propostas },
  ...colunasValores<ClienteFinanceiro>(),
];

const COLUNAS_PROPOSTAS: DefColuna<PropostaFinanceira, Limiares>[] = [
  {
    nome: "cliente",
    titulo: "Proposta",
    fixa: true,
    largura: 220,
    texto: (p) => p.cliente,
    render: (p) => (
      <>
        <span className="block truncate font-medium text-foreground">{p.cliente}</span>
        <span className="block truncate text-[11.5px] text-muted">
          PS {p.codpro} · {p.sitproRotulo}
          {p.interna ? " · interna" : ""}
        </span>
      </>
    ),
  },
  { nome: "codpro", titulo: "Nº", largura: 80, classe: "font-mono text-muted", render: (p) => p.codpro },
  { nome: "sitproRotulo", titulo: "Sit. proposta", largura: 130, classe: "text-muted", render: (p) => p.sitproRotulo },
  ...colunasValores<PropostaFinanceira>(),
];

// Eficiência financeira: global, por cliente e por proposta. Base = valor-hora de VENDA do item (R$). Não é faturamento (a NF só se liga ao
// projeto, não à proposta) nem custo (poucos consultores têm valor-hora cadastrado). Respeita todos os filtros, os ignorados e o modo de estouro.
export function AbaFinanceiro({
  painel,
  abrirProposta,
  filtrarCliente,
}: {
  painel: PainelEficiencia;
  abrirProposta: (codemp: number, codpro: number) => void;
  /** Filtra o painel inteiro por este cliente (mesmo filtro "Cliente" da barra). */
  filtrarCliente: (codcli: number) => void;
}) {
  const { resumo: r, clientes, propostas } = painel.financeiro;
  const l = painel.meta.limiares;
  const modoProposta = painel.meta.modoEstouro === "proposta";
  // Abrem do maior estouro em R$ para o menor (a ordem de sempre); as tabelas reordenam pelo título.
  const linhasCli = useMemo(() => [...clientes].sort((a, b) => b.valorAcima - a.valorAcima), [clientes]);
  const linhasProp = useMemo(() => [...propostas].sort((a, b) => b.valorAcima - a.valorAcima), [propostas]);
  const fracSemFat = r.valorVendido > 0 ? r.valorSemFaturamento / r.valorVendido : 0;
  const tomEf = tomEficiencia(r.eficiencia, l);

  const cabecalhoCopia = ["Valor vendido (R$)", "Valor executado (R$)", "Consumo %", "Estouro (R$)", "Saldo (R$)", "Eficiência financeira %", "R$ por hora executada"];
  const celulas = (x: { valorVendido: number; valorExecutado: number; consumo: number | null; valorAcima: number; valorSaldo: number; eficiencia: number | null; receitaPorHora: number | null }) => [
    Math.round(x.valorVendido),
    Math.round(x.valorExecutado),
    x.consumo == null ? "" : Math.round(x.consumo * 100),
    Math.round(x.valorAcima),
    Math.round(x.valorSaldo),
    x.eficiencia == null ? "" : Math.round(x.eficiencia * 100),
    x.receitaPorHora == null ? "" : Math.round(x.receitaPorHora),
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Indicador rotulo="Valor vendido" valor={brlCompacto(r.valorVendido)} sub="ao valor-hora do item" dica={`${brl(r.valorVendido)}: horas vendidas × valor-hora de cada item`} />
        <Indicador
          rotulo="Valor executado"
          valor={brlCompacto(r.valorExecutado)}
          sub={`${pct(r.consumo)} do valor vendido`}
          medidor={r.consumo ?? 1}
          tom={r.consumo != null && r.consumo > 1 ? "bad" : undefined}
          dica={brl(r.valorExecutado)}
        />
        <Indicador
          rotulo="Valor estourado"
          valor={r.valorAcima > 0 ? brlCompacto(r.valorAcima) : "—"}
          sub={r.valorAcima > 0 ? `${pct(r.valorExecutado > 0 ? r.valorAcima / r.valorExecutado : 0)} do executado` : "nada acima do vendido"}
          tom={r.valorAcima > 0 ? "bad" : "ok"}
          dica={r.valorAcima > 0 ? `${brl(r.valorAcima)}: estouro ao valor-hora, em geral não faturável sem aditivo` : undefined}
        />
        <Indicador
          rotulo="Eficiência financeira"
          valor={pct(r.eficiencia)}
          sub="dentro do vendido ÷ executado"
          medidor={r.eficiencia ?? 0}
          tom={tomEf}
          dica="Valor dentro do vendido ÷ valor executado. Parecida com a eficiência em horas, mas pesada pelo valor-hora: estourar um item caro custa mais que estourar um barato"
        />
        <Indicador
          rotulo="Receita por hora executada"
          valor={r.receitaPorHora == null ? "—" : `R$ ${rs(r.receitaPorHora)}/h`}
          sub={r.valorHoraVendido == null ? "sem horas vendidas" : `valor-hora vendido: R$ ${rs(r.valorHoraVendido)}/h`}
          dica="Quanto cada hora trabalhada rendeu dentro do vendido, comparada ao valor-hora médio que foi vendido"
        />
      </div>

      <p className="rounded-md border border-border bg-surface px-4 py-3 text-[13px] text-muted">
        <b className="text-foreground">Valores ao valor-hora de venda do item.</b> Não é faturamento (a nota fiscal só se liga ao projeto, não à proposta) nem custo (poucos consultores
        têm valor-hora cadastrado). Estouro lido {modoProposta ? "pelo total da proposta" : "item a item"} (opção "Estouro" na barra de filtros).
        {r.valorSemFaturamento > 0 && (
          <>
            {" "}
            <b className="text-foreground">{brlCompacto(r.valorSemFaturamento)} ({pct(fracSemFat)})</b> do valor vendido está em itens sem faturamento direto (sem faturamento, comercial, suporte ou
            investimento): entram aqui, mas não viram receita.
          </>
        )}
      </p>

      <Cartao
        titulo="Por cliente"
        nota="Clique num cliente para filtrar o painel por ele"
        acao={
          <BotaoCopiar
            montar={() =>
              paraTsv(
                ["Cliente", "Propostas", ...cabecalhoCopia],
                linhasCli.map((c) => [c.cliente, c.propostas, ...celulas(c)])
              )
            }
          />
        }
      >
        {linhasCli.length === 0 ? (
          <Vazio>Nenhum cliente neste recorte.</Vazio>
        ) : (
          <TabelaLocal<ClienteFinanceiro, Limiares>
            chave="projetos.eficiencia.financeiro-clientes"
            defs={COLUNAS_CLIENTES}
            colunas={LOCAIS_CLIENTES}
            linhas={linhasCli}
            ler={lerFinanceiro}
            ctx={l}
            chaveLinha={(c) => String(c.codcli)}
            onLinha={(c) => filtrarCliente(c.codcli)}
            vazio="Nenhum cliente neste recorte."
          />
        )}
      </Cartao>

      <Cartao
        titulo="Por proposta"
        nota="Clique numa proposta para abrir o detalhe"
        acao={
          <BotaoCopiar
            montar={() =>
              paraTsv(
                ["Proposta", "Cliente", "Situação", ...cabecalhoCopia],
                linhasProp.map((p) => [p.codpro, p.cliente, p.sitproRotulo, ...celulas(p)])
              )
            }
          />
        }
      >
        {linhasProp.length === 0 ? (
          <Vazio>Nenhuma proposta neste recorte.</Vazio>
        ) : (
          <TabelaLocal<PropostaFinanceira, Limiares>
            chave="projetos.eficiencia.financeiro-propostas"
            defs={COLUNAS_PROPOSTAS}
            colunas={LOCAIS_PROPOSTAS}
            linhas={linhasProp}
            ler={lerFinanceiro}
            ctx={l}
            chaveLinha={(p) => `${p.codemp}-${p.codpro}`}
            onLinha={(p) => abrirProposta(p.codemp, p.codpro)}
            vazio="Nenhuma proposta neste recorte."
          />
        )}
      </Cartao>
    </div>
  );
}
