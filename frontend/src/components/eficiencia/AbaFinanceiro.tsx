import { useMemo, useState } from "react";
import { ClienteFinanceiro, LinhaFinanceira, PainelEficiencia, PropostaFinanceira, brl, brlCompacto, paraTsv, pct, rs, tomEficiencia, tomTexto } from "../../lib/eficiencia";
import { BarraConsumo, BotaoCopiar, Cartao, Indicador, Ordem, TabelaRolavel, Th, Vazio, ordenar, proximaOrdem } from "./comum";

type Chave = "nome" | "propostas" | "valorVendido" | "valorExecutado" | "consumo" | "valorAcima" | "valorSaldo" | "eficiencia" | "receitaPorHora";

const ordenarLinhas = <T extends LinhaFinanceira>(
  linhas: T[],
  ordem: Ordem<Chave>,
  nome: (l: T) => string
) =>
  ordenar<T, Chave>(linhas, ordem, (l, k) => {
    if (k === "nome") return nome(l);
    if (k === "consumo") return l.consumo ?? 99;
    if (k === "eficiencia") return l.eficiencia ?? 2;
    if (k === "receitaPorHora") return l.receitaPorHora ?? -1;
    if (k === "propostas") return (l as unknown as { propostas?: number }).propostas ?? 0;
    return l[k];
  });

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
  const [ordemCli, setOrdemCli] = useState<Ordem<Chave>>({ chave: "valorAcima", dir: -1 });
  const [ordemProp, setOrdemProp] = useState<Ordem<Chave>>({ chave: "valorAcima", dir: -1 });
  const linhasCli = useMemo(() => ordenarLinhas<ClienteFinanceiro>(clientes, ordemCli, (c) => c.cliente), [clientes, ordemCli]);
  const linhasProp = useMemo(() => ordenarLinhas<PropostaFinanceira>(propostas, ordemProp, (p) => p.cliente), [propostas, ordemProp]);
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

  const colunasValores = (
    ordem: Ordem<Chave>,
    ordenarPor: (k: Chave) => void
  ) => (
    <>
      <Th rotulo="Vendido" chave="valorVendido" ordem={ordem} onOrdenar={ordenarPor} numerico />
      <Th rotulo="Executado" chave="valorExecutado" ordem={ordem} onOrdenar={ordenarPor} numerico />
      <Th rotulo="Consumo" chave="consumo" ordem={ordem} onOrdenar={ordenarPor} />
      <Th rotulo="Estouro" chave="valorAcima" ordem={ordem} onOrdenar={ordenarPor} numerico />
      <Th rotulo="Saldo" chave="valorSaldo" ordem={ordem} onOrdenar={ordenarPor} numerico />
      <Th rotulo="Eficiência" chave="eficiencia" ordem={ordem} onOrdenar={ordenarPor} numerico />
      <Th rotulo="R$/h exec." chave="receitaPorHora" ordem={ordem} onOrdenar={ordenarPor} numerico />
    </>
  );
  const valores = (x: PropostaFinanceira | ClienteFinanceiro) => (
    <>
      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{rs(x.valorVendido)}</td>
      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{rs(x.valorExecutado)}</td>
      <td className="px-2.5 py-2"><BarraConsumo consumo={x.consumo} /><span className="mt-1 block font-mono text-[11.5px] text-muted">{pct(x.consumo)}</span></td>
      <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums ${x.valorAcima > 0 ? "text-destructive" : "text-muted"}`}>{x.valorAcima > 0 ? rs(x.valorAcima) : "—"}</td>
      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{x.valorSaldo > 0 ? rs(x.valorSaldo) : "—"}</td>
      <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono font-semibold tabular-nums ${tomTexto[tomEficiencia(x.eficiencia, l)]}`}>{pct(x.eficiencia)}</td>
      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-muted">{x.receitaPorHora == null ? "—" : rs(x.receitaPorHora)}</td>
    </>
  );

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
          <TabelaRolavel>
            <table className="w-full border-collapse text-sm [&_td]:px-2 [&_th]:px-2">
              <thead>
                <tr>
                  <Th rotulo="Cliente" chave="nome" ordem={ordemCli} onOrdenar={(k) => setOrdemCli((o) => proximaOrdem(o, k, ["nome"]))} />
                  <Th rotulo="Propostas" chave="propostas" ordem={ordemCli} onOrdenar={(k) => setOrdemCli((o) => proximaOrdem(o, k, ["nome"]))} numerico />
                  {colunasValores(ordemCli, (k) => setOrdemCli((o) => proximaOrdem(o, k, ["nome"])))}
                </tr>
              </thead>
              <tbody>
                {linhasCli.map((c) => (
                  <tr
                    key={c.codcli}
                    tabIndex={0}
                    onClick={() => filtrarCliente(c.codcli)}
                    onKeyDown={(e) => e.key === "Enter" && filtrarCliente(c.codcli)}
                    className="cursor-pointer border-t border-border/60 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <td className="px-2.5 py-2">
                      <span className="block max-w-[200px] truncate font-medium text-foreground" title={c.cliente}>{c.cliente}</span>
                      {c.interna && <span className="block text-[11.5px] text-muted">interna (a própria empresa)</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{c.propostas}</td>
                    {valores(c)}
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
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
          <TabelaRolavel>
            <table className="w-full border-collapse text-sm [&_td]:px-2 [&_th]:px-2">
              <thead>
                <tr>
                  <Th rotulo="Proposta" chave="nome" ordem={ordemProp} onOrdenar={(k) => setOrdemProp((o) => proximaOrdem(o, k, ["nome"]))} />
                  {colunasValores(ordemProp, (k) => setOrdemProp((o) => proximaOrdem(o, k, ["nome"])))}
                </tr>
              </thead>
              <tbody>
                {linhasProp.map((p) => (
                  <tr
                    key={`${p.codemp}-${p.codpro}`}
                    tabIndex={0}
                    onClick={() => abrirProposta(p.codemp, p.codpro)}
                    onKeyDown={(e) => e.key === "Enter" && abrirProposta(p.codemp, p.codpro)}
                    className="cursor-pointer border-t border-border/60 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <td className="px-2.5 py-2">
                      <span className="block max-w-[200px] truncate font-medium text-foreground" title={p.cliente}>{p.cliente}</span>
                      <span className="block text-[11.5px] text-muted">PS {p.codpro} · {p.sitproRotulo}{p.interna ? " · interna" : ""}</span>
                    </td>
                    {valores(p)}
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        )}
      </Cartao>
    </div>
  );
}
