import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { chaveDia } from "./calendarioTrabalho";
import {
  HORAS_DIA_PADRAO,
  diasCorridosEntre,
  diasUteisDoPeriodo,
  diasUteisPadraoDoMes,
  feriadosUteisDoMes,
  mediaPctTrabalhado,
  mesesDaMedia,
  saldoDoAquisitivo,
  valorDasFerias,
  type SaldoDoAquisitivo,
} from "./feriasCalculo";
import { horasRealizadasNoPeriodo, valorHoraVigente } from "./resumoConsultor";

// Dados do controle de férias (13/11/2026): períodos aquisitivos com saldo e a simulação do valor de um gozo. As contas puras estão em feriasCalculo.ts.

const num = (v: Prisma.Decimal | number | null): number | null => (v == null ? null : Number(v));

export interface GozoDto {
  id: number;
  inicio: string;
  fim: string;
  diasCorridos: number;
  situacao: string;
  observacao: string | null;
  competenciaPagamento: string | null;
  diasUteis: number | null;
  horasDia: number | null;
  mediaPct: number | null;
  valorHora: number | null;
  horasFerias: number | null;
  valorFerias: number | null;
  /** A tabela dos meses da média gravada (com os dias úteis usados, inclusive os ajustados pelo gestor). Null em gozo sem valor. */
  mesesMedia: MesDaMediaGravado[] | null;
}

/** Um mês da média, como é gravado em `ferias_gozos.meses_media`. Gozos antigos não têm `diasUteis`/`feriados`/`naMedia` (ver rota do aviso). */
export interface MesDaMediaGravado {
  ano: number;
  mes: number;
  minutos: number;
  pct: number;
  diasUteisPadrao?: number;
  diasUteis?: number;
  feriados?: { data: string; nome: string }[];
  naMedia?: boolean;
}

export interface AquisitivoDto extends SaldoDoAquisitivo {
  id: number;
  codemp: number;
  codfor: number;
  inicio: string;
  fim: string;
  observacao: string | null;
  /** As férias do período são remuneradas (calcula valor) ou só marcam os dias (sem valor). */
  remunerado: boolean;
  gozos: GozoDto[];
}

type AquisitivoComGozos = Prisma.FeriasPeriodoAquisitivoGetPayload<{ include: { gozos: true } }>;

function paraDto(a: AquisitivoComGozos, folgasDescontadas: number): AquisitivoDto {
  const gozos = [...a.gozos].sort((x, y) => x.inicio.getTime() - y.inicio.getTime());
  return {
    id: a.id,
    codemp: a.codemp,
    codfor: a.codfor,
    inicio: chaveDia(a.inicio),
    fim: chaveDia(a.fim),
    observacao: a.observacao,
    remunerado: a.remunerado,
    ...saldoDoAquisitivo(a.diasDireito, gozos, folgasDescontadas),
    gozos: gozos.map((g) => ({
      id: g.id,
      inicio: chaveDia(g.inicio),
      fim: chaveDia(g.fim),
      diasCorridos: g.diasCorridos,
      situacao: g.situacao,
      observacao: g.observacao,
      competenciaPagamento: g.competenciaPagamento ? chaveDia(g.competenciaPagamento) : null,
      diasUteis: g.diasUteis,
      horasDia: num(g.horasDia),
      mediaPct: num(g.mediaPct),
      valorHora: num(g.valorHora),
      horasFerias: num(g.horasFerias),
      valorFerias: num(g.valorFerias),
      mesesMedia: Array.isArray(g.mesesMedia) ? (g.mesesMedia as unknown as MesDaMediaGravado[]) : null,
    })),
  };
}

/** Folgas de dia inteiro marcadas para descontar do saldo, por período aquisitivo. */
async function folgasDescontadasPorAquisitivo(aquisitivoIds: number[]): Promise<Map<number, number>> {
  if (aquisitivoIds.length === 0) return new Map();
  const linhas = await prisma.calendarioAusencia.groupBy({
    by: ["aquisitivoId"],
    where: { aquisitivoId: { in: aquisitivoIds }, descontaFerias: true, diaInteiro: true, excluidaEm: null },
    _count: { _all: true },
  });
  return new Map(linhas.map((l) => [l.aquisitivoId as number, l._count._all]));
}

/** Períodos aquisitivos de VÁRIOS consultores (mais novo primeiro), com gozos e saldo: duas consultas no total, não uma por consultor. */
export async function aquisitivosDosConsultores(codemp: number, codfors: number[]): Promise<Map<number, AquisitivoDto[]>> {
  const saida = new Map<number, AquisitivoDto[]>();
  if (codfors.length === 0) return saida;
  const aquisitivos = await prisma.feriasPeriodoAquisitivo.findMany({
    where: { codemp, codfor: { in: codfors } },
    include: { gozos: true },
    orderBy: [{ inicio: "desc" }, { id: "desc" }],
  });
  const folgas = await folgasDescontadasPorAquisitivo(aquisitivos.map((a) => a.id));
  for (const a of aquisitivos) saida.set(a.codfor, [...(saida.get(a.codfor) ?? []), paraDto(a, folgas.get(a.id) ?? 0)]);
  return saida;
}

