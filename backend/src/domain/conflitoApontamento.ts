import { prisma } from "../db/prisma";
import { doDiaBrasil, paraHoraBrasil } from "./fusoBrasil";

// Conflito de horário de um apontamento: o consultor não pode ter trabalhado duas coisas
// no mesmo intervalo. Consultado no envio de uma solicitação avulsa e de novo na aprovação
// — o gestor pode editar os horários, e sem a segunda checagem ele aprovaria para dentro de
// um conflito que o consultor não conseguiu enviar.
//
// Olha TRÊS frentes, e as três importam:
//
//   sessões      o Start/Stop do quadro (AtividadeSessaoExecucao fechada)
//   RatItem      o apontamento já efetivado — inclusive o que veio do Senior
//   pendentes    outra solicitação avulsa esperando decisão
//
// RatItem é a frente que carrega o peso: medido em 03/08/2026, a base tem 86.455 RatItem e
// só 10 deles têm sessão local — o resto veio sincronizado do ERP. Uma checagem que olhasse
// apenas sessões passaria batida em praticamente todo o histórico real e daria uma falsa
// sensação de proteção.
//
// O recorte é por CONSULTOR, não por atividade: trabalhar duas coisas ao mesmo tempo
// atravessa propostas, e é justamente o caso que a hora dobrada esconde.

export interface ConflitoApontamento {
  origem: "sessao" | "apontamento" | "solicitacao_pendente";
  inicio: Date;
  fim: Date;
  descricao: string;
}

function formatarIntervalo(inicio: Date, fim: Date): string {
  const i = paraHoraBrasil(inicio);
  const f = paraHoraBrasil(fim);
  const hhmm = (h: { minutosDoDia: number }) =>
    `${String(Math.trunc(h.minutosDoDia / 60)).padStart(2, "0")}:${String(h.minutosDoDia % 60).padStart(2, "0")}`;
  return `${String(i.dia).padStart(2, "0")}/${String(i.mes).padStart(2, "0")} ${hhmm(i)}–${hhmm(f)}`;
}

function seSobrepoem(aInicio: Date, aFim: Date, bInicio: Date, bFim: Date): boolean {
  // Intervalos meio-abertos: encostar (fim de um == início do outro) NÃO é conflito, senão
  // apontar 09:00–10:00 e 10:00–11:00 em sequência seria recusado.
  return aInicio.getTime() < bFim.getTime() && bInicio.getTime() < aFim.getTime();
}

// RatItem guarda `datati` (@db.Date, gravada como meia-noite UTC) e `horini`/`horfim` em
// minutos desde a meia-noite — hora de PAREDE brasileira. Reconstituir o instante exige
// cuidado nos dois lados:
//
//   - a data sai dos componentes UTC de `datati`. Passar a própria `datati` por
//     paraHoraBrasil devolveria o dia ANTERIOR (meia-noite UTC = 21:00 do dia -1 em SP);
//   - a referência é montada ao meio-dia UTC, que é 09:00 em SP — mesmo dia do calendário
//     em qualquer estação, então doDiaBrasil aplica o offset do dia certo.
function instanteDoRatItem(datati: Date, minutos: number): Date {
  const referencia = new Date(Date.UTC(datati.getUTCFullYear(), datati.getUTCMonth(), datati.getUTCDate(), 12));
  return doDiaBrasil(referencia, minutos);
}

// Datas de calendário brasileiras tocadas pelo intervalo, com uma folga de um dia de cada
// lado — a consulta filtra `datati`, que é dia de parede, e o intervalo pode cruzar a
// meia-noite ou encostar na borda do fuso.
function datasParaConsulta(inicio: Date, fim: Date): Date[] {
  const dias: Date[] = [];
  const primeiro = Date.UTC(paraHoraBrasil(inicio).ano, paraHoraBrasil(inicio).mes - 1, paraHoraBrasil(inicio).dia);
  const ultimo = Date.UTC(paraHoraBrasil(fim).ano, paraHoraBrasil(fim).mes - 1, paraHoraBrasil(fim).dia);
  for (let t = primeiro - 86_400_000; t <= ultimo + 86_400_000; t += 86_400_000) dias.push(new Date(t));
  return dias;
}

