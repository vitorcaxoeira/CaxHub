import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { arredondar, media, mesSeguinte, minutosParaHoras, percentualDe, sextasDoMes, type FonteIndicador } from "./bonificacao";
import { horasDoMes, saldoBancoDoMesSql } from "./bonificacaoHoras";

// Gestão de Bonificação: apuração dos indicadores automáticos (Kyria e ponto HCM). Cada função devolve `valor` (nulo = sem dado: o resultado
// fica pendente até alguém informar) e `detalhe` (a memória de cálculo, gravada no resultado e mostrada na tela). Competência = dia 1 do mês;
// o mês é o mês de Brasília (os instantes do Kyria vêm em UTC).

const FUSO = "America/Sao_Paulo";

export interface ContextoApuracao {
  /** Dia 1 do mês (meia-noite UTC). */
  competencia: Date;
  codemp: number;
  codfor: number;
  /** Times Kyria do enquadramento (quem a pessoa lidera/atende). */
  timesIds: string[];
  /** Só chamados antigos: idade em meses da regra vigente. */
  idadeMeses: number | null;
}

export interface Apurado {
  valor: number | null;
  detalhe: Record<string, unknown>;
}

const semDado = (motivo: string, extra: Record<string, unknown> = {}): Apurado => ({ valor: null, detalhe: { motivo, ...extra } });

// Instante (timestamp SEM fuso, gravado em UTC) -> hora de parede de Brasília.
const LOCAL_SEM_FUSO = (coluna: string) => Prisma.raw(`((${coluna} AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO}')`);
// Instante (timestamptz) -> hora de parede de Brasília.
const LOCAL_COM_FUSO = (coluna: string) => Prisma.raw(`(${coluna} AT TIME ZONE '${FUSO}')`);

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Capacidade operacional: média, das sextas do mês, do total de chamados em fila ou aguardando retorno dos times. */
async function apurarCapacidade(ctx: ContextoApuracao): Promise<Apurado> {
  if (ctx.timesIds.length === 0) return semDado("Nenhum time Kyria no enquadramento");
  const sextas = sextasDoMes(ctx.competencia);
  const linhas = await prisma.$queryRaw<{ data: Date; fila: number; aguardando: number }[]>`
    SELECT f.data, sum(f.em_fila)::int AS fila, sum(f.aguardando_retorno)::int AS aguardando
    FROM kyria_fila_semanal f
    WHERE f.team_id = ANY(${ctx.timesIds}::text[]) AND f.data >= ${iso(sextas[0])}::date AND f.data <= ${iso(sextas[sextas.length - 1])}::date
    GROUP BY f.data ORDER BY f.data`;
  if (linhas.length === 0) return semDado("Sem foto semanal da fila neste mês (o Kyria só guarda o status atual): informe o valor", { sextasDoMes: sextas.map(iso) });
  const semanas = linhas.map((l) => ({ data: iso(l.data), emFila: l.fila, aguardandoRetorno: l.aguardando, total: l.fila + l.aguardando }));
  const valor = media(semanas.map((s) => s.total));
  return { valor, detalhe: { semanas, sextasNoMes: sextas.length, sextasComFoto: semanas.length } };
}

/** Eficiência: dos chamados abertos no mês (times), quantos % já estão fechados. */
async function apurarEficiencia(ctx: ContextoApuracao): Promise<Apurado> {
  if (ctx.timesIds.length === 0) return semDado("Nenhum time Kyria no enquadramento");
  const ini = iso(ctx.competencia);
  const fim = iso(mesSeguinte(ctx.competencia));
  const [r] = await prisma.$queryRaw<{ abertos: number; fechados: number }[]>`
    SELECT count(*)::int AS abertos,
           count(*) FILTER (WHERE t.closed_at IS NOT NULL AND ${LOCAL_SEM_FUSO("t.closed_at")} < ${fim}::date)::int AS fechados
    FROM kyria_tickets t
    WHERE t.team_id = ANY(${ctx.timesIds}::text[]) AND ${LOCAL_SEM_FUSO("t.opened_at")} >= ${ini}::date AND ${LOCAL_SEM_FUSO("t.opened_at")} < ${fim}::date`;
  const valor = percentualDe(r.fechados, r.abertos);
  if (valor == null) return semDado("Nenhum chamado aberto no mês nos times do enquadramento", { abertos: r.abertos, fechados: r.fechados });
  return { valor, detalhe: { abertos: r.abertos, fechados: r.fechados } };
}