export async function aquisitivosDoConsultor(codemp: number, codfor: number): Promise<AquisitivoDto[]> {
  return (await aquisitivosDosConsultores(codemp, [codfor])).get(codfor) ?? [];
}

/** O período aquisitivo que contém `data` (YYYY-MM-DD), se houver. */
export function aquisitivoDaData(aquisitivos: AquisitivoDto[], data: string): AquisitivoDto | undefined {
  return aquisitivos.find((a) => a.inicio <= data && data <= a.fim);
}

export interface SimulacaoFerias {
  inicio: string;
  fim: string;
  diasCorridos: number;
  diasUteis: number;
  horasDia: number;
  mediaPct: number;
  /**
   * Os 12 meses da média, com as horas, os dias úteis disponíveis (padrão ou ajustado), os feriados que tiram dia útil e o % de cada um. `naMedia` = entra na
   * conta (dias > 0). A tela mostra para o gestor conferir e ajustar os dias.
   */
  meses: MesDaMediaGravado[];
  valorHora: number | null;
  horasFerias: number;
  /** Null sem valor-hora (consultor sem contrato por hora): não há o que valorar. */
  valorFerias: number | null;
}

/**
 * Simula o valor das férias de um gozo (planilha "Simulação Férias PJs"): dias úteis x horas/dia x média do % trabalhado x valor-hora. A média usa os 12 meses
 * fechados antes do mês de início. `horasDia`, `mediaPct`, `valorHora` e `diasUteisMes` (chave YYYY-MM) podem ser informados (o gestor ajusta); sem eles valem
 * 8,5 h, a média calculada e o valor-hora do contrato, e os dias úteis de cada mês são os padrão (feriados nacionais descontados).
 */
export async function simularFerias(params: {
  codemp: number;
  codfor: number;
  inicio: Date;
  fim: Date;
  horasDia?: number | null;
  mediaPct?: number | null;
  valorHora?: number | null;
  diasUteisMes?: Record<string, number> | null;
}): Promise<SimulacaoFerias> {
  const { codemp, codfor, inicio, fim } = params;
  const horasDia = params.horasDia != null && params.horasDia > 0 ? params.horasDia : HORAS_DIA_PADRAO;

  // Horas por mês dos 12 meses antes do gozo. O primeiro mês com horas define o padrão de dias: antes dele o consultor ainda não trabalhava (0 dias).
  const janelaFim = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 0));
  const janelaInicio = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() - 12, 1));
  const { porDia } = await horasRealizadasNoPeriodo(codemp, codfor, janelaInicio, janelaFim);
  const minutosPorMes = new Map<string, number>();
  for (const [dia, minutos] of porDia) minutosPorMes.set(dia.slice(0, 7), (minutosPorMes.get(dia.slice(0, 7)) ?? 0) + minutos);
  const comHoras = [...minutosPorMes.entries()].filter(([, m]) => m > 0).map(([chave]) => chave).sort();
  const primeiro = comHoras[0] ? { ano: Number(comHoras[0].slice(0, 4)), mes: Number(comHoras[0].slice(5, 7)) } : null;
  const ajustes = params.diasUteisMes ?? {};
  const meses: Omit<MesDaMediaGravado, "pct">[] = mesesDaMedia(inicio).map((m) => {
    const chave = `${m.ano}-${String(m.mes).padStart(2, "0")}`;
    const minutos = minutosPorMes.get(chave) ?? 0;
    const diasUteisPadrao = diasUteisPadraoDoMes(m.ano, m.mes, primeiro);
    const diasUteis = ajustes[chave] ?? diasUteisPadrao;
    return { ano: m.ano, mes: m.mes, minutos, diasUteisPadrao, diasUteis, feriados: feriadosUteisDoMes(m.ano, m.mes), naMedia: diasUteis > 0 };
  });
  const mediaCalculada = mediaPctTrabalhado(
    meses.map((m) => ({ minutos: m.minutos, diasUteis: m.diasUteis ?? 0 })),
    horasDia,
  );
  const mediaPct = params.mediaPct != null && params.mediaPct >= 0 ? params.mediaPct : mediaCalculada;

  const valorHora = params.valorHora != null && params.valorHora >= 0 ? params.valorHora : ((await valorHoraVigente(codemp, codfor))?.vlrhor ?? null);
  const diasUteis = diasUteisDoPeriodo(inicio, fim);
  const { horasFerias, valorFerias } = valorDasFerias({ diasUteis, horasDia, mediaPct, valorHora: valorHora ?? 0 });

  return {
    inicio: chaveDia(inicio),
    fim: chaveDia(fim),
    diasCorridos: diasCorridosEntre(inicio, fim),
    diasUteis,
    horasDia,
    mediaPct: Math.round(mediaPct * 10000) / 10000,
    meses: meses.map((m) => {
      const dias = m.diasUteis ?? 0;
      const base = dias * horasDia;
      return { ...m, pct: base > 0 ? Math.round((m.minutos / 60 / base) * 10000) / 10000 : 0 };
    }),
    valorHora,
    horasFerias,
    valorFerias: valorHora == null ? null : valorFerias,
  };
}
