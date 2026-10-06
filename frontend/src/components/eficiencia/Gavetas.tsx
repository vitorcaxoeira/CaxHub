import axios from "axios";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "../ui/Skeleton";
import {
  ConsultorDetalhe,
  Limiares,
  PropostaDetalhe,
  ROTULO_ITEM,
  ROTULO_PROPOSTA,
  brl,
  brlCompacto,
  hh,
  hn,
  meses1,
  pct,
  tomEficiencia,
  tomMeses,
  tomTexto,
} from "../../lib/eficiencia";
import { BarraConsumo, Chip, Indicador, Vazio } from "./comum";

function Moldura({ rotulo, titulo, subtitulo, selo, onFechar, children }: { rotulo: string; titulo: string; subtitulo?: string; selo?: ReactNode; onFechar: () => void; children: ReactNode }) {
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    fechar.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-foreground/20" onClick={onFechar} />
      <div className="relative flex h-full w-full flex-col border-l border-border bg-background shadow-xl sm:w-[720px]">
        <header className="flex items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">{rotulo}</p>
            <h2 className="mt-1 truncate font-display text-lg font-bold text-foreground">{titulo}</h2>
            {subtitulo && <p className="mt-0.5 text-[12.5px] text-muted">{subtitulo}</p>}
            {selo && <div className="mt-2">{selo}</div>}
          </div>
          <button
            ref={fechar}
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="flex-none rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

// Busca o detalhe sob demanda. `cancelado` evita que uma resposta atrasada de outra gaveta sobrescreva a atual.
function useDetalhe<T>(url: string) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let cancelado = false;
    setDados(null);
    setErro(null);
    axios
      .get<T>(url)
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível carregar o detalhe." : "Não foi possível carregar o detalhe."));
    return () => {
      cancelado = true;
    };
  }, [url]);
  return { dados, erro };
}

const Carregando = () => (
  <div className="space-y-3">
    <Skeleton className="h-20 w-full" />
    <Skeleton className="h-32 w-full" />
    <Skeleton className="h-32 w-full" />
  </div>
);
const Falha = ({ texto }: { texto: string }) => <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{texto}</p>;
const Un = () => <small className="ml-0.5 text-[13px] font-medium text-muted">h</small>;

// ---------------------------------------------------------------- proposta