/** Chamados antigos (equipe): chamados dos times abertos há mais de N meses e ainda sem fechar no fim da competência. */
async function apurarChamadosAntigos(ctx: ContextoApuracao): Promise<Apurado> {
  if (ctx.timesIds.length === 0) return semDado("Nenhum time Kyria no enquadramento");
  const idade = ctx.idadeMeses ?? 3;
  const fim = mesSeguinte(ctx.competencia);
  const corte = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() - idade, 1));
  const linhas = await prisma.$queryRaw<{ code: string | null; title: string; openedAt: Date; status: string }[]>`
    SELECT t.code, t.title, t.opened_at AS "openedAt", s.name AS status
    FROM kyria_tickets t
    JOIN kyria_ticket_statuses s ON s.key = t.status_key
    WHERE t.team_id = ANY(${ctx.timesIds}::text[])
      AND ${LOCAL_SEM_FUSO("t.opened_at")} < ${iso(corte)}::date
      AND ((t.closed_at IS NULL AND s.category::text NOT IN ('done', 'cancelled')) OR (t.closed_at IS NOT NULL AND ${LOCAL_SEM_FUSO("t.closed_at")} >= ${iso(fim)}::date))
    ORDER BY t.opened_at
    LIMIT 200`;
  return {
    valor: linhas.length,
    detalhe: {
      idadeMeses: idade,
      abertosAntesDe: iso(corte),
      quantidade: linhas.length,
      chamados: linhas.slice(0, 50).map((l) => ({ codigo: l.code, titulo: l.title, aberto: iso(l.openedAt), status: l.status })),
    },
  };
}

/** % do ponto apontado em chamado: minutos apontados no Kyria ÷ minutos trabalhados do ponto HCM (R066SIT, ConAbs 2). */
async function apurarPctPonto(ctx: ContextoApuracao): Promise<Apurado> {
  const consultor = await prisma.consultor.findFirst({ where: { codemp: ctx.codemp, codfor: ctx.codfor }, select: { codemp: true, codusu: true } });
  if (!consultor) return semDado("Consultor não encontrado");
  const membros = await prisma.kyriaMember.findMany({ where: { codusu: consultor.codusu }, select: { id: true, name: true } });
  if (membros.length === 0) return semDado("Consultor sem vínculo com um membro do Kyria (Administração › Vínculo de Consultores)");
  const vinculo = await prisma.consultorVinculo.findUnique({ where: { codemp_codusu: { codemp: consultor.codemp, codusu: consultor.codusu } } });
  if (!vinculo || vinculo.hcmNumemp == null || vinculo.hcmTipcol == null || vinculo.hcmNumcad == null) {
    return semDado("Consultor sem vínculo com o colaborador do HCM (Administração › Vínculo de Consultores)");
  }
  const ini = iso(ctx.competencia);
  const fim = iso(mesSeguinte(ctx.competencia));
  const ids = membros.map((m) => m.id);

  const [kyria] = await prisma.$queryRaw<{ minutos: number }[]>`
    SELECT COALESCE(sum(e.minutes), 0)::float8 AS minutos
    FROM kyria_time_entries e
    WHERE e.user_id = ANY(${ids}::text[]) AND e.minutes IS NOT NULL
      AND ${LOCAL_COM_FUSO("e.started_at")} >= ${ini}::date AND ${LOCAL_COM_FUSO("e.started_at")} < ${fim}::date`;
  const porTime = await prisma.$queryRaw<{ time: string | null; minutos: number }[]>`
    SELECT COALESCE(kt.name, '(sem time)') AS time, sum(e.minutes)::float8 AS minutos
    FROM kyria_time_entries e
    JOIN kyria_tickets t ON t.id = e.ticket_id
    LEFT JOIN kyria_teams kt ON kt.id = t.team_id
    WHERE e.user_id = ANY(${ids}::text[]) AND e.minutes IS NOT NULL
      AND ${LOCAL_COM_FUSO("e.started_at")} >= ${ini}::date AND ${LOCAL_COM_FUSO("e.started_at")} < ${fim}::date
    GROUP BY kt.name ORDER BY 2 DESC`;
  const [ponto] = await prisma.$queryRaw<{ minutos: number }[]>`
    SELECT COALESCE(sum(sp.qtdhor), 0)::float8 AS minutos
    FROM hcm_situacao_ponto sp
    JOIN hcm_situacoes st ON st.codsit = sp.codsit
    WHERE sp.numemp = ${vinculo.hcmNumemp} AND sp.tipcol = ${vinculo.hcmTipcol} AND sp.numcad = ${vinculo.hcmNumcad}
      AND st.conabs = 2 AND sp.removido_em_senior IS NULL
      AND sp.datapu >= ${ini}::date AND sp.datapu < ${fim}::date`;

  const [banco] = await prisma.$queryRaw<{ minutos: number | null }[]>(saldoBancoDoMesSql(vinculo.hcmNumemp, vinculo.hcmTipcol, vinculo.hcmNumcad, ini, fim));
  // Denominador = total do mês (trabalhadas + saldo POSITIVO do banco de horas): domain/bonificacaoHoras.ts, a mesma regra da tela.
  const mes = horasDoMes({ trabalhadas: ponto.minutos, saldoBanco: banco.minutos, kyria: kyria.minutos });

  const detalhe = {
    minutosKyria: arredondar(kyria.minutos, 2),
    horasKyria: minutosParaHoras(kyria.minutos),
    minutosPonto: ponto.minutos,
    horasPonto: minutosParaHoras(ponto.minutos),
    saldoBancoMinutos: banco.minutos ?? 0,
    ...((banco.minutos ?? 0) < 0 ? { bancoDeHoras: "Saldo do mês negativo: não entrou no cálculo" } : {}),
    minutosExtras: mes.minutosExtras,
    minutosTotal: mes.minutosTotal,
    horasTotal: minutosParaHoras(mes.minutosTotal),
    membrosKyria: membros.map((m) => m.name),
    porTime: porTime.map((t) => ({ time: t.time, minutos: arredondar(t.minutos, 2) })),
  };
  if (mes.percentual == null) return { valor: null, detalhe: { motivo: "Sem horas trabalhadas no ponto HCM neste mês", ...detalhe } };
  return { valor: mes.percentual, detalhe };
}

