import axios from "axios";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "../ui/Skeleton";
import { Tabs } from "../ui/Tabs";
import {
  ConsultorDetalhe,
  Limiares,
  ModoEstouro,
  MotivoExclusao,
  PropostaDetalhe,
  SugestaoAcao,
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
import { ApontamentosDoItem } from "./ApontamentosDoItem";
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
// `versao` recarrega o MESMO detalhe sem voltar ao esqueleto (a lista de apontamentos aberta dentro do item não pode
// fechar a cada ação); já um CAMINHO diferente zera tudo, como antes. Mudar só a query (o que a pessoa ignorou) também recarrega
// sem esqueleto: a gaveta continua na tela com os números antigos até os novos chegarem.
function useDetalhe<T>(url: string, versao = 0) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const caminhoAnterior = useRef(url.split("?")[0]);
  useEffect(() => {
    let cancelado = false;
    const caminho = url.split("?")[0];
    if (caminhoAnterior.current !== caminho) {
      caminhoAnterior.current = caminho;
      setDados(null);
    }
    setErro(null);
    axios
      .get<T>(url)
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => !cancelado && setErro(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível carregar o detalhe." : "Não foi possível carregar o detalhe."));
    return () => {
      cancelado = true;
    };
  }, [url, versao]);
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

export function GavetaProposta({
  codemp,
  codpro,
  limiares,
  motivosExclusao,
  onMudouCalculo,
  onCriarAcao,
  modoEstouro,
  itensIgnorados,
  consultoresIgnorados,
  onAlternarItem,
  onAlternarConsultor,
  onFechar,
}: {
  codemp: number;
  codpro: number;
  limiares: Limiares;
  motivosExclusao: MotivoExclusao[];
  /** Um apontamento saiu/voltou do cálculo: o painel por trás precisa recarregar. */
  onMudouCalculo: () => void;
  onCriarAcao: (sugestao: SugestaoAcao) => void;
  /** Como o estouro está sendo lido na tela (a gaveta usa o mesmo). */
  modoEstouro: ModoEstouro;
  /** "codemp:codpro:seqite" e "codemp:codpro:codfor" que a pessoa tirou do cálculo (guardado no navegador, vale pra todas as propostas). */
  itensIgnorados: Set<string>;
  consultoresIgnorados: Set<string>;
  onAlternarItem: (codemp: number, codpro: number, seqite: number) => void;
  onAlternarConsultor: (codemp: number, codpro: number, codfor: number) => void;
  onFechar: () => void;
}) {
  const navigate = useNavigate();
  const [versao, setVersao] = useState(0);
  const [aba, setAba] = useState<"itens" | "consultores">("itens");
  // Só o que é DESTA proposta vai na consulta: a gaveta devolve o detalhe já descontando o que a pessoa ignorou.
  const daProposta = (marcados: Set<string>) => [...marcados].filter((k) => k.startsWith(`${codemp}:${codpro}:`)).sort().join(",");
  const ignItens = daProposta(itensIgnorados);
  const ignConsultores = daProposta(consultoresIgnorados);
  const query = [ignItens && `ignorarItem=${ignItens}`, ignConsultores && `ignorarConsultorProposta=${ignConsultores}`, modoEstouro === "proposta" && "estouro=proposta"].filter(Boolean).join("&");
  const { dados: p, erro } = useDetalhe<PropostaDetalhe>(`/api/eficiencia/propostas/${codemp}/${codpro}${query ? `?${query}` : ""}`, versao);
  const aoMudarCalculo = useCallback(() => {
    setVersao((v) => v + 1);
    onMudouCalculo();
  }, [onMudouCalculo]);

  // Os ignorados vão pro fim da lista (esmaecidos, pra dar pra desmarcar) e não entram no diagnóstico.
  const itens = p ? [...p.itens].sort((a, b) => Number(a.ignorado) - Number(b.ignorado) || b.acima - a.acima || (b.consumo ?? 99) - (a.consumo ?? 99)) : [];
  const itensQueContam = itens.filter((i) => !i.ignorado);
  const diagnostico: string[] = [];
  if (p) {
    const pior = itensQueContam[0];
    if (p.acimaPorItem > 0 && pior && pior.acima > 0) {
      diagnostico.push(`${pct(pior.acima / p.acimaPorItem)} do estouro item a item está no item ${pior.seqite}${pior.descricao ? ` (${pior.descricao.slice(0, 70)}${pior.descricao.length > 70 ? "…" : ""})` : ""}.`);
    }
    if (p.itensPorSituacao.warn > 0) diagnostico.push(`${p.itensPorSituacao.warn} ite${p.itensPorSituacao.warn > 1 ? "ns" : "m"} perto do limite: confirme o avanço real antes de estourar.`);
    if (p.semAlocacao >= 60) diagnostico.push(`${hh(p.semAlocacao)} apontadas sem consultor alocado (${pct(p.executado ? p.semAlocacao / p.executado : 0)} do executado).`);
    if (p.impacto > 0) diagnostico.push(`Estouro de ${brl(p.impacto)} ao valor-hora ${p.modoEstouro === "proposta" ? "médio da proposta" : "dos itens"}: alinhar aditivo ou replanejamento com o cliente.`);
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
            <Indicador rotulo="Vendido" valor={<>{hn(p.vendido)}<Un /></>} sub={`${itensQueContam.length} itens`} />
            <Indicador rotulo="Executado" valor={<>{hn(p.executado)}<Un /></>} sub={`${pct(p.consumo)} do vendido`} medidor={p.consumo ?? 1} tom={p.executado > p.vendido ? "bad" : undefined} />
            <Indicador rotulo="Estouro" valor={p.acima ? <>+{hn(p.acima)}<Un /></> : "—"} sub={p.impacto > 0 ? brlCompacto(p.impacto) : "sem estouro"} tom={p.acima ? "bad" : "ok"} />
            <Indicador rotulo="Eficiência" valor={pct(p.eficiencia)} sub={p.saldo ? `${hh(p.saldo)} de saldo` : "sem saldo"} tom={tomEficiencia(p.eficiencia, limiares)} />
          </div>

          {p.acimaPorItem !== p.acimaGlobal && (
            <p className="rounded-md border border-border bg-surface-2/60 px-3 py-2 text-[12.5px] text-muted" role="status">
              <b className="text-foreground">
                Estouro lido {p.modoEstouro === "proposta" ? "pela proposta inteira" : "item a item"}: {p.acima > 0 ? `+${hh(p.acima)}` : "nenhum"}.
              </b>{" "}
              {p.modoEstouro === "proposta"
                ? `Item a item seria +${hh(p.acimaPorItem)}: o saldo de alguns itens compensa o estouro de outros.`
                : `Pela proposta inteira seria ${p.acimaGlobal > 0 ? `+${hh(p.acimaGlobal)}` : "nenhum"}: o saldo de alguns itens compensaria o estouro de outros.`}{" "}
              Troque a leitura em "Estouro", na barra de filtros.
            </p>
          )}

          {p.semIgnorar && (
            <p className="rounded-md border border-border bg-surface-2/60 px-3 py-2 text-[12.5px] text-muted" role="status">
              <b className="text-foreground">
                {[
                  p.ignorados.itens > 0 && `${p.ignorados.itens} ite${p.ignorados.itens > 1 ? "ns ignorados" : "m ignorado"}`,
                  p.ignorados.consultores > 0 && `${p.ignorados.consultores} consultor${p.ignorados.consultores > 1 ? "es ignorados" : " ignorado"}`,
                ]
                  .filter(Boolean)
                  .join(" e ")}
                .
              </b>{" "}
              Os números acima já descontam. Sem ignorar: vendido {hh(p.semIgnorar.vendido)} · executado {hh(p.semIgnorar.executado)}
              {p.semIgnorar.acima > 0 ? ` · estouro ${hh(p.semIgnorar.acima)}` : ""}. Escolha sua, vale só neste navegador.
            </p>
          )}

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
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => onCriarAcao({ origemAlerta: `Proposta PS ${p.codpro}`.slice(0, 200), codemp: p.codemp, codpro: p.codpro, referencia: `PS ${p.codpro} · ${p.cliente}` })}
            >
              + Criar ação
            </button>
          </div>

          <Tabs
            tabs={[
              { key: "itens", label: "Itens e consultores" },
              { key: "consultores", label: `Consultores (${p.consultores.length + (p.outrosConsultores.quantidade > 0 ? 1 : 0)})` },
            ]}
            activeKey={aba}
            onChange={(k) => setAba(k as "itens" | "consultores")}
          />

          {aba === "consultores" && (
            <section>
              <p className="mb-3 text-[12.5px] text-muted">
                Quem apontou horas nesta proposta. Marcar <b className="text-foreground">Ignorar</b> tira as horas da pessoa do executado dos itens (e da equipe) em todo o painel: estouro, consumo e eficiência
                da proposta mudam. Escolha sua, vale só neste navegador.
              </p>
              {p.consultores.length === 0 && p.outrosConsultores.quantidade === 0 ? (
                <Vazio>Ninguém apontou horas nesta proposta.</Vazio>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-surface-2/60 text-left font-mono text-[10.5px] uppercase tracking-wider text-muted">
                        <th className="w-14 px-2.5 py-2 font-medium">Ignorar</th>
                        <th className="px-2.5 py-2 font-medium">Consultor</th>
                        <th className="px-2.5 py-2 text-right font-medium">Executado</th>
                        <th className="px-2.5 py-2 text-right font-medium">% da proposta</th>
                        <th className="px-2.5 py-2 text-right font-medium">Alocado</th>
                        <th className="px-2.5 py-2 text-right font-medium">Itens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.consultores.map((c) => (
                        <tr key={c.codfor} className={`border-t border-border/60 ${c.ignorado ? "opacity-45" : ""}`}>
                          <td className="px-2.5 py-2">
                            <input
                              type="checkbox"
                              checked={c.ignorado}
                              onChange={() => onAlternarConsultor(p.codemp, p.codpro, c.codfor)}
                              aria-label={`Ignorar ${c.nome} no cálculo da proposta ${p.codpro}`}
                              title={c.ignorado ? "Ignorado: desmarque para as horas dele voltarem ao cálculo" : "Marque para tirar as horas deste consultor do cálculo desta proposta"}
                              className="h-4 w-4 cursor-pointer accent-primary"
                            />
                          </td>
                          <td className="px-2.5 py-2 font-medium text-foreground">
                            <span className={c.ignorado ? "line-through" : ""}>{c.nome}</span>
                            {c.ignorado && <span className="block text-[11.5px] font-normal text-muted">ignorado nesta proposta</span>}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hn(c.executado)} h</td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-muted">{pct(c.parte)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-muted">{c.alocado > 0 ? `${hn(c.alocado)} h` : "—"}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums text-muted">{c.itens}</td>
                        </tr>
                      ))}
                      {p.outrosConsultores.quantidade > 0 && (
                        <tr className="border-t border-border/60 text-muted">
                          <td className="px-2.5 py-2" />
                          <td className="px-2.5 py-2">
                            {p.outrosConsultores.quantidade} outro{p.outrosConsultores.quantidade > 1 ? "s" : ""} consultor{p.outrosConsultores.quantidade > 1 ? "es" : ""} (fora do seu time)
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">{hn(p.outrosConsultores.executado)} h</td>
                          <td className="px-2.5 py-2" />
                          <td className="px-2.5 py-2" />
                          <td className="px-2.5 py-2" />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {aba === "itens" && (
          <section>
            {itens.length === 0 ? (
              <Vazio>Esta proposta não tem itens.</Vazio>
            ) : (
              <ul className="space-y-2.5">
                {itens.map((i) => (
                  <li key={i.seqite} className={`rounded-md border border-border bg-surface p-3.5 ${i.ignorado ? "opacity-45" : ""}`}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        {/* Check fora do <p>: o riscado do item ignorado não pode atingir o rótulo "Ignorar". */}
                        <label className="mt-0.5 inline-flex flex-none cursor-pointer items-center gap-1.5 text-[12px] text-muted">
                          <input
                            type="checkbox"
                            checked={i.ignorado}
                            onChange={() => onAlternarItem(p.codemp, p.codpro, i.seqite)}
                            aria-label={`Ignorar o item ${i.seqite} no cálculo da proposta ${p.codpro}`}
                            title={i.ignorado ? "Ignorado: desmarque para o item voltar ao cálculo" : "Marque para tirar este item do cálculo da proposta"}
                            className="h-4 w-4 cursor-pointer accent-primary"
                          />
                          Ignorar
                        </label>
                        <p className={`min-w-0 text-sm font-medium text-foreground ${i.ignorado ? "line-through" : ""}`}>
                          <span className="mr-1.5 font-mono text-[11.5px] text-muted">#{i.seqite}</span>
                          {i.descricao || i.servico || "Item sem descrição"}
                        </p>
                      </div>
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
                    {!i.ignorado && (i.consultores.length > 0 || i.outros.alocado > 0 || i.semAlocacao >= 60) && (
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
                    {i.ignorado && <p className="mt-2 border-t border-border/60 pt-2 text-[12px] text-muted">Item ignorado: fora do vendido, do executado e da equipe desta proposta.</p>}
                    {!i.ignorado && i.executado > 0 && (
                      <ApontamentosDoItem codemp={p.codemp} codpro={p.codpro} seqite={i.seqite} motivos={motivosExclusao} onMudou={aoMudarCalculo} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          )}
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
  onCriarAcao,
  onFechar,
}: {
  codfor: number;
  capacidadeHorasMes: number;
  limiares: Limiares;
  onAbrirProposta: (codemp: number, codpro: number) => void;
  onCriarAcao: (sugestao: SugestaoAcao) => void;
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
          <p className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
            <span>
              Alocado {hh(c.alocado)} · executado {hh(c.executado)} nas propostas ativas.
            </span>
            <button
              type="button"
              className="text-[13px] font-medium text-primary hover:underline"
              onClick={() => onCriarAcao({ origemAlerta: `Consultor ${c.nome}`.slice(0, 200), codforAlvo: c.codfor, referencia: c.nome })}
            >
              + Criar ação
            </button>
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
