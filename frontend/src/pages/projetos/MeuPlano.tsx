import axios from "axios";
import { useEffect, useState } from "react";
import { Skeleton } from "../../components/ui/Skeleton";
import { Cartao, Chip, Indicador, Vazio } from "../../components/eficiencia/comum";
import { hn } from "../../lib/eficiencia";
import { MeuPlanoResposta, ProjecaoDto, ROTULO_REQUISITO, ResultadoCicloDto, brl2, dataBr, pctBp, pctNum, rotuloSituacaoCiclo, tomDaMeta, tomDaSituacaoCiclo } from "../../lib/planoEvolucao";

function Desfecho({ titulo, r }: { titulo: string; r: ResultadoCicloDto }) {
  const descumpriu = r.status === "descumprido";
  return (
    <div className={`rounded-lg border p-4 ${descumpriu ? "border-destructive/40" : "border-border"} bg-surface`}>
      <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted">{titulo}</p>
      {descumpriu ? (
        <>
          <p className="mt-1 font-mono text-[22px] font-semibold text-destructive">0%</p>
          <p className="mt-1 text-[12.5px] text-muted">Voltaria ao valor base: {r.motivos.map((m) => ROTULO_REQUISITO[m] ?? m).join(", ")}.</p>
        </>
      ) : (
        <>
          <p className="mt-1 font-mono text-[22px] font-semibold text-foreground">
            {r.valorHora != null ? brl2(r.valorHora) : pctBp(r.percentualBp)}
            <span className="ml-1 text-[13px] font-medium text-muted">/h</span>
          </p>
          <p className="mt-1 text-[12.5px] text-muted">
            {pctBp(r.pontuacaoBp)} do ciclo + {pctBp(r.reforcadorBp)} de reforçador = <b className="text-foreground">{pctBp(r.percentualBp)}</b> sobre o valor base
            {r.efetivou && <span className="text-success"> · efetiva no fim do ciclo</span>}
          </p>
        </>
      )}
    </div>
  );
}