/** Apura um indicador automático. Fonte manual não passa por aqui (valor nulo, a pessoa informa). */
export async function apurarIndicador(fonte: FonteIndicador, ctx: ContextoApuracao): Promise<Apurado> {
  switch (fonte) {
    case "kyria_capacidade":
      return apurarCapacidade(ctx);
    case "kyria_eficiencia":
      return apurarEficiencia(ctx);
    case "kyria_chamados_antigos":
      return apurarChamadosAntigos(ctx);
    case "kyria_pct_ponto":
      return apurarPctPonto(ctx);
    case "manual":
      return { valor: null, detalhe: {} };
  }
}

// ------------------------------------------------------------------------------------------------------------------------------ foto da fila
/**
 * Foto da fila do Kyria no dia (hoje, por padrão): por time ativo, quantos chamados estão em fila e aguardando retorno AGORA. O Kyria só guarda
 * o status atual do chamado, então é a única forma de ter "quantos chamados havia na sexta" depois que a sexta passou. Idempotente por (data, time):
 * repetir no mesmo dia regrava a foto.
 */
export async function capturarFilaDoDia(data: Date): Promise<{ times: number }> {
  const dia = iso(data);
  const n = await prisma.$executeRaw`
    INSERT INTO kyria_fila_semanal (data, team_id, em_fila, aguardando_retorno, capturado_em)
    SELECT ${dia}::date, kt.id,
           count(t.id) FILTER (WHERE s.category::text = 'queue')::int,
           count(t.id) FILTER (WHERE s.category::text = 'awaiting_return')::int,
           now()
    FROM kyria_teams kt
    LEFT JOIN kyria_tickets t ON t.team_id = kt.id AND t.closed_at IS NULL
    LEFT JOIN kyria_ticket_statuses s ON s.key = t.status_key AND s.category::text IN ('queue', 'awaiting_return')
    WHERE kt.status::text = 'active'
    GROUP BY kt.id
    ON CONFLICT (data, team_id) DO UPDATE SET em_fila = EXCLUDED.em_fila, aguardando_retorno = EXCLUDED.aguardando_retorno, capturado_em = EXCLUDED.capturado_em`;
  return { times: n };
}
