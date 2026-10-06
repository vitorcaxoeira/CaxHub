import { useMemo, useState } from "react";
import { PainelEficiencia, PropostaLinha, ROTULO_PROPOSTA, Tom, brlCompacto, clienteCurto, hh, hn, paraTsv, pct, tomEficiencia, tomTexto } from "../../lib/eficiencia";
import { BarraConsumo, BotaoCopiar, Cartao, Chip, Ordem, TabelaRolavel, Th, Vazio, ordenar, proximaOrdem } from "./comum";

export type FiltroCarteira = "all" | "estouro" | "atencao" | "ok" | "naoini" | "b1" | "b2" | "b3" | "b4" | "b5";

const SEGMENTOS: { chave: FiltroCarteira; rotulo: string; passa: (p: PropostaLinha) => boolean }[] = [
  { chave: "all", rotulo: "Todas", passa: () => true },
  { chave: "estouro", rotulo: "Com estouro", passa: (p) => p.situacao === "bad" },
  { chave: "atencao", rotulo: "Atenção", passa: (p) => p.situacao === "warn" },
  { chave: "ok", rotulo: "No prazo", passa: (p) => p.situacao === "ok" },
  { chave: "naoini", rotulo: "Não iniciadas", passa: (p) => p.situacao === "off" },
];
const FAIXAS: Record<string, string> = { b1: "Até 50%", b2: "50 a 80%", b3: "80 a 100%", b4: "100 a 150%", b5: "Acima de 150%" };

export const filtroValido = (f: string | undefined): FiltroCarteira =>
  f && (SEGMENTOS.some((s) => s.chave === f) || f in FAIXAS) ? (f as FiltroCarteira) : "all";

const passaFiltro = (f: FiltroCarteira, p: PropostaLinha) =>
  f in FAIXAS ? p.faixa === f : (SEGMENTOS.find((s) => s.chave === f) ?? SEGMENTOS[0]).passa(p);

type Chave = "cliente" | "vendido" | "executado" | "consumo" | "acima" | "impacto" | "saldo" | "eficiencia" | "semAlocacao";
type ModoGrafico = "acima" | "consumo" | "vendido" | "saldo";

const MODOS: Record<ModoGrafico, { rotulo: string; valor: (p: PropostaLinha) => number }> = {
  acima: { rotulo: "Maior estouro", valor: (p) => p.acima },
  consumo: { rotulo: "Maior consumo", valor: (p) => p.consumo ?? 99 },
  vendido: { rotulo: "Maior volume", valor: (p) => p.vendido },
  saldo: { rotulo: "Maior saldo", valor: (p) => p.saldo },
};

