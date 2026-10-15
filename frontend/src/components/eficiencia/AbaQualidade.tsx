import { useState } from "react";
import { PainelEficiencia, dataHoraBr, hh, hhmm, hn, pct } from "../../lib/eficiencia";
import { Cartao, Indicador, TabelaRolavel, Th, Vazio } from "./comum";

export function AbaQualidade({
  painel,
  abrirProposta,
  abrirConsultor,
  restaurarApontamento,
}: {
  painel: PainelEficiencia;
  abrirProposta: (codemp: number, codpro: number) => void;
  abrirConsultor: (codfor: number) => void;
  restaurarApontamento: (ratItemId: number) => Promise<void>;
}) {
  const [restaurando, setRestaurando] = useState<number | null>(null);
  const { qualidade: q, resumo: r, carga } = painel;
  const l = painel.meta.limiares;
  const fracSemAloc = r.executado > 0 ? r.semAlocacao / r.executado : 0;
  const somaAtipicas = q.atipicas.reduce((t, p) => t + p.acima, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Indicador
          rotulo="Sem consultor alocado"
          valor={<>{hn(r.semAlocacao)}<small className="ml-0.5 text-[13px] font-medium text-muted">h</small></>}
          sub={`${pct(fracSemAloc)} do executado`}
          medidor={fracSemAloc}
          tom={fracSemAloc > 0.1 ? "bad" : "warn"}
          dica="Executado do item que nenhuma alocação ativa explica (apontamento sem vínculo, ou de quem não está alocado no item)"
        />
        <Indicador rotulo="Alocação a revisar" valor={<>{hn(carga.revisar)}<small className="ml-0.5 text-[13px] font-medium text-muted">h</small></>} sub="em itens sem saldo" tom={carga.revisar >= 60 ? "warn" : undefined} />
        <Indicador
          rotulo="Propostas atípicas"
          valor={q.atipicas.length}
          sub={`consumo ≥ ${pct(l.atipicaConsumo)} e ${hh(l.atipicaAcimaMin)} acima`}
          tom={q.atipicas.length ? "warn" : "ok"}
          dica="Distorcem totais e médias da carteira. Para tirar uma delas dos números, marque Ignorar na lista da aba Propostas."
        />
        <Indicador
          rotulo="Estouro sem valor-hora"
          valor={q.itensSemValorHora}
          sub={q.itensSemValorHora ? `${hh(q.estouroSemValorHora)} fora do impacto em R$` : "todo estouro tem valor-hora"}
          tom={q.itensSemValorHora ? "warn" : "ok"}
          dica="Itens acima do vendido sem valor-hora cadastrado: o impacto em R$ deles sai zerado"
        />
      </div>

      {q.apontadoSemItem && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-[13px] text-muted">
          <b className="text-foreground">{q.apontadoSemItem.apontamentos} apontamentos ({hh(q.apontadoSemItem.minutos)})</b> dos últimos 12 meses não casam com nenhum item de proposta (sem
          proposta, sem item ou item inexistente). Não entram em nenhum indicador. Só o administrador vê este aviso.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Cartao titulo="Horas sem consultor alocado" nota="Por proposta · as 30 maiores">
          {q.semAlocacao.length === 0 ? (
            <Vazio>Nenhuma proposta com apontamento sem dono.</Vazio>
          ) : (
            <TabelaRolavel altura="max-h-[440px]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <Th rotulo="Proposta" />
                    <Th rotulo="Sem alocação" numerico />
                    <Th rotulo="Executado" numerico />
                    <Th rotulo="%" numerico />
                  </tr>
                </thead>
                <tbody>
                  {q.semAlocacao.map((p) => (
                    <tr
                      key={`${p.codemp}-${p.codpro}`}
                      tabIndex={0}
                      onClick={() => abrirProposta(p.codemp, p.codpro)}
                      onKeyDown={(e) => e.key === "Enter" && abrirProposta(p.codemp, p.codpro)}
                      className="cursor-pointer border-t border-border/60 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <td className="px-2.5 py-2">
                        <span className="block max-w-[260px] truncate font-medium text-foreground" title={p.cliente}>{p.cliente}</span>
                        <span className="block text-[11.5px] text-muted">PS {p.codpro}</span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-warning">{hn(p.semAlocacao)}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hn(p.executado)}</td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-muted">{pct(p.executado ? p.semAlocacao / p.executado : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabelaRolavel>
          )}
        </Cartao>

        <Cartao titulo="Alocação a revisar" nota="Consultor alocado em item que já consumiu o vendido">
          {q.aRevisar.length === 0 ? (
            <Vazio>Nenhuma alocação em item sem saldo.</Vazio>
          ) : (
            <TabelaRolavel altura="max-h-[440px]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <Th rotulo="Item" />
                    <Th rotulo="Consultor" />
                    <Th rotulo="A revisar" numerico />
                  </tr>
                </thead>
                <tbody>
                  {q.aRevisar.map((a) => (
                    <tr key={`${a.codpro}-${a.seqite}-${a.codfor}`} className="border-t border-border/60 hover:bg-surface-2">
                      <td className="px-2.5 py-2">
                        <button type="button" onClick={() => abrirProposta(a.codemp, a.codpro)} className="block max-w-[260px] truncate text-left font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={a.item}>
                          {a.item || `Item ${a.seqite}`}
                        </button>
                        <span className="block max-w-[260px] truncate text-[11.5px] text-muted">PS {a.codpro} · {a.cliente}</span>
                      </td>
                      <td className="px-2.5 py-2">
                        <button type="button" onClick={() => abrirConsultor(a.codfor)} className="text-left text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {a.consultor}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-warning">{hn(a.revisar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabelaRolavel>
          )}
        </Cartao>
      </div>

      <Cartao
        titulo="Apontamentos fora do cálculo"
        nota={`${painel.exclusoes.total} ${painel.exclusoes.total === 1 ? "apontamento" : "apontamentos"} · ${hh(painel.exclusoes.minutos)} · só neste painel`}
      >
        {painel.exclusoes.lista.length === 0 ? (
          <Vazio>Nenhum apontamento foi tirado do cálculo. O gestor do item faz isso na gaveta da proposta, em “Ver apontamentos do item”.</Vazio>
        ) : (
          <TabelaRolavel altura="max-h-[420px]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th rotulo="Item" />
                  <Th rotulo="Consultor" />
                  <Th rotulo="Motivo" />
                  <Th rotulo="Quem e quando" />
                  <Th rotulo="Horas" numerico />
                  <Th rotulo="" />
                </tr>
              </thead>
              <tbody>
                {painel.exclusoes.lista.map((e) => (
                  <tr key={e.id} className="border-t border-border/60 align-top hover:bg-surface-2">
                    <td className="px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => abrirProposta(e.codemp, e.codpro)}
                        className="block max-w-[240px] truncate text-left font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={e.item ?? undefined}
                      >
                        {e.item || `Item ${e.seqite}`}
                      </button>
                      <span className="block max-w-[240px] truncate text-[11.5px] text-muted">PS {e.codpro} · {e.cliente}</span>
                    </td>
                    <td className="px-2.5 py-2 text-foreground">{e.consultor ?? <span className="text-muted">Outro consultor</span>}</td>
                    <td className="px-2.5 py-2">
                      <span className="block text-foreground">{e.motivoRotulo}</span>
                      {e.observacao && <span className="block max-w-[260px] text-[11.5px] text-muted">{e.observacao}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-[12.5px] text-muted">
                      {e.excluidoPorNome}
                      <span className="block text-[11.5px]">{dataHoraBr(e.excluidoEm)}</span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hhmm(e.minutos)}</td>
                    <td className="px-2.5 py-2 text-right">
                      {e.podeRestaurar && (
                        <button
                          type="button"
                          disabled={restaurando === e.ratItemId}
                          onClick={async () => {
                            setRestaurando(e.ratItemId);
                            try {
                              await restaurarApontamento(e.ratItemId);
                            } finally {
                              setRestaurando(null);
                            }
                          }}
                          className="rounded-md border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        >
                          {restaurando === e.ratItemId ? "Restaurando…" : "Restaurar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        )}
      </Cartao>

      <Cartao titulo="Propostas atípicas" nota={`Consumo de ${pct(l.atipicaConsumo)} ou mais e ${hh(l.atipicaAcimaMin)} ou mais acima do vendido`}>
        {q.atipicas.length === 0 ? (
          <Vazio>Nenhuma proposta fora da curva.</Vazio>
        ) : (
          <ul className="space-y-1.5">
            {q.atipicas.map((p) => (
              <li key={`${p.codemp}-${p.codpro}`}>
                <button
                  type="button"
                  onClick={() => abrirProposta(p.codemp, p.codpro)}
                  className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium text-foreground">{p.cliente} · PS {p.codpro}{p.ignorada && <span className="ml-2 font-sans text-[11.5px] font-normal text-muted">(ignorada nos cálculos)</span>}</span>
                  <span className="font-mono text-[12.5px] tabular-nums text-muted">
                    vendido {hh(p.vendido)} · executado {hh(p.executado)} · <b className="text-destructive">+{hh(p.acima)}</b> ({pct(p.consumo)})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.atipicas.length > 0 && (
          <p className="mt-3 text-[12.5px] text-muted">
            Elas somam {hh(somaAtipicas)} de estouro ({pct(r.acima > 0 ? somaAtipicas / r.acima : 0)} dos {hh(r.acima)} da carteira). Costuma ser contrato de
            implantação com horas lançadas por fora do vendido, ou lançamento errado: vale conferir na origem antes de usar a média da carteira. Para tirar uma delas dos números, marque Ignorar na lista da aba Propostas.
          </p>
        )}
      </Cartao>
    </div>
  );
}
