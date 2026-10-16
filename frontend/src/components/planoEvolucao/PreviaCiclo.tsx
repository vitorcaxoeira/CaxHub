import { useMemo, useState } from "react";
import { hh, hn } from "../../lib/eficiencia";
import { PreviaConsultorDto, PreviaResposta, ROTULO_REQUISITO, ResultadoCicloDto, brl2, dataBr, pctBp, pctNum, tomDaMeta } from "../../lib/planoEvolucao";
import { Cartao, Chip, Indicador, Ordem, TabelaRolavel, Th, Vazio, ordenar, proximaOrdem } from "../eficiencia/comum";

type Chave = "nome" | "produtividade" | "online" | "horas";

// Resumo de um resultado projetado: "5,0%" (e o valor, quando a pessoa pode ver) ou o motivo do descumprimento.
function Projetado({ r, mostraValores }: { r: ResultadoCicloDto; mostraValores: boolean }) {
  if (r.status === "descumprido") return <span className="text-destructive">0% · {r.motivos.map((m) => ROTULO_REQUISITO[m] ?? m).join(", ")}</span>;
  if (r.status === "nao_apurado") return <span className="text-muted">não apurado</span>;
  return (
    <span>
      <b className="font-mono text-foreground">{pctBp(r.percentualBp)}</b>
      {mostraValores && r.valorHora != null && <span className="ml-1.5 font-mono text-muted">{brl2(r.valorHora)}/h</span>}
      {r.efetivou && <span className="ml-1.5 text-success">efetiva</span>}
    </span>
  );
}

