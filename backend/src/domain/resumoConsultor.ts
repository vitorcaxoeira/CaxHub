import { prisma } from "../db/prisma";
import { diaBrasilComoData, inicioDoDiaBrasil } from "./fusoBrasil";
import { SITRAT_CANCELADO, filtroRatItemRealizado, sitratLabel } from "./ratDominio";
import { TIPDES_DESLOCAMENTO_ROTA, tipdesLabel } from "./rdvDominio";
import { type ContratoFixo, contratoFixoDe } from "./contratoFixo";
import { type AusenciaDia, type ContextoDia, chaveDia, diasDoPeriodo, metaDoDia } from "./calendarioTrabalho";

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

// `chaveDia` e `diasDoPeriodo` moraram aqui; agora vêm de calendarioTrabalho.ts (funções puras do calendário) e `diasDoPeriodo` segue exportado daqui.
export { diasDoPeriodo };

// Horas realizadas de um consultor num período, já agrupadas por dia e por projeto (codpro).
// `ate` é tratado como fim do dia (23:59:59.999) pra incluir o dia inteiro. Sessão ainda não confirmada: o dia é o de BRASÍLIA do início
// (mesma regra da confirmação, que grava RatItem.datati com diaBrasilComoData), e o recorte do período olha o início entre o começo do
// dia `de` e o começo do dia seguinte a `ate`, também em Brasília (05/11/2026: antes era UTC e o trabalho das 21h às 24h caía no dia seguinte).
export async function horasRealizadasNoPeriodo(
  codemp: number,
  codfor: number,
  de: Date,
  ate: Date
): Promise<{ porDia: Map<string, number>; porProjeto: Map<number, number>; totalMinutos: number }> {
  const fimDoDia = new Date(ate);
  fimDoDia.setUTCHours(23, 59, 59, 999);
  const inicioDoPeriodo = inicioDoDiaBrasil(de);
  const fimDoPeriodo = inicioDoDiaBrasil(new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate() + 1)));

  const [sessoes, ratItens] = await Promise.all([
    prisma.atividadeSessaoExecucao.findMany({
      where: {
        confirmada: false,
        fim: { not: null },
        inicio: { gte: inicioDoPeriodo, lt: fimDoPeriodo },
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
        ...filtroRatItemRealizado({ codfor }),
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
    somar(chaveDia(diaBrasilComoData(s.inicio)), s.atividade.codpro, minutos);
  }
  for (const r of ratItens) {
    if (r.horini == null || r.horfim == null || !r.datati) continue;
    somar(chaveDia(r.datati), r.codpro, r.horfim - r.horini);
  }

  return { porDia, porProjeto, totalMinutos };
}

export interface MetaPeriodo {
  // Meta que vale: a da jornada menos o que as férias e as folgas do calendário abonam (13/11/2026).
  metaTotalMinutos: number;
  // Média só dos dias que TÊM meta (>0) depois dos abonos — é o "Xh/dia" que o card mostra.
  // `null` quando NENHUM dia do período tem jornada cadastrada (não faz sentido falar em meta/saldo).
  metaDiariaMinutos: number | null;
  // Dias com jornada CADASTRADA (antes dos abonos): é o que decide "meta configurada ou não". Férias não tiram a jornada.
  diasComJornada: number;
  // Dias que ainda têm meta depois dos abonos.
  diasComMeta: number;
  // Quanto da meta foi abonado: férias (gozos lançados pelo gestor) e folgas (lançadas pelo consultor no calendário).
  abonadoFeriasMinutos: number;
  abonadoFolgaMinutos: number;
}

// Férias e folgas do consultor num período, já por dia (calendário de trabalho, 13/11/2026). `feriasDias` = dias dentro de um gozo não cancelado;
// `ausenciasPorDia` = folgas não excluídas (dia inteiro ou parcial).
export interface AbonosDoPeriodo {
  feriasDias: Set<string>;
  ausenciasPorDia: Map<string, AusenciaDia[]>;
}

export const SEM_ABONOS: AbonosDoPeriodo = { feriasDias: new Set(), ausenciasPorDia: new Map() };

export async function carregarAbonos(codemp: number, codfor: number, de: Date, ate: Date): Promise<AbonosDoPeriodo> {
  const ini = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate()));
  const fim = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate()));
  const [gozos, ausencias] = await Promise.all([
    prisma.feriasGozo.findMany({
      where: { situacao: { not: "cancelada" }, inicio: { lte: fim }, fim: { gte: ini }, aquisitivo: { codemp, codfor } },
      select: { inicio: true, fim: true },
    }),
    prisma.calendarioAusencia.findMany({
      where: { codemp, codfor, data: { gte: ini, lte: fim }, excluidaEm: null },
      select: { data: true, diaInteiro: true, inicioMin: true, fimMin: true },
    }),
  ]);
  const feriasDias = new Set<string>();
  for (const g of gozos) {
    for (const dia of diasDoPeriodo(g.inicio > ini ? g.inicio : ini, g.fim < fim ? g.fim : fim)) feriasDias.add(dia);
  }
  const ausenciasPorDia = new Map<string, AusenciaDia[]>();
  for (const a of ausencias) {
    const chave = chaveDia(a.data);
    ausenciasPorDia.set(chave, [...(ausenciasPorDia.get(chave) ?? []), { diaInteiro: a.diaInteiro, inicioMin: a.inicioMin, fimMin: a.fimMin }]);
  }
  return { feriasDias, ausenciasPorDia };
}