export function GavetaProposta({ codemp, codpro, limiares, onFechar }: { codemp: number; codpro: number; limiares: Limiares; onFechar: () => void }) {
  const navigate = useNavigate();
  const { dados: p, erro } = useDetalhe<PropostaDetalhe>(`/api/eficiencia/propostas/${codemp}/${codpro}`);

  const itens = p ? [...p.itens].sort((a, b) => b.acima - a.acima || (b.consumo ?? 99) - (a.consumo ?? 99)) : [];
  const diagnostico: string[] = [];
  if (p) {
    const pior = itens[0];
    if (p.acima > 0 && pior && pior.acima > 0) {
      diagnostico.push(`${pct(pior.acima / p.acima)} do estouro está no item ${pior.seqite}${pior.descricao ? ` (${pior.descricao.slice(0, 70)}${pior.descricao.length > 70 ? "…" : ""})` : ""}.`);
    }
    if (p.itensPorSituacao.warn > 0) diagnostico.push(`${p.itensPorSituacao.warn} ite${p.itensPorSituacao.warn > 1 ? "ns" : "m"} perto do limite: confirme o avanço real antes de estourar.`);
    if (p.semAlocacao >= 60) diagnostico.push(`${hh(p.semAlocacao)} apontadas sem consultor alocado (${pct(p.executado ? p.semAlocacao / p.executado : 0)} do executado).`);
    if (p.impacto > 0) diagnostico.push(`Estouro de ${brl(p.impacto)} ao valor-hora dos itens: alinhar aditivo ou replanejamento com o cliente.`);
    if (p.itensPorSituacao.off > 0 && p.executado > 0) diagnostico.push(`${p.itensPorSituacao.off} ite${p.itensPorSituacao.off > 1 ? "ns" : "m"} ainda sem horas.`);
  }

  return (
    <Moldura
      rotulo="Proposta"
      titulo={p ? p.cliente : `PS ${codpro}`}
      subtitulo={p ? `PS ${p.codpro} · ${p.modproRotulo} · ${p.sitproRotulo} · ${p.depexeRotulo}${p.interna ? " · interna" : ""}` : undefined}
      selo={p && <Chip tom={p.situacao}>{ROTULO_PROPOSTA[p.situacao]}{p.critico ? " crítico" : ""}</Chip>}
      onFechar={onFechar}
    >
      {erro && <Falha texto={erro} />}
      {!p && !erro && <Carregando />}
      {p && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Indicador rotulo="Vendido" valor={<>{hn(p.vendido)}<Un /></>} sub={`${p.itens.length} itens`} />
            <Indicador rotulo="Executado" valor={<>{hn(p.executado)}<Un /></>} sub={`${pct(p.consumo)} do vendido`} medidor={p.consumo ?? 1} tom={p.executado > p.vendido ? "bad" : undefined} />
            <Indicador rotulo="Estouro" valor={p.acima ? <>+{hn(p.acima)}<Un /></> : "—"} sub={p.impacto > 0 ? brlCompacto(p.impacto) : "sem estouro"} tom={p.acima ? "bad" : "ok"} />
            <Indicador rotulo="Eficiência" valor={pct(p.eficiencia)} sub={p.saldo ? `${hh(p.saldo)} de saldo` : "sem saldo"} tom={tomEficiencia(p.eficiencia, limiares)} />
          </div>

          {diagnostico.length > 0 && (
            <section className="rounded-md border border-border bg-surface p-4">
              <h3 className="mb-2 text-[13px] font-semibold text-foreground">Diagnóstico</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {diagnostico.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => navigate(`/projetos/alocacao/${p.codemp}/${p.codpro}`)}>Abrir na Alocação →</button>
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => navigate(`/projetos/alocacao/${p.codemp}/${p.codpro}/cronograma`)}>Cronograma →</button>
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => navigate(`/projetos/proposta/${p.codemp}/${p.codpro}`)}>Ver proposta →</button>
          </div>

          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-foreground">Itens e consultores</h3>
            {itens.length === 0 ? (
              <Vazio>Esta proposta não tem itens.</Vazio>
            ) : (
              <ul className="space-y-2.5">
                {itens.map((i) => (
                  <li key={i.seqite} className="rounded-md border border-border bg-surface p-3.5">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <p className="min-w-0 text-sm font-medium text-foreground">
                        <span className="mr-1.5 font-mono text-[11.5px] text-muted">#{i.seqite}</span>
                        {i.descricao || i.servico || "Item sem descrição"}
                      </p>
                      <Chip tom={i.situacao}>{ROTULO_ITEM[i.situacao]}</Chip>
                    </div>
                    <div className="mb-2 grid grid-cols-[1fr_auto] items-center gap-3">
                      <BarraConsumo consumo={i.consumo} />
                      <span className={`font-mono text-[12.5px] font-semibold tabular-nums ${tomTexto[i.situacao]}`}>{pct(i.consumo)}</span>
                    </div>
                    <p className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[12px] tabular-nums text-muted">
                      <span>vendido <b className="text-foreground">{hh(i.vendido)}</b></span>
                      <span>executado <b className="text-foreground">{hh(i.executado)}</b></span>
                      {i.acima > 0 && <span className="text-destructive">+{hh(i.acima)}{i.impacto > 0 ? ` (${brlCompacto(i.impacto)})` : ""}</span>}
                      {i.saldo > 0 && <span>saldo <b className="text-foreground">{hh(i.saldo)}</b></span>}
                      <span className="font-sans">{i.fatserRotulo}</span>
                    </p>
                    {(i.consultores.length > 0 || i.outros.alocado > 0 || i.semAlocacao >= 60) && (
                      <ul className="mt-2.5 space-y-1 border-t border-border/60 pt-2.5 text-[12.5px]">
                        {i.consultores.map((c) => (
                          <li key={c.codfor} className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="text-foreground">{c.nome}</span>
                            <span className="font-mono tabular-nums text-muted">
                              alocado {hn(c.alocado)} h · executado {hn(c.executado)} h
                              {c.pendente > 0 && <> · <b className="text-primary">pendente {hn(c.pendente)} h</b></>}
                              {c.revisar >= 30 && <> · <b className="text-warning">a revisar {hn(c.revisar)} h</b></>}
                            </span>
                          </li>
                        ))}
                        {i.outros.alocado > 0 && (
                          <li className="flex flex-wrap items-baseline justify-between gap-x-3 text-muted">
                            <span>Outros consultores (fora do seu time)</span>
                            <span className="font-mono tabular-nums">alocado {hn(i.outros.alocado)} h · executado {hn(i.outros.executado)} h</span>
                          </li>
                        )}
                        {i.semAlocacao >= 60 && (
                          <li className="flex flex-wrap items-baseline justify-between gap-x-3 text-warning">
                            <span>Sem consultor alocado</span>
                            <span className="font-mono tabular-nums">{hn(i.semAlocacao)} h</span>
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Moldura>
  );
}

// ---------------------------------------------------------------- consultor

export function GavetaConsultor({
  codfor,
  capacidadeHorasMes,
  limiares,
  onAbrirProposta,
  onFechar,
}: {
  codfor: number;
  capacidadeHorasMes: number;
  limiares: Limiares;
  onAbrirProposta: (codemp: number, codpro: number) => void;
  onFechar: () => void;
}) {
  const { dados: c, erro } = useDetalhe<ConsultorDetalhe>(`/api/eficiencia/consultores/${codfor}?cap=${capacidadeHorasMes}`);
  return (
    <Moldura rotulo="Consultor" titulo={c?.nome ?? `Consultor ${codfor}`} subtitulo={c?.departamento ?? undefined} onFechar={onFechar}>
      {erro && <Falha texto={erro} />}
      {!c && !erro && <Carregando />}
      {c && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Indicador rotulo="Carga pendente" valor={<>{hn(c.pendente)}<Un /></>} sub={`em ${c.propostasComSaldo} propostas`} />
            <Indicador rotulo="Meses de carteira" valor={meses1(c.meses)} sub={`a ${c.capacidadeHorasMes} h/mês`} tom={tomMeses(c.meses, limiares)} />
            <Indicador rotulo="Eficiência" valor={pct(c.eficiencia)} sub="dentro da alocação" tom={tomEficiencia(c.eficiencia, limiares)} />
            <Indicador rotulo="A revisar" valor={<>{hn(c.revisar)}<Un /></>} sub="em itens sem saldo" tom={c.revisar >= 60 ? "warn" : undefined} />
          </div>
          <p className="text-[12.5px] text-muted">
            Alocado {hh(c.alocado)} · executado {hh(c.executado)} nas propostas ativas.
          </p>

          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-foreground">Itens alocados</h3>
            {c.itens.length === 0 ? (
              <Vazio>Sem itens alocados.</Vazio>
            ) : (
              <ul className="space-y-2">
                {c.itens.map((i) => (
                  <li key={`${i.codpro}-${i.seqite}`}>
                    <button
                      type="button"
                      onClick={() => onAbrirProposta(i.codemp, i.codpro)}
                      className="w-full rounded-md border border-border bg-surface p-3 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">{i.descricao || `Item ${i.seqite}`}</span>
                          <span className="block truncate text-[11.5px] text-muted">PS {i.codpro} · {i.cliente}</span>
                        </span>
                        <Chip tom={i.situacaoItem}>{ROTULO_ITEM[i.situacaoItem]}</Chip>
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[12px] tabular-nums text-muted">
                        <span>alocado <b className="text-foreground">{hn(i.alocado)} h</b></span>
                        <span>executado <b className="text-foreground">{hn(i.executado)} h</b></span>
                        {i.pendente > 0 && <span className="text-primary">pendente {hn(i.pendente)} h</span>}
                        {i.revisar >= 30 && <span className="text-warning">a revisar {hn(i.revisar)} h</span>}
                        <span>item: {hn(i.executadoItem)} / {hn(i.vendidoItem)} h</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Moldura>
  );
}
