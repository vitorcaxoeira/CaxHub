import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { classeBotaoPerigo, classeBotaoSecundario } from "../../../components/gestao5s/campos";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import {
  fmtCompetencia,
  fmtData,
  fmtDataHora,
  fmtMoeda,
  mensagemDe,
  ModalJustificativa,
  Selo,
  TOM_SITUACAO,
  TOM_STATUS,
} from "./comum";
import type { EventoHistorico, ParcelaDetalhe, ProcessoDetalhe } from "./tipos";

// Linha aberta de um processo na lista de Lançamentos: resumo, parcelas (com cancelar/estornar por parcela), ações do processo e o
// histórico completo (criação, alterações, cancelamentos, estornos, fechamentos). Tudo vem de GET /api/descontos/processos/:id.

const ROTULO_EVENTO: Record<string, string> = {
  DESCONTO_PROCESSO_CRIADO: "Processo criado",
  DESCONTO_PROCESSO_ALTERADO: "Processo alterado",
  DESCONTO_PROCESSO_CANCELADO: "Processo cancelado",
  DESCONTO_PROCESSO_QUITADO: "Quitado antecipadamente",
  DESCONTO_PARCELA_CANCELADA: "Parcela cancelada",
  DESCONTO_PARCELA_ESTORNADA: "Parcela estornada",
  DESCONTO_PARCELA_DESCONTADA: "Parcela descontada",
  DESCONTO_PARCELA_PARCIAL: "Parcela descontada em parte",
  DESCONTO_PARCELA_TRANSPORTADA: "Parcela transportada",
};

function valorDoHistorico(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : fmtMoeda(v);
  return String(v);
}

function descreverEvento(e: EventoHistorico): string {
  const partes: string[] = [];
  const m = e.metadata ?? {};
  // Criação: um resumo, não a lista de todos os campos que "mudaram" de vazio para o valor inicial.
  if (e.evento === "DESCONTO_PROCESSO_CRIADO") {
    if (typeof m.tipo === "string") partes.push(m.tipo);
    if (typeof m.parcelas === "number") partes.push(`${m.parcelas} parcela(s)`);
    return partes.join(" · ");
  }
  if (typeof m.motivo === "string") partes.push(`Motivo: ${m.motivo}`);
  if (typeof m.naoDescontado === "number") partes.push(`Não descontado: ${fmtMoeda(m.naoDescontado)} (segue para a próxima competência)`);
  if (typeof m.valorDevolvido === "number") partes.push(`Valor devolvido: ${fmtMoeda(m.valorDevolvido)}`);
  if (typeof m.valorNota === "number") partes.push(`Nota da competência: ${fmtMoeda(m.valorNota)}`);
  if (e.alteracoes) {
    for (const [campo, mud] of Object.entries(e.alteracoes)) {
      partes.push(`${mud.rotulo ?? campo}: ${valorDoHistorico(mud.de)} → ${valorDoHistorico(mud.para)}`);
    }
  }
  return partes.join(" · ");
}

type Acao =
  | { tipo: "cancelar-processo" }
  | { tipo: "quitar-processo" }
  | { tipo: "cancelar-parcela"; parcela: ParcelaDetalhe }
  | { tipo: "estornar-parcela"; parcela: ParcelaDetalhe };