// O que o consultor enxerga: só o PRÓPRIO andamento no plano, sem colegas. Mostra o valor hora porque é dele.
export function MeuPlano() {
  const [dados, setDados] = useState<MeuPlanoResposta | null>(null);
  const [naoParticipa, setNaoParticipa] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    axios
      .get<MeuPlanoResposta>("/api/plano-evolucao/meu")
      .then(({ data }) => !cancelado && setDados(data))
      .catch((e) => {
        if (cancelado) return;
        if (axios.isAxiosError(e) && e.response?.status === 404) setNaoParticipa(true);
        else setErro(axios.isAxiosError(e) ? e.response?.data?.error ?? "Não foi possível carregar o seu plano." : "Não foi possível carregar o seu plano.");
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const c = dados?.consultor ?? null;
  const g = dados?.global ?? null;
  const proj: ProjecaoDto | null = c?.projecao ?? null;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Gestão de Projetos · Meu plano</p>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Meu plano de evolução</h1>
        <p className="mt-1 text-sm text-muted">O seu andamento no Plano de Evolução Profissional e Eficiência: como o ciclo está indo e quanto o valor hora vai ficar se você cumprir o que depende de você.</p>
      </div>

      {erro && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>}
      {naoParticipa && <Vazio>Você ainda não participa do Plano de Evolução. Se assinou o Termo de Ciência, peça ao administrador para registrar a sua adesão.</Vazio>}
      {!dados && !erro && !naoParticipa && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {dados && (
        <div className="space-y-5">
          {dados.aviso && <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">{dados.aviso}</p>}
          {dados.ensaio && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px] text-foreground" role="status">
              <b>Simulação.</b> Este ciclo é anterior ao início do plano (01/01/2027): os números são calculados com as suas horas reais, só para você conhecer como o plano funciona. Nada aqui vale como resultado.
            </p>
          )}

          {dados.ciclo && (
            <>
              <Cartao titulo={dados.ciclo.rotulo} nota={`${dataBr(dados.ciclo.inicio)} a ${dataBr(dados.ciclo.fim)}`} acao={<Chip tom={dados.ciclo.status === "publicado" ? "ok" : "off"}>{dados.ciclo.status}</Chip>}>
                <ul className="grid gap-x-8 gap-y-1 text-[13px] text-muted sm:grid-cols-3">
                  <li>
                    Corte de evidências: <b className="text-foreground">{dataBr(dados.ciclo.corteEvidencias)}</b>
                  </li>
                  <li>
                    Devolutiva: <b className="text-foreground">{dataBr(dados.ciclo.devolutivaEm)}</b>
                  </li>
                  <li>
                    Contestação até: <b className="text-foreground">{dataBr(dados.ciclo.contestacaoAte)}</b>
                  </li>
                </ul>
              </Cartao>

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Indicador
                  rotulo="Minha produtividade"
                  valor={c?.produtividade.semBase ? "sem base" : pctNum(c?.produtividade.indice)}
                  sub={c ? `${hn(c.produtividade.horasMin)} h na área${c.produtividade.meta != null ? ` · meta ${pctNum(c.produtividade.meta)}` : ""}` : undefined}
                  tom={c?.produtividade.semBase ? "off" : tomDaMeta(c?.produtividade.atingiu ?? null)}
                  dica="Das horas que você apontou nos itens da área, a parte que ficou dentro do orçado do item. Abaixo da amostra mínima do ciclo o indicador fica sem base."
                />
                <Indicador
                  rotulo="Apontamento online"
                  valor={c?.online.semBase ? "sem base" : pctNum(c?.online.indice)}
                  sub={c?.online.meta != null ? `meta ${pctNum(c.online.meta)}` : undefined}
                  tom={c?.online.semBase ? "off" : tomDaMeta(c?.online.atingiu ?? null)}
                  dica="Parte das suas horas do ciclo apontadas ao vivo, pelo Start/Stop, e não depois do fato."
                />
                <Indicador
                  rotulo="Eficiência global da área"
                  valor={pctNum(g?.indice)}
                  sub={g?.meta != null ? `meta ${pctNum(g.meta)} · coletiva` : "meta ainda não definida"}
                  tom={g?.semBase ? "off" : tomDaMeta(g?.atingiu ?? null)}
                  dica="Resultado de toda a área, igual para todos. Se não for atingido, você pontua 4% em vez de 5%, mas não perde o ciclo nem o reforçador."
                />
                <Indicador rotulo="Ciclos já cumpridos" valor={dados.participante.ciclosConsecutivosAntes} sub="seguidos, antes deste" dica="Cada ciclo cumprido soma 0,5 ponto percentual no ciclo seguinte (reforçador), até o 10º." />
              </div>

              {proj ? (
                <Cartao titulo="Quanto fica o meu valor hora" nota="projeção, se você cumprir os requisitos que dependem do gestor">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Desfecho titulo="Se a área atingir a meta global" r={proj.comGlobal} />
                    <Desfecho titulo="Se a área não atingir" r={proj.semGlobal} />
                  </div>
                  <p className="mt-3 text-[12.5px] text-muted">
                    É uma projeção, não o resultado: certificações, avaliação de clientes, case técnico e avaliação de competências ainda serão lançados pelo gestor na apuração. O valor sempre é calculado sobre o seu
                    Valor Hora Base, nunca sobre o ciclo anterior.
                  </p>
                </Cartao>
              ) : (
                <Vazio>A projeção do valor hora aparece quando o administrador lançar o seu Valor Hora Base.</Vazio>
              )}

              {c && c.pendentes.length > 0 && !dados.historico.some((h) => h.cicloRotulo === dados.ciclo?.rotulo) && (
                <Cartao titulo="O que depende da apuração" nota="lançado pelo gestor, com evidência">
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                    {c.pendentes.map((p) => (
                      <li key={p}>{ROTULO_REQUISITO[p] ?? p}</li>
                    ))}
                  </ul>
                  {dados.ciclo.certificacoesExigidas && (
                    <p className="mt-3 text-[13px] text-muted">
                      Certificações exigidas neste ciclo: <b className="text-foreground">{dados.ciclo.certificacoesExigidas}</b>
                    </p>
                  )}
                </Cartao>
              )}
            </>
          )}

          {dados.historico.length > 0 && (
            <Cartao titulo="Meus resultados" nota="apurados pelo gestor e devolvidos a você">
              <ul className="divide-y divide-border/60">
                {dados.historico.map((h) => (
                  <li key={h.apuracaoId} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-foreground">{h.cicloRotulo}</span>
                      <Chip tom={tomDaSituacaoCiclo(h.statusCiclo)}>{rotuloSituacaoCiclo(h.statusCiclo)}</Chip>
                      {h.ensaio && <Chip tom="warn">simulação</Chip>}
                      <span className="text-[12px] text-muted">{h.statusRotulo}</span>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">
                      {h.statusCiclo === "cumprido" && h.percentualBp != null ? (
                        <>
                          <b className="text-foreground">{pctBp(h.percentualBp)}</b> sobre o valor base
                          {h.valorHora != null && (
                            <>
                              {" "}
                              = <b className="font-mono text-foreground">{brl2(h.valorHora)}</b>/h
                            </>
                          )}
                          {h.efetivou && <span className="text-success"> · efetivou o valor como novo Valor Hora Base</span>}
                        </>
                      ) : (
                        "Neste ciclo o valor ficou no valor base."
                      )}
                      {h.devolutivaEm ? ` · devolutiva em ${dataBr(h.devolutivaEm)}` : ""}
                    </p>
                    {h.contestacao && (
                      <p className="mt-1 text-[12.5px] text-muted">
                        Contestação{h.contestacao.recebidaEm ? ` em ${dataBr(h.contestacao.recebidaEm)}` : ""}: {h.contestacao.texto}
                        {h.desfecho ? <> · desfecho: <b className="text-foreground">{h.desfecho.resultado === "procedente" ? "procedente" : "mantida"}</b>{h.desfecho.texto ? ` — ${h.desfecho.texto}` : ""}</> : " · aguardando resposta"}
                      </p>
                    )}
                    <a href={`/projetos/eficiencia/plano-evolucao/memoria/${h.apuracaoId}`} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[12.5px] font-medium text-primary hover:underline">
                      Ver a memória de cálculo
                    </a>
                  </li>
                ))}
              </ul>
            </Cartao>
          )}

          <Cartao titulo="Meu valor hora base" nota={`adesão em ${dataBr(dados.participante.dataAdesao)} · 1º ciclo em ${dataBr(dados.participante.primeiroCicloInicio)}`}>
            <ul className="space-y-1 text-[13px]">
              {dados.participante.historicoBase.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-4 text-muted">
                  <span className="font-mono text-foreground">{brl2(h.valorHoraBase)}</span>
                  <span>desde {dataBr(h.desde)}</span>
                  <span>{h.motivoRotulo}</span>
                </li>
              ))}
            </ul>
          </Cartao>
        </div>
      )}
    </div>
  );
}
