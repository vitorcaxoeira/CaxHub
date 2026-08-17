import { prisma } from "../db/prisma";

// Agregações do dashboard inicial do consultor (Home) — separadas da rota (routes/
// dashboard.ts) porque a conta de "horas realizadas num período" é a mesma definição usada
// em domain/tetoAtividade.ts (realizadoDaAtividade), só que aqui somada por DIA/PROJETO em
// vez de por atividade: sessão de execução fechada e NÃO confirmada (confirmada=false,
// fim preenchido, não excluída) + duração de RatItem já confirmado/sincronizado. Nunca as
// duas ao mesmo tempo pra mesma hora (ver comentário de realizadoDaAtividade).

export interface MinutosPorDia {
  data: string; // YYYY-MM-DD
  minutos: number;
}

export interface MinutosPorProjeto {
  codpro: number;
  nome: string;
  minutos: number;
}

function chaveDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Enumera as datas (YYYY-MM-DD) de `de` a `ate`, inclusive nos dois extremos — usada tanto
// pra zero-preencher o gráfico por dia quanto pra somar a meta dia a dia.
export function diasDoPeriodo(de: Date, ate: Date): string[] {
  const dias: string[] = [];
  const atual = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate()));
  const fim = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate()));
  while (atual.getTime() <= fim.getTime()) {
    dias.push(chaveDia(atual));
    atual.setUTCDate(atual.getUTCDate() + 1);
  }
  return dias;
}

// Horas realizadas de um consultor num período, já agrupadas por dia e por projeto (codpro).
// `ate` é tratado como fim do dia (23:59:59.999) pra incluir o dia inteiro.
export async function horasRealizadasNoPeriodo(
  codemp: number,
  codfor: number,
  de: Date,
  ate: Date
): Promise<{ porDia: Map<string, number>; porProjeto: Map<number, number>; totalMinutos: number }> {
  const fimDoDia = new Date(ate);
  fimDoDia.setUTCHours(23, 59, 59, 999);

  const [sessoes, ratItens] = await Promise.all([
    prisma.atividadeSessaoExecucao.findMany({
      where: {
        confirmada: false,
        fim: { not: null, gte: de, lte: fimDoDia },
        excluidaEm: null,
        // sitreg "A" filtra atividade soft-deletada — mesmo filtro de GET /sessoes-pendentes
        // em routes/apontamentos.ts (não é o mesmo `excluidaEm` da sessão, é da ATIVIDADE).
        atividade: { codemp, codfor, sitreg: "A" },
      },
      select: { inicio: true, fim: true, atividade: { select: { codpro: true } } },
    }),
    prisma.ratItem.findMany({
      where: {
        codemp,
        horini: { not: null },
        horfim: { not: null },
        datati: { gte: de, lte: fimDoDia },
        rat: { codfor },
      },
      select: { datati: true, horini: true, horfim: true, codpro: true },
    }),
  ]);

  const porDia = new Map<string, number>();
  const porProjeto = new Map<number, number>();
  let totalMinutos = 0;

  function somar(dia: string, codpro: number | null, minutos: number) {
    if (minutos <= 0) return;
    porDia.set(dia, (porDia.get(dia) ?? 0) + minutos);
    if (codpro != null) porProjeto.set(codpro, (porProjeto.get(codpro) ?? 0) + minutos);
    totalMinutos += minutos;
  }

  for (const s of sessoes) {
    if (!s.fim) continue;
    const minutos = Math.round((s.fim.getTime() - s.inicio.getTime()) / 60000);
    somar(chaveDia(s.inicio), s.atividade.codpro, minutos);
  }
  for (const r of ratItens) {
    if (r.horini == null || r.horfim == null || !r.datati) continue;
    somar(chaveDia(r.datati), r.codpro, r.horfim - r.horini);
  }

  return { porDia, porProjeto, totalMinutos };
}

// Meta de minutos de um dia da semana, a partir da jornada cadastrada (JornadaConsultor) —
// manhã + tarde, cada uma só entra na conta se tiver início E fim preenchidos. Dia sem
// jornada cadastrada (fora do time, ou dia de folga fixo) devolve 0 — não é erro, é "sem
// meta pra hoje", e quem soma decide separado se isso conta como "sem meta cadastrada"
// (ver metaDoPeriodo abaixo).
function metaDoDiaSemana(jornada: { manhaInicio: number | null; manhaFim: number | null; tardeInicio: number | null; tardeFim: number | null } | undefined): number {
  if (!jornada) return 0;
  let minutos = 0;
  if (jornada.manhaInicio != null && jornada.manhaFim != null) minutos += Math.max(0, jornada.manhaFim - jornada.manhaInicio);
  if (jornada.tardeInicio != null && jornada.tardeFim != null) minutos += Math.max(0, jornada.tardeFim - jornada.tardeInicio);
  return minutos;
}

export interface MetaPeriodo {
  metaTotalMinutos: number;
  // Média só dos dias que TÊM jornada cadastrada (>0) — é o "Xh/dia" que o card mostra.
  // `null` quando NENHUM dia do período tem jornada (não faz sentido falar em meta/saldo).
  metaDiariaMinutos: number | null;
  diasComJornada: number;
}

// Soma a meta de cada dia de `de` até `ate` (inclusive), usando a jornada cadastrada do
// consultor por dia da semana (0=domingo...6=sábado, mesma convenção de Date.getUTCDay()).
export async function metaDoPeriodo(codemp: number, codfor: number, de: Date, ate: Date): Promise<MetaPeriodo> {
  const jornadas = await prisma.jornadaConsultor.findMany({ where: { codemp, codfor } });
  const porDiaSemana = new Map(jornadas.map((j) => [j.diaSemana, j]));

  let metaTotalMinutos = 0;
  let diasComJornada = 0;
  for (const diaStr of diasDoPeriodo(de, ate)) {
    const data = new Date(`${diaStr}T00:00:00Z`);
    const meta = metaDoDiaSemana(porDiaSemana.get(data.getUTCDay()));
    if (meta > 0) {
      metaTotalMinutos += meta;
      diasComJornada += 1;
    }
  }

  return {
    metaTotalMinutos,
    metaDiariaMinutos: diasComJornada > 0 ? Math.round(metaTotalMinutos / diasComJornada) : null,
    diasComJornada,
  };
}

export interface ValorHoraConsultor {
  vlrhor: number;
  numctr: number | null;
}

// Contrato de valor-hora vigente do consultor, se houver (ver ContratoConsultor —
// só ~1/4 do quadro tem contrato de valor-hora cadastrado no Senior hoje; a maioria não
// tem, e isso é normal, não erro). Quando o mesmo codfor tiver mais de uma linha com
// vlrhor preenchido (não observado no dado real em 17/08/2026, mas a view permite),
// pega a de maior `numctr` — critério simples até surgir um campo de vigência explícito.
export async function valorHoraVigente(codemp: number, codfor: number): Promise<ValorHoraConsultor | null> {
  const contratos = await prisma.contratoConsultor.findMany({
    where: { codemp, codfor, vlrhor: { not: null } },
    orderBy: { numctr: "desc" },
    take: 1,
  });
  const contrato = contratos[0];
  if (!contrato || contrato.vlrhor == null) return null;
  return { vlrhor: Number(contrato.vlrhor), numctr: contrato.numctr };
}