export function DetalheProcesso({
  id,
  recarga,
  onMudou,
  onEditar,
}: {
  id: number;
  /** Muda quando a lista foi recarregada por fora: busca o detalhe de novo. */
  recarga: unknown;
  /** Avisa a lista que algo mudou (status, saldo): ela busca de novo. */
  onMudou: () => void;
  onEditar: (p: ProcessoDetalhe) => void;
}) {
  const { mostrar } = useToast();
  const [d, setD] = useState<ProcessoDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);

  const carregar = useCallback(() => {
    axios
      .get<ProcessoDetalhe>(`/api/descontos/processos/${id}`)
      .then(({ data }) => {
        setD(data);
        setErro(null);
      })
      .catch((e) => setErro(mensagemDe(e, "Falha ao carregar o processo")));
  }, [id]);

  useEffect(carregar, [carregar, recarga]);

  async function executar(a: Acao, justificativa: string) {
    const base = `/api/descontos`;
    if (a.tipo === "cancelar-processo") await axios.post(`${base}/processos/${id}/cancelar`, { justificativa });
    else if (a.tipo === "quitar-processo") await axios.post(`${base}/processos/${id}/quitar`, { justificativa });
    else if (a.tipo === "cancelar-parcela") await axios.post(`${base}/parcelas/${a.parcela.id}/cancelar`, { justificativa });
    else await axios.post(`${base}/parcelas/${a.parcela.id}/estornar`, { justificativa });
    mostrar("Ação registrada no histórico", "success");
    setAcao(null);
    carregar();
    onMudou();
  }

  if (erro) return <p className="py-2 text-sm text-destructive">{erro}</p>;
  if (!d) return <Skeleton className="h-24 w-full" />;

  const temPendente = d.parcelas.some((p) => p.situacao === "pendente");
  const configAcao = acao && {
    "cancelar-processo": { titulo: `Cancelar ${d.numero}`, descricao: "As parcelas pendentes serão canceladas e deixam de ser descontadas. O que já foi descontado continua registrado.", rotulo: "Cancelar processo", perigo: true },
    "quitar-processo": { titulo: `Quitar ${d.numero} antecipadamente`, descricao: "As parcelas pendentes serão marcadas como quitadas antecipadamente (o consultor acertou por outro meio) e saem da nota.", rotulo: "Quitar", perigo: false },
    "cancelar-parcela": { titulo: "Cancelar parcela", descricao: "A parcela deixa de ser descontada e não pesa mais na nota.", rotulo: "Cancelar parcela", perigo: true },
    "estornar-parcela": { titulo: "Estornar parcela", descricao: "O desconto aplicado é desfeito (o valor é devolvido ao consultor) e o saldo que seguiu para o mês seguinte deixa de ser devido.", rotulo: "Estornar", perigo: true },
  }[acao.tipo];

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 md:grid-cols-4">
          {(
            [
              ["Consultor", d.consultor],
              ["Tipo", d.tipo],
              ["Modo", d.modoRotulo],
              ["Valor total", fmtMoeda(d.valorTotal)],
              ["Parcelas", `${d.qtdParcelas} × ${fmtMoeda(d.valorParcela)}`],
              ["Vigência", `${fmtData(d.vigenciaInicio)} a ${fmtData(d.vigenciaFim)}`],
              ["Já descontado", fmtMoeda(d.totalDescontado)],
              ["Saldo devedor", fmtMoeda(d.saldoDevedor)],
            ] as const
          ).map(([rotulo, valor]) => (
            <div key={rotulo}>
              <dt className="text-[11px] text-muted">{rotulo}</dt>
              <dd className="font-medium text-foreground">{valor}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col items-end gap-2">
          <Selo texto={d.statusRotulo} tone={TOM_STATUS[d.status]} />
          {d.podeAdministrar && (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={classeBotaoSecundario} onClick={() => onEditar(d)}>
                Editar
              </button>
              {temPendente && (
                <>
                  <button type="button" className={classeBotaoSecundario} onClick={() => setAcao({ tipo: "quitar-processo" })}>
                    Quitar antecipadamente
                  </button>
                  <button type="button" className={classeBotaoPerigo} onClick={() => setAcao({ tipo: "cancelar-processo" })}>
                    Cancelar processo
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {d.observacao && <p className="text-[12.5px] text-muted">Observação: {d.observacao}</p>}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-1.5">Parcela</th>
              <th className="px-3 py-1.5">Competência</th>
              <th className="px-3 py-1.5">Vencimento</th>
              <th className="px-3 py-1.5 text-right">Valor</th>
              <th className="px-3 py-1.5 text-right">Descontado</th>
              <th className="px-3 py-1.5 text-right">Restante</th>
              <th className="px-3 py-1.5">Situação</th>
              {d.podeAdministrar && <th className="px-3 py-1.5 text-right">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {d.parcelas.map((p) => (
              <tr key={p.id} className="border-t border-border/60 align-top">
                <td className="px-3 py-1.5 font-mono">
                  {p.numero}
                  {p.transportada && <span className="ml-1 text-[10.5px] text-warning" title={p.observacao ?? "Saldo transportado"}>saldo</span>}
                </td>
                <td className="px-3 py-1.5">{fmtCompetencia(p.competencia)}</td>
                <td className="px-3 py-1.5">{fmtData(p.vencimento)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtMoeda(p.valor)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtMoeda(p.valorDescontado)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtMoeda(p.restante)}</td>
                <td className="px-3 py-1.5" title={p.observacao ?? undefined}>
                  <Selo texto={p.situacaoRotulo} tone={TOM_SITUACAO[p.situacao]} />
                </td>
                {d.podeAdministrar && (
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs">
                    {p.situacao === "pendente" && (
                      <button type="button" className="text-destructive hover:underline" onClick={() => setAcao({ tipo: "cancelar-parcela", parcela: p })}>
                        Cancelar
                      </button>
                    )}
                    {(p.situacao === "descontada" || p.situacao === "parcial") && (
                      <button type="button" className="text-destructive hover:underline" onClick={() => setAcao({ tipo: "estornar-parcela", parcela: p })}>
                        Estornar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted">Histórico</p>
        <ul className="space-y-1.5">
          {d.historico.map((e) => (
            <li key={e.id} className="rounded-md border border-border/60 bg-surface px-3 py-1.5 text-[12.5px]">
              <span className="font-medium text-foreground">{ROTULO_EVENTO[e.evento] ?? e.evento}</span>
              <span className="text-muted"> · {e.usuario} · {fmtDataHora(e.ocorridoEm)}</span>
              {e.parcelaId && <span className="text-muted"> · parcela #{e.parcelaId}</span>}
              {descreverEvento(e) && <p className="mt-0.5 text-muted">{descreverEvento(e)}</p>}
            </li>
          ))}
          {d.historico.length === 0 && <li className="text-[12.5px] text-muted">Sem registros.</li>}
        </ul>
      </div>

      {acao && configAcao && (
        <ModalJustificativa
          titulo={configAcao.titulo}
          descricao={configAcao.descricao}
          rotuloConfirmar={configAcao.rotulo}
          perigo={configAcao.perigo}
          onConfirmar={(j) => executar(acao, j)}
          onFechar={() => setAcao(null)}
        />
      )}
    </div>
  );
}