// Prévia ao vivo de um ciclo: índice global da área contra a meta e, por participante, os indicadores automáticos e a projeção do valor hora.
// NÃO é a apuração: os requisitos que dependem do gestor ainda estão pendentes e a projeção os assume cumpridos.
export function PreviaCiclo({ previa }: { previa: PreviaResposta }) {
  const { ciclo, global: g, consultores, mostraValores } = previa;
  const [ordem, setOrdem] = useState<Ordem<Chave>>({ chave: "horas", dir: -1 });
  const linhas = useMemo(
    () =>
      ordenar<PreviaConsultorDto, Chave>(consultores, ordem, (c, k) => {
        if (k === "nome") return c.nome;
        if (k === "produtividade") return c.produtividade.indice ?? -1;
        if (k === "online") return c.online.indice ?? -1;
        return c.produtividade.horasMin;
      }),
    [consultores, ordem]
  );
  const ordenarPor = (k: Chave) => setOrdem((o) => proximaOrdem(o, k, ["nome"]));
  const semBaseGlobal = g.semBase;

  return (
    <div className="space-y-5">
      {previa.ensaio && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px] text-foreground" role="status">
          <b>Ciclo de ensaio.</b> {ciclo.rotulo} é anterior à vigência do plano (01/01/2027): a prévia simula o ciclo com dados reais e inclui todos os participantes ativos.
        </p>
      )}
      {ciclo.status === "rascunho" && (
        <p className="rounded-md border border-border bg-surface-2/60 px-4 py-2.5 text-[13px] text-muted" role="status">
          <b className="text-foreground">Rascunho.</b> Os parâmetros ainda podem mudar. Ao publicar, ficam travados até o fim do ciclo.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Indicador
          rotulo="Eficiência global da área"
          valor={pctNum(g.indice)}
          sub={g.meta != null ? `meta ${pctNum(g.meta)}` : "meta ainda não definida"}
          medidor={g.indice != null ? g.indice / 100 : undefined}
          tom={semBaseGlobal ? "off" : tomDaMeta(g.atingiu)}
          dica="Horas dentro do orçado do item ÷ horas executadas, em todos os itens da área, no ciclo. É coletiva: todos os consultores recebem o mesmo resultado."
        />
        <Indicador rotulo="Horas da área no ciclo" valor={<>{hn(g.executadoMin)}<small className="ml-0.5 text-[13px] font-medium text-muted">h</small></>} sub={`${hn(g.dentroMin)} h dentro do orçado · ${hn(g.acimaMin)} h acima`} />
        <Indicador rotulo="Itens com horas" valor={g.itens} sub={`departamentos: ${ciclo.departamentosAreaRotulos.join(" e ")}`} />
        <Indicador rotulo="Participantes avaliados" valor={consultores.length} sub={ciclo.definicaoOnline === "A" ? "online = só Start/Stop" : "online = Start/Stop + Senior no mesmo dia"} />
      </div>

      <Cartao
        titulo="Consultores"
        nota={`${dataBr(ciclo.inicio)} a ${dataBr(ciclo.fim)} · calculado às ${new Date(previa.calculadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
      >
        <p className="mb-3 text-[12.5px] text-muted">
          Projeção do ciclo <b className="text-foreground">assumindo cumpridos</b> os requisitos que dependem do gestor (competências, certificações, avaliação de clientes e case).
          Mostra os dois desfechos do requisito global, que é coletivo.
        </p>
        {linhas.length === 0 ? (
          <Vazio>Nenhum participante neste recorte. Cadastre a adesão na aba Participantes.</Vazio>
        ) : (
          <TabelaRolavel altura="max-h-[60vh]">
            <table className="w-full border-collapse text-sm [&_td]:px-2 [&_th]:px-2">
              <thead>
                <tr>
                  <Th rotulo="Consultor" chave="nome" ordem={ordem} onOrdenar={ordenarPor} />
                  <Th rotulo="Horas na área" chave="horas" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Produtividade" chave="produtividade" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Online" chave="online" ordem={ordem} onOrdenar={ordenarPor} numerico />
                  <Th rotulo="Eficiência individual" />
                  <Th rotulo="Se a área atingir o global" />
                  <Th rotulo="Se não atingir" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((c) => (
                  <tr key={c.id} className="border-t border-border/60 align-top hover:bg-surface-2">
                    <td className="px-2.5 py-2">
                      <span className="block font-medium text-foreground">{c.nome}</span>
                      <span className="block text-[11.5px] text-muted">{c.pendentes.length} requisito{c.pendentes.length === 1 ? "" : "s"} pendente{c.pendentes.length === 1 ? "" : "s"}</span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono tabular-nums">
                      {hn(c.produtividade.horasMin)} h
                      <span className="block text-[11px] text-muted">{c.produtividade.itens} iten{c.produtividade.itens === 1 ? "" : "s"}</span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right">
                      {c.produtividade.semBase ? (
                        <span className="text-[12px] text-muted" title={`Menos de ${ciclo.amostraMinimaHoras} h executadas no ciclo: sem base para avaliar`}>sem base</span>
                      ) : (
                        <span className={`font-mono font-semibold tabular-nums ${c.produtividade.atingiu == null ? "text-foreground" : c.produtividade.atingiu ? "text-success" : "text-destructive"}`}>{pctNum(c.produtividade.indice)}</span>
                      )}
                      {c.produtividade.meta != null && <span className="block text-[11px] text-muted">meta {pctNum(c.produtividade.meta)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right">
                      {c.online.semBase ? (
                        <span className="text-[12px] text-muted">sem base</span>
                      ) : (
                        <span className={`font-mono font-semibold tabular-nums ${c.online.atingiu == null ? "text-foreground" : c.online.atingiu ? "text-success" : "text-destructive"}`}>{pctNum(c.online.indice)}</span>
                      )}
                      {c.online.meta != null && <span className="block text-[11px] text-muted">meta {pctNum(c.online.meta)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2">
                      {c.eficienciaIndividual.cumpriu == null ? (
                        <Chip tom="off">sem base</Chip>
                      ) : (
                        <Chip tom={c.eficienciaIndividual.cumpriu ? "ok" : "bad"}>{c.eficienciaIndividual.cumpriu ? "cumpriria" : "não cumpriria"}</Chip>
                      )}
                      {c.eficienciaIndividual.nota != null && <span className="ml-1.5 font-mono text-[11.5px] text-muted">{pctNum(c.eficienciaIndividual.nota)}</span>}
                    </td>
                    <td className="px-2.5 py-2 text-[12.5px]">{c.projecao ? <Projetado r={c.projecao.comGlobal} mostraValores={mostraValores} /> : <span className="text-muted">sem Valor Hora Base</span>}</td>
                    <td className="px-2.5 py-2 text-[12.5px]">{c.projecao ? <Projetado r={c.projecao.semGlobal} mostraValores={mostraValores} /> : <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        )}
        <p className="mt-3 text-[12px] text-muted">
          Horas de cada consultor nos itens da área ({ciclo.departamentosAreaRotulos.join(" e ")}) no ciclo; abaixo de {ciclo.amostraMinimaHoras} h o indicador fica "sem base" e não reprova ninguém.
          {!mostraValores && " Valores em R$ aparecem só para o administrador."}
        </p>
      </Cartao>
    </div>
  );
}

// Lista as horas em formato curto, usada no "Meu plano".
export const horasCurtas = (min: number) => hh(min);
