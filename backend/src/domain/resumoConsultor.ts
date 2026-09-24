import { prisma } from "../db/prisma";
import { SITRAT_CANCELADO, sitratLabel } from "./ratDominio";
import { tipdesLabel } from "./rdvDominio";

// Agregações do dashboard inicial do consultor (Home) — separadas da rota (routes/
// dashboard.ts) porque a conta de "horas realizadas num período" é a mesma definição usada
// em domain/tetoAtividade.ts (realizadoDaAtividade), só que aqui somada por DIA/PROJETO em
// vez de por atividade: sessão de execução fechada e NÃO confirmada (confirmada=false,
// fim preenchido, não excluída) + duração de RatItem já confirmado/sincronizado, EXCETO o
// de uma RAT cancelada (sitrat=5) — RAT cancelada não é trabalho realizado, mesmo com
// horini/horfim preenchidos. Nunca sessão e RatItem ao mesmo tempo pra mesma hora (ver
// comentário de realizadoDaAtividade).

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
        rat: { codfor, sitrat: { not: SITRAT_CANCELADO } },
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

// ---------- RDV do consultor (card "RDV · Despesas de viagem" da Home, 23/09/2026) ----------
//
// O dinheiro de despesa de viagem passa por duas etapas até o consultor receber:
//   1. Enquanto a RAT está Digitada (9) ou Fechada (1), o RDV só existe na USU_TE777RDV.
//   2. Quando a RAT é aprovada, o Senior gera um título a pagar (E501TCP, codtpt='10') pro
//      fornecedor do consultor. Aberto (sittit='AB') = ainda a receber.
// A RAT aprovada sai do passo 1 e o título entra no passo 2, então as duas somas não contam
// o mesmo dinheiro duas vezes.
const SITRAT_RDV_PENDENTE = [9, 1];

// Tipo de título (E501TCP.codtpt) do reembolso de RDV. O espelho titulos_pagar traz a E501TCP
// inteira (Contas a Pagar no padrão do Atlas), então é ESTA constante que recorta o que é RDV
// — nunca confie em "a tabela só tem RDV". Fornecedor é global no Senior, então não há filtro
// por empresa: o codfor do consultor já identifica de quem é o título.
export const CODTPT_RDV = "10";

export interface ItemRdvEmRat {
  id: number;
  numrat: number;
  sitrat: number | null;
  sitratLabel: string;
  datemiRat: string | null;
  datemi: string | null;
  desrdv: string | null;
  tipdesLabel: string;
  qtdrdv: number | null;
  vlrunt: number;
  vlrtot: number;
}

export interface ItemTituloRdv {
  codemp: number;
  codfil: number;
  numtit: string;
  datemi: string;
  vctpro: string;
  vlrori: number;
  vlrabe: number;
  obstcp: string | null;
}

export interface GrupoRdv<T> {
  total: number;
  itens: T[];
}

export interface RdvConsultor {
  rdvEmRat: GrupoRdv<ItemRdvEmRat>;
  titulos: {
    vencidos: GrupoRdv<ItemTituloRdv>;
    esteMes: GrupoRdv<ItemTituloRdv>;
    proximosMeses: GrupoRdv<ItemTituloRdv>;
  };
}

function dataIso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function somar<T>(itens: T[], valor: (item: T) => number): GrupoRdv<T> {
  // Arredonda em centavos: somar Decimal convertido em float acumula resíduo (0.1+0.2).
  return { total: Math.round(itens.reduce((soma, item) => soma + valor(item), 0) * 100) / 100, itens };
}

// `periodos` = os combos ano/mês do filtro da página (já em UTC, `ate` inclusivo), aplicados
// na data de emissão da RAT. Os títulos NÃO usam o filtro: vencido/este mês/próximos meses é
// sempre relativo a `hoje`.
export async function rdvDoConsultor(
  codemp: number,
  codfor: number,
  periodos: { de: Date; ate: Date }[],
  hoje: Date
): Promise<RdvConsultor> {
  const rats = await prisma.rat.findMany({
    where: {
      codemp,
      codfor,
      sitrat: { in: SITRAT_RDV_PENDENTE },
      numrat: { not: null },
      removidoEmSenior: null,
      OR: periodos.map(({ de, ate }) => ({ datemi: { gte: de, lte: ate } })),
    },
    select: { numrat: true, sitrat: true, datemi: true },
  });
  const ratPorNumrat = new Map(rats.map((r) => [r.numrat!, r]));

  // RDV liga na RAT só por valor (codemp+numrat), sem relação no Prisma — daí as 2 consultas.
  const despesas =
    ratPorNumrat.size === 0
      ? []
      : await prisma.registroDespesaViagem.findMany({
          where: { codemp, numrat: { in: [...ratPorNumrat.keys()] }, excluidaEm: null, removidoEmSenior: null },
          orderBy: [{ numrat: "asc" }, { datemi: "asc" }, { id: "asc" }],
        });

  // Number() já aqui na serialização: Decimal do Prisma vira string em JSON e a soma no
  // consumidor concatenaria texto (ver decimal-prisma-serializa-como-string).
  const itensRdv: ItemRdvEmRat[] = despesas.map((d) => {
    const rat = ratPorNumrat.get(d.numrat);
    return {
      id: d.id,
      numrat: d.numrat,
      sitrat: rat?.sitrat ?? null,
      sitratLabel: sitratLabel(rat?.sitrat ?? null),
      datemiRat: dataIso(rat?.datemi ?? null),
      datemi: dataIso(d.datemi),
      desrdv: d.desrdv,
      tipdesLabel: tipdesLabel(d.tipdes),
      qtdrdv: d.qtdrdv,
      vlrunt: Number(d.vlrunt ?? 0),
      vlrtot: Number(d.vlrtot ?? 0),
    };
  });

  const titulos = await prisma.tituloPagar.findMany({
    where: { codfor, codtpt: CODTPT_RDV, sittit: "AB", removidoEmSenior: null },
    orderBy: [{ vctpro: "asc" }, { numtit: "asc" }],
  });

  const hojeUtc = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  const fimDoMes = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0);
  const vencidos: ItemTituloRdv[] = [];
  const esteMes: ItemTituloRdv[] = [];
  const proximosMeses: ItemTituloRdv[] = [];
  for (const t of titulos) {
    const item: ItemTituloRdv = {
      codemp: t.codemp,
      codfil: t.codfil,
      numtit: t.numtit,
      datemi: dataIso(t.datemi)!,
      vctpro: dataIso(t.vctpro)!,
      vlrori: Number(t.vlrori),
      // Valor em aberto é o que falta receber; vlrabe nulo só em título sem baixa nenhuma.
      vlrabe: Number(t.vlrabe ?? t.vlrori),
      obstcp: t.obstcp,
    };
    const vencimento = t.vctpro.getTime();
    if (vencimento < hojeUtc) vencidos.push(item);
    else if (vencimento <= fimDoMes) esteMes.push(item);
    else proximosMeses.push(item);
  }

  const valorAberto = (t: ItemTituloRdv) => t.vlrabe;
  return {
    rdvEmRat: somar(itensRdv, (d) => d.vlrtot),
    titulos: {
      vencidos: somar(vencidos, valorAberto),
      esteMes: somar(esteMes, valorAberto),
      proximosMeses: somar(proximosMeses, valorAberto),
    },
  };
}