/** O que abona o dia `dia` (YYYY-MM-DD), no formato da regra pura. */
export const contextoDoDia = (abonos: AbonosDoPeriodo, dia: string): ContextoDia => ({
  ferias: abonos.feriasDias.has(dia),
  ausencias: abonos.ausenciasPorDia.get(dia) ?? [],
});

/** Dias INTEIROS abonados (férias ou folga de dia inteiro): não contam como dia útil na projeção de ganho. */
export function diasInteirosAbonados(abonos: AbonosDoPeriodo): Set<string> {
  const dias = new Set(abonos.feriasDias);
  for (const [dia, lista] of abonos.ausenciasPorDia) if (lista.some((a) => a.diaInteiro)) dias.add(dia);
  return dias;
}

// Soma a meta de cada dia de `de` até `ate` (inclusive), usando a jornada cadastrada do consultor por dia da semana (0=domingo...6=sábado, mesma
// convenção de Date.getUTCDay()) e descontando férias e folgas (domain/calendarioTrabalho.ts). `abonos` pode vir pronto (um período maior que
// cubra `de`..`ate`) para a rota não consultar duas vezes.
export async function metaDoPeriodo(codemp: number, codfor: number, de: Date, ate: Date, abonos?: AbonosDoPeriodo): Promise<MetaPeriodo> {
  const [jornadas, abonosDoPeriodo] = await Promise.all([
    prisma.jornadaConsultor.findMany({ where: { codemp, codfor } }),
    abonos ?? carregarAbonos(codemp, codfor, de, ate),
  ]);
  const porDiaSemana = new Map(jornadas.map((j) => [j.diaSemana, j]));

  let metaTotalMinutos = 0;
  let diasComJornada = 0;
  let diasComMeta = 0;
  let abonadoFeriasMinutos = 0;
  let abonadoFolgaMinutos = 0;
  for (const diaStr of diasDoPeriodo(de, ate)) {
    const data = new Date(`${diaStr}T00:00:00Z`);
    const meta = metaDoDia(porDiaSemana.get(data.getUTCDay()), contextoDoDia(abonosDoPeriodo, diaStr));
    if (meta.baseMinutos > 0) diasComJornada += 1;
    if (meta.metaMinutos > 0) {
      metaTotalMinutos += meta.metaMinutos;
      diasComMeta += 1;
    }
    abonadoFeriasMinutos += meta.abonadoFeriasMinutos;
    abonadoFolgaMinutos += meta.abonadoFolgaMinutos;
  }

  return {
    metaTotalMinutos,
    metaDiariaMinutos: diasComMeta > 0 ? Math.round(metaTotalMinutos / diasComMeta) : diasComJornada > 0 ? 0 : null,
    diasComJornada,
    diasComMeta,
    abonadoFeriasMinutos,
    abonadoFolgaMinutos,
  };
}

// Hora de deslocamento é paga pela metade do valor-hora do consultor (regra do Vitor,
// 05/10/2026). Fica aqui, e não no router, porque o "ganho até agora" e a projeção usam a mesma.
export const FATOR_HORA_DESLOCAMENTO = 0.5;

// Horas de deslocamento (RegistroDespesaViagem.hordes, minutos crus) de um consultor entre `de` e
// `ate`, datadas pelo dia da despesa (datemi) — o dia da viagem, como as horas usam a data do item
// da RAT. Só tipdes=7 (Deslocamento por Rota). Despesa excluída/removida no Senior e despesa de RAT
// cancelada não contam, igual ao resto do painel. RDV liga na RAT só por valor (codemp+numrat).
// Devolve as linhas (não o total) pra o chamador separar "até hoje" de "período inteiro". `numrat` vai junto
// pro relatório de produtividade citar de qual RAT veio cada deslocamento.
export async function deslocamentoNoPeriodo(
  codemp: number,
  codfor: number,
  de: Date,
  ate: Date
): Promise<{ data: Date; minutos: number; numrat: number }[]> {
  const despesas = await prisma.registroDespesaViagem.findMany({
    where: {
      codemp,
      tipdes: TIPDES_DESLOCAMENTO_ROTA,
      hordes: { gt: 0 },
      datemi: { gte: de, lte: ate },
      excluidaEm: null,
      removidoEmSenior: null,
    },
    select: { numrat: true, datemi: true, hordes: true },
  });
  if (despesas.length === 0) return [];

  const rats = await prisma.rat.findMany({
    where: {
      codemp,
      codfor,
      numrat: { in: [...new Set(despesas.map((d) => d.numrat))] },
      sitrat: { not: SITRAT_CANCELADO },
      removidoEmSenior: null,
    },
    select: { numrat: true },
  });
  const numratsDoConsultor = new Set(rats.map((r) => r.numrat));

  return despesas
    .filter((d) => d.datemi != null && numratsDoConsultor.has(d.numrat))
    .map((d) => ({ data: d.datemi!, minutos: d.hordes!, numrat: d.numrat }));
}

export interface ValorHoraConsultor {
  vlrhor: number;
  numctr: number | null;
  /** Contrato de VALOR FIXO (codmot 12 com qtdctr): a nota do mês é vlrhor × qtd. Null nos contratos por hora. Ver domain/contratoFixo.ts. */
  fixo: ContratoFixo | null;
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
  const vlrhor = Number(contrato.vlrhor);
  return { vlrhor, numctr: contrato.numctr, fixo: contratoFixoDe({ codmot: contrato.codmot, vlrhor, qtdctr: contrato.qtdctr == null ? null : Number(contrato.qtdctr) }) };
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