export function AbaPropostas({
  painel,
  filtro,
  onFiltro,
  busca,
  onBusca,
  abrirProposta,
}: {
  painel: PainelEficiencia;
  filtro: FiltroCarteira;
  onFiltro: (f: FiltroCarteira) => void;
  busca: string;
  onBusca: (b: string) => void;
  abrirProposta: (codemp: number, codpro: number) => void;
}) {
  const [ordem, setOrdem] = useState<Ordem<Chave>>({ chave: "acima", dir: -1 });
  const [modo, setModo] = useState<ModoGrafico>("acima");
  const l = painel.meta.limiares;
  const todas = painel.propostas;

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const filtradas = todas.filter((p) => passaFiltro(filtro, p) && (!q || p.cliente.toLowerCase().includes(q) || String(p.codpro).includes(q)));
    return ordenar(filtradas, ordem, (p, k) => {
      if (k === "cliente") return p.cliente;
      if (k === "consumo") return p.consumo ?? 99;
      if (k === "eficiencia") return p.eficiencia ?? 2;
      return p[k];
    });
  }, [todas, filtro, busca, ordem]);

  const contagem = (f: FiltroCarteira) => todas.filter((p) => passaFiltro(f, p)).length;
  const totais = linhas.reduce(
    (t, p) => ({ vendido: t.vendido + p.vendido, executado: t.executado + p.executado, acima: t.acima + p.acima, saldo: t.saldo + p.saldo, impacto: t.impacto + p.impacto }),
    { vendido: 0, executado: 0, acima: 0, saldo: 0, impacto: 0 }
  );

  const grafico = useMemo(() => {
    const base = todas.filter((p) => p.vendido > 0 && (modo !== "acima" || p.acima > 0));
    return [...base].sort((a, b) => MODOS[modo].valor(b) - MODOS[modo].valor(a)).slice(0, 12);
  }, [todas, modo]);
  const escala = Math.max(1, ...grafico.map((p) => Math.max(p.vendido, p.executado)));

  const ordenarPor = (k: Chave) => setOrdem((o) => proximaOrdem(o, k, ["cliente"]));

  return (
    <div className="space-y-5">
      <Cartao
        titulo="Vendido x executado"
        acao={
          <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-0.5" role="group" aria-label="Ordenar gráfico">
            {(Object.keys(MODOS) as ModoGrafico[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={modo === k}
                onClick={() => setModo(k)}
                className={`rounded px-2.5 py-1 text-[12px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${modo === k ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
              >
                {MODOS[k].rotulo}
              </button>
            ))}
          </div>
        }
      >
        <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted/40" />Vendido</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" />Executado dentro do vendido</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-warning" />Acima de 80%</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-destructive" />Acima do vendido</span>
        </p>
        {grafico.length === 0 ? (
          <Vazio>Nenhuma proposta neste recorte.</Vazio>
        ) : (
          <ul className="space-y-0.5">
            {grafico.map((p) => {
              const dentro = Math.min(p.executado, p.vendido);
              const tom: Tom = (p.consumo ?? 9) > 0.8 && (p.consumo ?? 9) <= 1 ? "warn" : "ok";
              return (
                <li key={`${p.codemp}-${p.codpro}`}>
                  <button
                    type="button"
                    onClick={() => abrirProposta(p.codemp, p.codpro)}
                    className="grid w-full grid-cols-[minmax(110px,190px)_minmax(0,1fr)_112px] items-center gap-3 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={`${p.cliente}\nVendido ${hh(p.vendido)} · Executado ${hh(p.executado)} · Consumo ${pct(p.consumo)}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-foreground">{clienteCurto(p.cliente)}</span>
                      <span className="block text-[11.5px] text-muted">PS {p.codpro}</span>
                    </span>
                    <span className="relative block h-4">
                      <span className="absolute inset-y-0 left-0 rounded bg-muted/40" style={{ width: `${(p.vendido / escala) * 100}%` }} />
                      <span className={`absolute inset-y-1 left-0 rounded ${tom === "warn" ? "bg-warning" : "bg-primary"}`} style={{ width: `${(dentro / escala) * 100}%` }} />
                      {p.acima > 0 && <span className="absolute inset-y-1 rounded-r bg-destructive" style={{ left: `${(p.vendido / escala) * 100}%`, width: `${(p.acima / escala) * 100}%` }} />}
                    </span>
                    <span className="text-right font-mono text-[12.5px] tabular-nums">
                      <b className={`block ${tomTexto[(p.consumo ?? 9) > 1 ? "bad" : tom]}`}>{pct(p.consumo)}</b>
                      <span className="text-[11.5px] text-muted">{p.acima >= 60 ? `+${hn(p.acima)} h estouro` : `${hn(p.saldo)} h saldo`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-0.5" role="group" aria-label="Filtrar por situação">
          {SEGMENTOS.map((s) => (
            <button
              key={s.chave}
              type="button"
              aria-pressed={filtro === s.chave}
              onClick={() => onFiltro(s.chave)}
              className={`rounded px-2.5 py-1 text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filtro === s.chave ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
            >
              {s.rotulo} <b className={`ml-1 font-mono text-[11px] ${filtro === s.chave ? "text-primary" : "text-muted"}`}>{contagem(s.chave)}</b>
            </button>
          ))}
          {filtro in FAIXAS && (
            <button type="button" aria-pressed onClick={() => onFiltro("all")} className="rounded bg-surface px-2.5 py-1 text-[12.5px] font-medium text-foreground shadow-sm" title="Limpar faixa">
              Consumo {FAIXAS[filtro]} <b className="ml-1 font-mono text-[11px] text-primary">{contagem(filtro)}</b> ✕
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder="Buscar cliente ou nº da proposta"
            aria-label="Buscar proposta"
            className="w-64 max-w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <BotaoCopiar
            montar={() =>
              paraTsv(
                ["Proposta", "Cliente", "Sistema", "Situação", "Status", "Vendido (h)", "Executado (h)", "Consumo %", "Estouro (h)", "Impacto (R$)", "Saldo (h)", "Eficiência %", "Sem alocação (h)"],
                linhas.map((p) => [p.codpro, p.cliente, p.sisproRotulo, p.sitproRotulo, ROTULO_PROPOSTA[p.situacao], (p.vendido / 60).toFixed(1), (p.executado / 60).toFixed(1), p.consumo == null ? "" : Math.round(p.consumo * 100), (p.acima / 60).toFixed(1), Math.round(p.impacto), (p.saldo / 60).toFixed(1), p.eficiencia == null ? "" : Math.round(p.eficiencia * 100), (p.semAlocacao / 60).toFixed(1)])
              )
            }
          />
        </div>
      </div>

      <TabelaRolavel>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th rotulo="Proposta" chave="cliente" ordem={ordem} onOrdenar={ordenarPor} />
              <Th rotulo="Situação" />
              <Th rotulo="Vendido" chave="vendido" ordem={ordem} onOrdenar={ordenarPor} numerico />
              <Th rotulo="Executado" chave="executado" ordem={ordem} onOrdenar={ordenarPor} numerico />
              <Th rotulo="Consumo" chave="consumo" ordem={ordem} onOrdenar={ordenarPor} />
              <Th rotulo="Estouro" chave="acima" ordem={ordem} onOrdenar={ordenarPor} numerico />
              <Th rotulo="Impacto" chave="impacto" ordem={ordem} onOrdenar={ordenarPor} numerico />
              <Th rotulo="Saldo" chave="saldo" ordem={ordem} onOrdenar={ordenarPor} numerico />
              <Th rotulo="Sem alocação" chave="semAlocacao" ordem={ordem} onOrdenar={ordenarPor} numerico />
              <Th rotulo="Eficiência" chave="eficiencia" ordem={ordem} onOrdenar={ordenarPor} numerico />
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted">Nenhuma proposta neste filtro.</td>
              </tr>
            ) : (
              linhas.map((p) => (
                <tr
                  key={`${p.codemp}-${p.codpro}`}
                  tabIndex={0}
                  onClick={() => abrirProposta(p.codemp, p.codpro)}
                  onKeyDown={(e) => e.key === "Enter" && abrirProposta(p.codemp, p.codpro)}
                  className="cursor-pointer border-t border-border/60 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <td className="px-2.5 py-2">
                    <span className="block max-w-[340px] truncate font-medium text-foreground" title={p.cliente}>{p.cliente}</span>
                    <span className="block text-[11.5px] text-muted">PS {p.codpro} · {p.sisproRotulo} · {p.sitproRotulo}{p.interna ? " · interna" : ""}</span>
                  </td>
                  <td className="px-2.5 py-2"><Chip tom={p.situacao}>{ROTULO_PROPOSTA[p.situacao]}{p.critico ? " crítico" : ""}</Chip></td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hn(p.vendido)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hn(p.executado)}</td>
                  <td className="px-2.5 py-2"><BarraConsumo consumo={p.consumo} /><span className="mt-1 block font-mono text-[11.5px] text-muted">{pct(p.consumo)}</span></td>
                  <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums ${p.acima ? "text-destructive" : "text-muted"}`}>{p.acima ? `+${hn(p.acima)}` : "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-muted">{p.impacto > 0 ? brlCompacto(p.impacto) : "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{p.saldo ? hn(p.saldo) : "—"}</td>
                  <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums ${p.semAlocacao >= 60 ? "text-warning" : "text-muted"}`}>{p.semAlocacao >= 60 ? hn(p.semAlocacao) : "—"}</td>
                  <td className={`whitespace-nowrap px-2.5 py-2 text-right font-mono font-semibold tabular-nums ${tomTexto[tomEficiencia(p.eficiencia, l)]}`}>{pct(p.eficiencia)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TabelaRolavel>
      <p className="text-[12.5px] text-muted">
        {linhas.length} propostas · vendido {hh(totais.vendido)} · executado {hh(totais.executado)} · estouro {hh(totais.acima)}
        {totais.impacto > 0 ? ` (${brlCompacto(totais.impacto)})` : ""} · saldo {hh(totais.saldo)}.
      </p>
    </div>
  );
}