export async function conflitosDoIntervalo(
  codemp: number,
  codfor: number,
  inicio: Date,
  fim: Date,
  opcoes: { ignorarSolicitacaoId?: number; ignorarSessaoId?: number } = {}
): Promise<ConflitoApontamento[]> {
  const atividadesDoConsultor = await prisma.atividadeConsultor.findMany({
    where: { codemp, codfor },
    select: { id: true, codpro: true, seqite: true },
  });
  const idsAtividade = atividadesDoConsultor.map((a) => a.id);
  const rotuloAtividade = new Map(atividadesDoConsultor.map((a) => [a.id, `proposta ${a.codpro}, item ${a.seqite}`]));

  const [sessoes, ratItens, pendentes] = await Promise.all([
    idsAtividade.length > 0
      ? prisma.atividadeSessaoExecucao.findMany({
          where: {
            atividadeId: { in: idsAtividade },
            fim: { not: null },
            ...(opcoes.ignorarSessaoId ? { id: { not: opcoes.ignorarSessaoId } } : {}),
          },
          select: { id: true, atividadeId: true, inicio: true, fim: true },
        })
      : Promise.resolve([]),
    prisma.ratItem.findMany({
      where: {
        rat: { codemp, codfor },
        datati: { in: datasParaConsulta(inicio, fim) },
        horini: { not: null },
        horfim: { not: null },
      },
      select: { id: true, datati: true, horini: true, horfim: true, codpro: true, seqite: true },
    }),
    prisma.solicitacaoApontamento.findMany({
      where: {
        status: "pendente",
        atividadeId: { in: idsAtividade },
        ...(opcoes.ignorarSolicitacaoId ? { id: { not: opcoes.ignorarSolicitacaoId } } : {}),
      },
      select: { id: true, atividadeId: true, inicioSolicitado: true, fimSolicitado: true },
    }),
  ]);

  const conflitos: ConflitoApontamento[] = [];

  for (const s of sessoes) {
    if (!seSobrepoem(inicio, fim, s.inicio, s.fim!)) continue;
    conflitos.push({
      origem: "sessao",
      inicio: s.inicio,
      fim: s.fim!,
      descricao: `execução registrada no quadro (${rotuloAtividade.get(s.atividadeId) ?? "atividade"}) em ${formatarIntervalo(s.inicio, s.fim!)}`,
    });
  }

  for (const r of ratItens) {
    if (r.datati == null || r.horini == null || r.horfim == null) continue;
    const rInicio = instanteDoRatItem(r.datati, r.horini);
    const rFim = instanteDoRatItem(r.datati, r.horfim);
    if (!seSobrepoem(inicio, fim, rInicio, rFim)) continue;
    conflitos.push({
      origem: "apontamento",
      inicio: rInicio,
      fim: rFim,
      descricao: `apontamento já registrado (proposta ${r.codpro ?? "?"}, item ${r.seqite ?? "?"}) em ${formatarIntervalo(rInicio, rFim)}`,
    });
  }

  for (const p of pendentes) {
    if (!seSobrepoem(inicio, fim, p.inicioSolicitado, p.fimSolicitado)) continue;
    conflitos.push({
      origem: "solicitacao_pendente",
      inicio: p.inicioSolicitado,
      fim: p.fimSolicitado,
      descricao: `outra solicitação sua aguardando aprovação (${rotuloAtividade.get(p.atividadeId) ?? "atividade"}) em ${formatarIntervalo(p.inicioSolicitado, p.fimSolicitado)}`,
    });
  }

  return conflitos.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

export function mensagemDeConflito(conflitos: ConflitoApontamento[]): string {
  return `Este horário já está ocupado: ${conflitos.map((c) => c.descricao).join("; ")}.`;
}
