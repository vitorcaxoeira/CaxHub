import { Alerta, PainelEficiencia, Tom, brlCompacto, clienteCurto, hh, hn, meses1, nomeCurto, pct, rotuloMes, tomEficiencia, tomFundo, tomMeses, tomTexto } from "../../lib/eficiencia";
import { Cartao, Indicador, Vazio } from "./comum";

export interface AcoesPainel {
  irPara: (aba: "propostas" | "equipe" | "qualidade", filtro?: string) => void;
  abrirProposta: (codemp: number, codpro: number) => void;
  abrirConsultor: (codfor: number) => void;
}

const SEVERIDADE_FAIXA: Record<Tom, string> = { bad: "bg-destructive", warn: "bg-warning", ok: "bg-success", off: "bg-muted/50" };

export function VisaoGeral({ painel, acoes }: { painel: PainelEficiencia; acoes: AcoesPainel }) {
  const { resumo: r, carga, meta, pareto, faixas, tendencia, equipe, alertas } = painel;
  const l = meta.limiares;
  const consumoGeral = r.vendido > 0 ? r.executado / r.vendido : 0;
  const itensComSaldo = r.itensPorSituacao.ok + r.itensPorSituacao.warn + r.itensPorSituacao.off;
  const totalItens = Object.values(r.itensPorSituacao).reduce((a, b) => a + b, 0) || 1;
  const fracSemAloc = r.executado > 0 ? r.semAlocacao / r.executado : 0;
  const mesesPorConsultor = carga.meses / Math.max(1, carga.consultoresComCarga);

  function abrirAlerta(a: Alerta) {
    if (a.alvo.tipo === "proposta") acoes.abrirProposta(a.alvo.codemp, a.alvo.codpro);
    else if (a.alvo.tipo === "consultor") acoes.abrirConsultor(a.alvo.codfor);
    else acoes.irPara(a.alvo.aba, a.alvo.filtro);
  }

  const maxTend = Math.max(1, ...tendencia.map((p) => p.total));
  const cargaOrdenada = equipe.consultores.filter((c) => c.pendente >= 60).sort((a, b) => b.pendente - a.pendente).slice(0, 7);
  const limiteCarga = Math.max(3.5, ...cargaOrdenada.map((c) => c.meses));
  const paretoMax = Math.max(1, ...pareto.linhas.map((p) => p.acima));
  const faixaMax = Math.max(1, ...faixas.map((f) => f.propostas));

  return (
    <div className="space-y-5">
      <Cartao titulo="Resumo executivo" nota={`${r.propostas} propostas · capacidade de ${meta.capacidadeHorasMes} h/mês por consultor`}>
        <div className="space-y-4">
          <div>
            <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Volume</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Indicador rotulo="Horas vendidas" valor={<>{hn(r.vendido)}<Un /></>} sub={`${r.propostas} propostas`} onClick={() => acoes.irPara("propostas", "all")} />
              <Indicador
                rotulo="Horas executadas"
                valor={<>{hn(r.executado)}<Un /></>}
                sub={`${pct(consumoGeral)} do vendido`}
                medidor={consumoGeral}
                tom={r.executado > r.vendido ? "bad" : undefined}
                onClick={() => acoes.irPara("propostas", "all")}
              />
              <Indicador
                rotulo="Eficiência"
                valor={pct(r.eficiencia)}
                sub={`${hh(r.dentro)} dentro do vendido`}
                medidor={r.eficiencia ?? 0}
                tom={tomEficiencia(r.eficiencia, l)}
                dica="Horas executadas dentro do vendido ÷ horas executadas, item a item"
              />
              <Indicador rotulo="Saldo a executar" valor={<>{hn(r.saldo)}<Un /></>} sub={`em ${itensComSaldo} itens com saldo`} onClick={() => acoes.irPara("propostas", "all")} />
              <Indicador
                rotulo="Carga da equipe"
                valor={<>{meses1(carga.meses)}<span className="ml-1 text-[13px] font-medium text-muted">meses</span></>}
                sub={`${hh(carga.pendente)} pendentes`}
                tom={tomMeses(mesesPorConsultor, l)}
                dica={`Carga pendente ÷ ${meta.capacidadeHorasMes} h/mês`}
                onClick={() => acoes.irPara("equipe")}
              />
            </div>
          </div>
          <div>
            <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Risco</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Indicador
                rotulo="Propostas com estouro"
                valor={<>{r.propostasPorSituacao.bad}<span className="ml-1 text-[13px] font-medium text-muted">de {r.propostas}</span></>}
                sub={`${pct(r.propostas ? r.propostasPorSituacao.bad / r.propostas : 0)} da carteira`}
                medidor={r.propostas ? r.propostasPorSituacao.bad / r.propostas : 0}
                tom={r.propostasPorSituacao.bad ? "bad" : "ok"}
                onClick={() => acoes.irPara("propostas", "estouro")}
              />
              <Indicador
                rotulo="Horas acima do vendido"
                valor={<>{hn(r.acima)}<Un /></>}
                sub={r.impacto > 0 ? `≈ ${brlCompacto(r.impacto)} não faturáveis` : "sem impacto financeiro"}
                tom={r.acima ? "bad" : "ok"}
                dica="Estouro × valor-hora do próprio item (campo valhor da proposta)"
                onClick={() => acoes.irPara("propostas", "estouro")}
              />
              <Indicador
                rotulo="Concentração do estouro"
                valor={pct(pareto.top3)}
                sub={`nas ${Math.min(3, pareto.linhas.length)} maiores propostas`}
                medidor={pareto.top3}
                tom="bad"
                dica={pareto.linhas.slice(0, 3).map((p) => clienteCurto(p.cliente)).join(" · ")}
              />
              <Indicador
                rotulo="Itens perto do limite"
                valor={r.itensPertoDoLimite}
                sub={`${hh(r.saldoPertoDoLimite)} até estourar`}
                tom={r.itensPertoDoLimite ? "warn" : "ok"}
                onClick={() => acoes.irPara("propostas", "atencao")}
              />
              <Indicador
                rotulo="Sem consultor alocado"
                valor={pct(fracSemAloc)}
                sub={`${hh(r.semAlocacao)} do executado`}
                medidor={fracSemAloc}
                tom={fracSemAloc > 0.1 ? "bad" : "warn"}
                dica="Executado do item que nenhuma alocação ativa explica"
                onClick={() => acoes.irPara("qualidade")}
              />
            </div>
          </div>
        </div>
      </Cartao>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Cartao titulo="Precisa da sua atenção" nota="Ordenado por impacto em horas">
          {alertas.length === 0 ? (
            <Vazio>Nada pedindo ação nos filtros atuais.</Vazio>
          ) : (
            <ul className="space-y-2">
              {alertas.slice(0, 7).map((a, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => abrirAlerta(a)}
                    className="grid w-full grid-cols-[4px_1fr_auto] items-center gap-3 overflow-hidden rounded-md border border-border bg-surface py-2.5 pr-3 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={`h-full self-stretch rounded-r ${SEVERIDADE_FAIXA[a.severidade]}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        <span className={`mr-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider ${tomTexto[a.severidade]}`}>{a.rotulo}</span>
                        {a.titulo}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] text-muted">{a.detalhe}</span>
                    </span>
                    <span className="whitespace-nowrap text-[12.5px] font-medium text-primary">Abrir →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Onde está o estouro" acao={<button type="button" onClick={() => acoes.irPara("propostas", "estouro")} className="text-[12.5px] font-medium text-primary hover:underline">Ver todas</button>}>
          {pareto.linhas.length === 0 ? (
            <Vazio>Nenhum estouro.</Vazio>
          ) : (
            <>
              <p className="mb-3 flex items-baseline gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-foreground">
                <b className="font-mono text-lg text-destructive">{pct(pareto.top3)}</b>
                do estouro está nas 3 maiores propostas. Tratar essas resolve a maior parte do problema.
              </p>
              <ul className="space-y-0.5">
                {pareto.linhas.map((p, i) => (
                  <li key={`${p.codemp}-${p.codpro}`}>
                    <button
                      type="button"
                      onClick={() => acoes.abrirProposta(p.codemp, p.codpro)}
                      className="grid w-full grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_64px_44px] items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={`${p.cliente} · consumo ${pct(p.consumo)}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-foreground">{clienteCurto(p.cliente)}</span>
                        <span className="block text-[11.5px] text-muted">PS {p.codpro}</span>
                      </span>
                      <span className="h-2.5 rounded bg-surface-2">
                        <span className="block h-full rounded bg-destructive" style={{ width: `${(p.acima / paretoMax) * 100}%` }} />
                      </span>
                      <span className="text-right font-mono text-[12.5px] tabular-nums text-foreground">+{hn(p.acima)} h</span>
                      <span className={`text-right font-mono text-[11.5px] tabular-nums ${i < 3 ? "font-semibold text-destructive" : "text-muted"}`}>{pct(p.acumulado)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">Coluna da direita: % acumulado do estouro total.</p>
            </>
          )}
        </Cartao>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Cartao titulo="Carteira por consumo do vendido" nota="Clique numa faixa">
          <ul className="space-y-1">
            {faixas.map((f) => (
              <li key={f.chave}>
                <button
                  type="button"
                  onClick={() => acoes.irPara("propostas", f.chave)}
                  className="grid w-full grid-cols-[120px_minmax(0,1fr)_96px] items-center gap-3 rounded-md px-1.5 py-1 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-[13px] text-foreground">{f.rotulo}</span>
                  <span className="h-[18px] rounded bg-surface-2">
                    <span className={`block h-full rounded ${tomFundo[f.tom]}`} style={{ width: `${(f.propostas / faixaMax) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono text-[12.5px] tabular-nums text-muted">
                    <b className="font-semibold text-foreground">{f.propostas}</b> · {hn(f.vendido)} h
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold text-foreground">Situação dos itens</h3>
              <span className="text-[12px] text-muted">{totalItens} itens</span>
            </div>
            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-2">
              {(["ok", "warn", "bad", "off"] as Tom[]).map((k) => (
                <span key={k} className={`h-full ${tomFundo[k]}`} style={{ width: `${(r.itensPorSituacao[k] / totalItens) * 100}%` }} title={`${r.itensPorSituacao[k]} itens`} />
              ))}
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
              {(["ok", "warn", "bad", "off"] as Tom[]).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-sm ${tomFundo[k]}`} />
                  {{ ok: "No prazo", warn: "Perto do limite", bad: "Estourado", off: "Não iniciado" }[k]}
                  <b className="font-mono text-foreground">{r.itensPorSituacao[k]}</b>
                </span>
              ))}
            </p>
          </div>
        </Cartao>

        <Cartao titulo="Carga da equipe" acao={<button type="button" onClick={() => acoes.irPara("equipe")} className="text-[12.5px] font-medium text-primary hover:underline">Ver equipe</button>}>
          {cargaOrdenada.length === 0 ? (
            <Vazio>Sem carga pendente.</Vazio>
          ) : (
            <>
              <ul className="space-y-0.5">
                {cargaOrdenada.map((c) => {
                  const tom = tomMeses(c.meses, l);
                  return (
                    <li key={c.codfor}>
                      <button
                        type="button"
                        onClick={() => acoes.abrirConsultor(c.codfor)}
                        className="grid w-full grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_72px] items-center gap-3 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-foreground">{nomeCurto(c.nome)}</span>
                          <span className="block truncate text-[11.5px] text-muted">{c.departamento ?? "—"}</span>
                        </span>
                        <span className="relative h-3 rounded bg-surface-2">
                          <span className={`absolute inset-y-0 left-0 rounded ${tomFundo[tom]}`} style={{ width: `${(c.meses / limiteCarga) * 100}%` }} />
                          <span className="absolute -inset-y-1 border-l-[1.5px] border-dashed border-muted" style={{ left: `${(l.mesesSobrecarga / limiteCarga) * 100}%` }} />
                        </span>
                        <span className="text-right font-mono text-[12.5px] tabular-nums">
                          <b className={tomTexto[tom]}>{meses1(c.meses)} m</b>
                          <span className="block text-[11.5px] text-muted">{hh(c.pendente)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[12px] text-muted">Linha tracejada = {l.mesesSobrecarga} meses a {meta.capacidadeHorasMes} h/mês.</p>
            </>
          )}
        </Cartao>
      </div>

      <Cartao titulo="Horas executadas por mês" nota="Últimos 12 meses · só apontamentos de RAT · pela data do apontamento">
        {tendencia.length === 0 ? (
          <Vazio>Sem apontamentos no período.</Vazio>
        ) : (
          <>
            <div className="flex h-48 items-end gap-2 pt-5" role="img" aria-label="Horas executadas por mês, divididas entre dentro e acima do vendido">
              {tendencia.map((p) => {
                const acima = p.total - p.dentro;
                return (
                  <div key={p.mes} className="flex h-full min-w-0 flex-1 items-end" title={`${rotuloMes(p.mes)}: ${hh(p.total)} · ${hh(acima)} acima do vendido`}>
                    <div className="relative w-full" style={{ height: `${(p.total / maxTend) * 100}%` }}>
                      <span className="absolute -top-4 inset-x-0 text-center font-mono text-[10.5px] tabular-nums text-muted">{hn(p.total)}</span>
                      <div className="flex h-full flex-col overflow-hidden rounded-t bg-surface-2">
                        <span className="block bg-destructive" style={{ height: `${p.total > 0 ? (acima / p.total) * 100 : 0}%` }} />
                        <span className="block flex-1 bg-primary/70" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-2">
              {tendencia.map((p, i) => (
                <span key={p.mes} className={`min-w-0 flex-1 text-center font-mono text-[10.5px] text-muted ${i % 2 ? "max-sm:invisible" : ""}`}>{rotuloMes(p.mes)}</span>
              ))}
            </div>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary/70" />Dentro do vendido</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-destructive" />Acima do vendido (o apontamento passou do total do item)</span>
            </p>
          </>
        )}
      </Cartao>
    </div>
  );
}

const Un = () => <small className="ml-0.5 text-[13px] font-medium text-muted">h</small>;
