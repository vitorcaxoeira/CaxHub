import { useMemo, useState } from "react";
import { ClienteLinha, PainelEficiencia, ROTULO_PROPOSTA, brlCompacto, hn, paraTsv, pct, tomEficiencia, tomTexto } from "../../lib/eficiencia";
import { BarraConsumo, BotaoCopiar, Cartao, Chip, Indicador, Ordem, TabelaRolavel, Th, Vazio, ordenar, proximaOrdem } from "./comum";

type Chave = "cliente" | "propostas" | "propostasComEstouro" | "vendido" | "executado" | "consumo" | "acima" | "impacto" | "saldo" | "eficiencia";

export function AbaClientes({ painel, verPropostasDoCliente }: { painel: PainelEficiencia; verPropostasDoCliente: (cliente: string) => void }) {
  const [ordem, setOrdem] = useState<Ordem<Chave>>({ chave: "acima", dir: -1 });
  const l = painel.meta.limiares;
  const clientes = painel.clientes;

  const linhas = useMemo(
    () =>
      ordenar<ClienteLinha, Chave>(clientes, ordem, (c, k) => {
        if (k === "cliente") return c.cliente;
        if (k === "consumo") return c.consumo ?? 99;
        if (k === "eficiencia") return c.eficiencia ?? 2;
        return c[k];
      }),
    [clientes, ordem]
  );
  const ordenarPor = (k: Chave) => setOrdem((o) => proximaOrdem(o, k, ["cliente"]));

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
          <TabelaRolavel>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th rotulo="Cliente" chave="cliente" ordem={ordem} onOrdenar={ordenarPor} />
                  <Th rotulo="Situação" />
                  <Th rotulo="Propostas" chave="propostas" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Com estouro" chave="propostasComEstouro" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Vendido" chave="vendido" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Executado" chave="executado" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Consumo" chave="consumo" ordem={ordem} onOrdenar={ordenarPor} />
                  <Th rotulo="Estouro" chave="acima" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Impacto" chave="impacto" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Saldo" chave="saldo" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Eficiência" chave="eficiencia" ordem={ordem} onOrdenar={ordenarPor} numerico />
                </tr>
              </thead>
              <tbody>
                {linhas.map((c) => (
                  <tr
                    key={c.codcli}
                    tabIndex={0}
                    onClick={() => verPropostasDoCliente(c.cliente)}
                    onKeyDown={(e) => e.key === "Enter" && verPropostasDoCliente(c.cliente)}
                    className="cursor-pointer border-t border-border/60 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <td className="px-2.5 py-2">
                      <span className="block max-w-[320px] truncate font-medium text-foreground" title={c.cliente}>{c.cliente}</span>
                      {c.interna && <span className="block text-[11.5px] text-muted">interna (a própria empresa)</span>}
                    </td>
                    <td className="px-2.5 py-2"><Chip tom={c.situacao}>{ROTULO_PROPOSTA[c.situacao]}</Chip></td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{c.propostas}</td>
                    <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums ${c.propostasComEstouro ? "text-destructive" : "text-muted"}`}>{c.propostasComEstouro || "—"}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hn(c.vendido)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hn(c.executado)}</td>
                    <td className="px-2.5 py-2"><BarraConsumo consumo={c.consumo} /><span className="mt-1 block font-mono text-[11.5px] text-muted">{pct(c.consumo)}</span></td>
                    <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums ${c.acima ? "text-destructive" : "text-muted"}`}>{c.acima ? `+${hn(c.acima)}` : "—"}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-muted">{c.impacto > 0 ? brlCompacto(c.impacto) : "—"}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{c.saldo ? hn(c.saldo) : "—"}</td>
                    <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono font-semibold tabular-nums ${tomTexto[tomEficiencia(c.eficiencia, l)]}`}>{pct(c.eficiencia)}</td>
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
