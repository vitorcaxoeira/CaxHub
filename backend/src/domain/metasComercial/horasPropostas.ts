import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

// Horas de Serviços vendidas = regra do ERP entregue pelo Vitor em 19/10/2026 (USU_TE077PRO + USU_TE077ITE + E085CLI), lida do
// espelho local (propostas / propostas_itens / clientes):
//  - proposta Aprovada (4), Em Execução (7) ou Executada (8);
//  - mês = data de retorno da proposta (USU_DatRet);
//  - item com faturamento Normal (S) ou Antecipado (A);
//  - horas = USU_QtdHor, que o Senior guarda em MINUTOS (÷ 60).
// Conferido contra a planilha META 2026: os "ajustes avulsos" dela eram propostas da Jennifer (jun = 838 h exatas).
export const SITPRO_HORAS = [4, 7, 8];
export const FATSER_HORAS = ["S", "A"];

/** Horas vendidas no ano por representante (codrep → 12 meses; 0 = sem proposta no mês). */
export async function horasVendidasPorRepresentante(ano: number): Promise<Map<number, number[]>> {
  const linhas = await prisma.$queryRaw<{ codrep: number; mes: number; horas: number }[]>(Prisma.sql`
    SELECT p.codrep, EXTRACT(MONTH FROM p.datret)::int AS mes, (SUM(i.qtdhor) / 60.0)::float8 AS horas
    FROM propostas p
    JOIN propostas_itens i ON i.codemp = p.codemp AND i.codpro = p.codpro
    JOIN clientes c ON c.codcli = p.codcli
    WHERE p.sitpro IN (${Prisma.join(SITPRO_HORAS)})
      AND p.datret BETWEEN ${`${ano}-01-01`}::date AND ${`${ano}-12-31`}::date
      AND i.fatser IN (${Prisma.join(FATSER_HORAS)})
      AND p.removido_em_senior IS NULL AND i.removido_em_senior IS NULL AND c.removido_em_senior IS NULL
    GROUP BY p.codrep, EXTRACT(MONTH FROM p.datret)`);
  const porRep = new Map<number, number[]>();
  for (const l of linhas) {
    const meses = porRep.get(l.codrep) ?? new Array<number>(12).fill(0);
    meses[l.mes - 1] += Math.round(l.horas * 100) / 100;
    porRep.set(l.codrep, meses);
  }
  return porRep;
}

/**
 * Distribui as horas dos representantes entre as pessoas das metas: cada pessoa recebe as do representante dela; o que não tem
 * dono (representante sem pessoa ativa no ano) vai para a linha "Não atribuído". Devolve a série por participante (null = mês sem
 * horas) e o total da empresa.
 */
export function distribuirHoras(
  porRep: Map<number, number[]>,
  participantes: Array<{ id: number; codrep: number | null; naoAtribuido: boolean; ativo: boolean }>
): { porParticipante: Map<number, Array<number | null>>; total: Array<number | null> } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const somar = (a: number[], b: number[]) => a.map((v, i) => r2(v + (b[i] ?? 0)));
  const paraSerie = (m: number[]) => m.map((v) => (v ? v : null));
  const ativos = participantes.filter((p) => p.ativo);
  const dono = new Map<number, number>();
  for (const p of ativos) if (p.codrep != null && !p.naoAtribuido && !dono.has(p.codrep)) dono.set(p.codrep, p.id);

  const porParticipante = new Map<number, Array<number | null>>();
  let total = new Array<number>(12).fill(0);
  let semDono = new Array<number>(12).fill(0);
  for (const [codrep, meses] of porRep) {
    total = somar(total, meses);
    const pid = dono.get(codrep);
    if (pid == null) semDono = somar(semDono, meses);
    else porParticipante.set(pid, paraSerie(meses));
  }
  const na = ativos.find((p) => p.naoAtribuido);
  if (na) porParticipante.set(na.id, paraSerie(semDono));
  return { porParticipante, total: paraSerie(total) };
}

/** Mesma distribuição por representante, para qualquer realizado vendido por pessoa (horas das propostas, licenças dos pedidos). */
export const distribuirPorRepresentante = distribuirHoras;
