import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { realizadoDasAtividades, tetoDaAtividade } from "./tetoAtividade";
import { CODCLI_EMPRESA_PROPRIA, SITPRO_ATIVIDADES_VISIVEIS } from "./propostasDominio";
import { SITRAT_CANCELADO } from "./ratDominio";
import { AlocacaoEntrada, PropostaEntrada } from "./eficienciaPropostas";

// Carregadores do Painel de Eficiência: tudo que vem do banco. A conta em si mora em
// eficienciaPropostas.ts (pura). Aqui só se decide QUAIS linhas entram e como o "executado" é lido.
//
// "Executado" do item = TODO RatItem do item por (codemp, codpro, seqite), menos RAT cancelada
// (sitrat=5), menos o que foi removido no Senior, mais as sessões fechadas ainda não confirmadas.
// É deliberadamente diferente do "realizado" da alocação (por seqati): o apontamento sem vínculo
// a alocação CONTA no item e aparece como "sem consultor alocado". A regra de teto da alocação
// (domain/tetoAtividade.ts) não muda — ver nota "realizado-alocacao-atribuir-horas-sem-seqati-PAUSADO".

export interface FiltrosEficiencia {
  // cli = propostas de clientes, int = internas (cliente da própria empresa), all = todas
  tipo: "cli" | "int" | "all";
  sitpro: number[]; // subconjunto de SITPRO_ATIVIDADES_VISIVEIS (4 Aprovada, 7 Em Execução)
  sispro: number[] | null;
  depexe: number[] | null; // filtro escolhido na tela; vale pro depexe da proposta OU de algum item
  // Uma proposta só (gaveta de detalhe): evita recalcular a carteira inteira pra abrir uma.
  proposta?: { codemp: number; codpro: number };
}

export interface EscopoEficiencia {
  // Departamentos que o usuário gerencia. null = admin (sem restrição).
  departamentos: number[] | null;
}

const ITENS_DOS_DEPARTAMENTOS = (deps: number[]) => Prisma.sql`(
  p.depexe = ANY(${deps}::int[])
  OR EXISTS (
    SELECT 1 FROM propostas_itens x
    WHERE x.codemp = p.codemp AND x.codpro = p.codpro AND x.removido_em_senior IS NULL AND x.depexe = ANY(${deps}::int[])
  )
)`;

// Mesmo escopo da tela de Alocação (routes/alocacao.ts, origemDaProposta): a proposta é do gestor
// se o depexe DELA ou o de algum item está entre os departamentos que ele gerencia.
function condicoesDePropostas(f: FiltrosEficiencia, esc: EscopoEficiencia): Prisma.Sql {
  const partes: Prisma.Sql[] = [
    Prisma.sql`p.removido_em_senior IS NULL`,
    Prisma.sql`p.sitpro = ANY(${f.sitpro.length > 0 ? f.sitpro : [...SITPRO_ATIVIDADES_VISIVEIS]}::int[])`,
  ];
  if (f.tipo === "cli") partes.push(Prisma.sql`p.codcli <> ${CODCLI_EMPRESA_PROPRIA}`);
  if (f.tipo === "int") partes.push(Prisma.sql`p.codcli = ${CODCLI_EMPRESA_PROPRIA}`);
  if (f.sispro && f.sispro.length > 0) partes.push(Prisma.sql`p.sispro = ANY(${f.sispro}::int[])`);
  if (f.depexe && f.depexe.length > 0) partes.push(ITENS_DOS_DEPARTAMENTOS(f.depexe));
  if (f.proposta) partes.push(Prisma.sql`p.codemp = ${f.proposta.codemp} AND p.codpro = ${f.proposta.codpro}`);
  if (esc.departamentos != null) {
    partes.push(esc.departamentos.length > 0 ? ITENS_DOS_DEPARTAMENTOS(esc.departamentos) : Prisma.sql`FALSE`);
  }
  return Prisma.join(partes, " AND ");
}

interface LinhaItem {
  codemp: number;
  codpro: number;
  codcli: number;
  cliente: string | null;
  sitpro: number | null;
  sispro: number | null;
  depexe_prop: number | null;
  seqite: number;
  desser: string | null;
  despro: string | null;
  qtdhor: number | null;
  valhor: number | null;
  fatser: string | null;
  depexe_item: number | null;
  exec_rat: number;
  exec_sessoes: number;
}

// RatItem válido pro "executado": RAT não cancelada, nada removido no Senior, e duração positiva
// (10 linhas no banco têm horfim <= horini; contá-las subtrairia horas).
const RAT_ITEM_VALIDO = Prisma.sql`
  ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL
  AND r.sitrat IS DISTINCT FROM ${SITRAT_CANCELADO}
  AND ri.horini IS NOT NULL AND ri.horfim > ri.horini`;

export interface DadosEficiencia {
  propostas: PropostaEntrada[];
  alocacoes: AlocacaoEntrada[];
  nomes: Map<number, string>;
  // Departamento do consultor (rótulo do cadastro do Senior), pra mostrar ao lado do nome.
  departamentos: Map<number, string>;
}

export async function carregarDados(f: FiltrosEficiencia, esc: EscopoEficiencia): Promise<DadosEficiencia> {
  const cond = condicoesDePropostas(f, esc);

  const [linhas, alocRows] = await Promise.all([
    prisma.$queryRaw<LinhaItem[]>`
      SELECT p.codemp, p.codpro, p.codcli,
             COALESCE(NULLIF(TRIM(c.apecli), ''), c.nomcli) AS cliente,
             p.sitpro, p.sispro, p.depexe AS depexe_prop,
             pi.seqite, s.desser, pi.despro, pi.qtdhor, pi.valhor::float8 AS valhor, pi.fatser,
             pi.depexe AS depexe_item,
             COALESCE(rat.minutos, 0)::int AS exec_rat,
             COALESCE(ses.minutos, 0)::float8 AS exec_sessoes
      FROM propostas p
      JOIN propostas_itens pi ON pi.codemp = p.codemp AND pi.codpro = p.codpro AND pi.removido_em_senior IS NULL
      LEFT JOIN clientes c ON c.codcli = p.codcli
      LEFT JOIN servicos s ON s.codemp = pi.codemp AND s.codser = pi.codser
      LEFT JOIN (
        SELECT ri.codemp, ri.codpro, ri.seqite, SUM(ri.horfim - ri.horini) AS minutos
        FROM rat_itens ri JOIN rats r ON r.id = ri."ratId"
        WHERE ${RAT_ITEM_VALIDO}
        GROUP BY ri.codemp, ri.codpro, ri.seqite
      ) rat ON rat.codemp = pi.codemp AND rat.codpro = pi.codpro AND rat.seqite = pi.seqite
      LEFT JOIN (
        SELECT a.codemp, a.codpro, a.seqite, SUM(EXTRACT(EPOCH FROM (se.fim - se.inicio)) / 60) AS minutos
        FROM atividade_sessoes_execucao se JOIN atividades_consultor a ON a.id = se."atividadeId"
        WHERE se.confirmada = FALSE AND se.fim IS NOT NULL AND se."excluidaEm" IS NULL
          AND a.sitreg = 'A' AND a.removido_em_senior IS NULL
        GROUP BY a.codemp, a.codpro, a.seqite
      ) ses ON ses.codemp = pi.codemp AND ses.codpro = pi.codpro AND ses.seqite = pi.seqite
      WHERE ${cond}
      ORDER BY p.codpro, pi.seqite
    `,
    prisma.$queryRaw<
      { id: number; seqati: bigint | null; codemp: number; codpro: number; seqite: number; codfor: number; qtdhor: number | null; excedentes: number }[]
    >`
      SELECT a.id, a.seqati, a.codemp, a.codpro, a.seqite, a.codfor, a.qtdhor, a."horasExcedentes" AS excedentes
      FROM atividades_consultor a
      JOIN propostas p ON p.codemp = a.codemp AND p.codpro = a.codpro
      JOIN propostas_itens pi ON pi.codemp = a.codemp AND pi.codpro = a.codpro AND pi.seqite = a.seqite AND pi.removido_em_senior IS NULL
      WHERE a.sitreg = 'A' AND a.removido_em_senior IS NULL AND ${cond}
    `,
  ]);

  const porProposta = new Map<string, PropostaEntrada>();
  for (const l of linhas) {
    const chave = `${l.codemp}-${l.codpro}`;
    let p = porProposta.get(chave);
    if (!p) {
      p = {
        codemp: l.codemp,
        codpro: l.codpro,
        codcli: l.codcli,
        cliente: l.cliente ?? `Cliente ${l.codcli}`,
        sitpro: l.sitpro,
        sispro: l.sispro,
        depexe: l.depexe_prop,
        interna: l.codcli === CODCLI_EMPRESA_PROPRIA,
        itens: [],
      };
      porProposta.set(chave, p);
    }
    p.itens.push({
      codemp: l.codemp,
      codpro: l.codpro,
      seqite: l.seqite,
      descricao: (l.despro ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
      servico: l.desser,
      depexe: l.depexe_item,
      fatser: l.fatser,
      vendido: l.qtdhor ?? 0,
      valhor: l.valhor,
      executado: l.exec_rat + Math.round(l.exec_sessoes),
    });
  }

  // Executado de cada consultor = o MESMO "realizado" do teto da alocação (por seqati + sessões
  // não confirmadas). Nunca uma segunda definição: o painel e o bloqueio de teto têm que concordar.
  const realizado = await realizadoDasAtividades(alocRows.map((a) => ({ id: a.id, seqati: a.seqati })));
  const alocacoes: AlocacaoEntrada[] = alocRows.map((a) => ({
    codemp: a.codemp,
    codpro: a.codpro,
    seqite: a.seqite,
    codfor: a.codfor,
    alocado: tetoDaAtividade({ qtdhor: a.qtdhor, horasExcedentes: a.excedentes }),
    executado: realizado.get(a.id) ?? 0,
  }));

  const codfors = [...new Set(alocacoes.map((a) => a.codfor))];
  const consultores = codfors.length
    ? await prisma.consultor.findMany({ where: { codfor: { in: codfors } }, select: { codfor: true, nomcom: true, nomfor: true, depexedes: true } })
    : [];
  const nomes = new Map<number, string>();
  const departamentos = new Map<number, string>();
  for (const c of consultores) {
    if (c.codfor == null || nomes.has(c.codfor)) continue;
    nomes.set(c.codfor, c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`);
    if (c.depexedes) departamentos.set(c.codfor, c.depexedes);
  }

  return { propostas: [...porProposta.values()], alocacoes, nomes, departamentos };
}

export interface PontoTendencia {
  mes: string; // "2026-09"
  total: number; // minutos executados no mês
  dentro: number; // parte que coube no vendido do item (acumulado do item em ordem de data)
}

// Quando o estouro aconteceu: cada apontamento do mês é "dentro" ou "acima" conforme o acumulado do
// item ATÉ aquele apontamento (ordem datati, horini). Só RatItem — as sessões ainda não confirmadas
// (poucas) não têm a data do apontamento definitiva.
export async function carregarTendencia(f: FiltrosEficiencia, esc: EscopoEficiencia, meses = 12): Promise<PontoTendencia[]> {
  const cond = condicoesDePropostas(f, esc);
  const linhas = await prisma.$queryRaw<{ mes: string; total: number; dentro: number }[]>`
    WITH base AS (
      SELECT ri.datati,
             (ri.horfim - ri.horini) AS minutos,
             pi.qtdhor AS vendido,
             SUM(ri.horfim - ri.horini) OVER (
               PARTITION BY ri.codemp, ri.codpro, ri.seqite ORDER BY ri.datati, ri.horini, ri.id
             ) AS acum
      FROM rat_itens ri
      JOIN rats r ON r.id = ri."ratId"
      JOIN propostas p ON p.codemp = ri.codemp AND p.codpro = ri.codpro
      JOIN propostas_itens pi ON pi.codemp = ri.codemp AND pi.codpro = ri.codpro AND pi.seqite = ri.seqite AND pi.removido_em_senior IS NULL
      WHERE ${RAT_ITEM_VALIDO} AND ri.datati IS NOT NULL AND ${cond}
    )
    SELECT to_char(date_trunc('month', datati), 'YYYY-MM') AS mes,
           SUM(minutos)::int AS total,
           SUM(GREATEST(0, LEAST(minutos, COALESCE(vendido, 0) - (acum - minutos))))::int AS dentro
    FROM base
    WHERE datati >= (date_trunc('month', CURRENT_DATE) - make_interval(months => ${meses - 1}::int))::date
    GROUP BY 1 ORDER BY 1
  `;
  return linhas;
}

// Apontamento dos últimos 12 meses que NÃO casa com nenhum item de proposta (sem codpro, seqite
// vazio/0, ou item inexistente). Não dá pra atribuir a escopo nenhum, então só o admin vê.
export async function carregarApontadoSemItem(): Promise<{ apontamentos: number; minutos: number }> {
  const [r] = await prisma.$queryRaw<{ apontamentos: number; minutos: number }[]>`
    SELECT COUNT(*)::int AS apontamentos, COALESCE(SUM(ri.horfim - ri.horini), 0)::int AS minutos
    FROM rat_itens ri JOIN rats r ON r.id = ri."ratId"
    WHERE ${RAT_ITEM_VALIDO}
      AND ri.datati >= CURRENT_DATE - INTERVAL '12 months' AND ri.datati <= CURRENT_DATE
      AND (
        ri.codpro IS NULL OR ri.seqite IS NULL OR ri.seqite = 0
        OR NOT EXISTS (
          SELECT 1 FROM propostas_itens x WHERE x.codemp = ri.codemp AND x.codpro = ri.codpro AND x.seqite = ri.seqite
        )
      )
  `;
  return r ?? { apontamentos: 0, minutos: 0 };
}

// Departamentos que aparecem como opção de filtro: os do próprio escopo.
export async function carregarDepartamentosDoEscopo(esc: EscopoEficiencia): Promise<number[]> {
  if (esc.departamentos != null) return [...esc.departamentos].sort((a, b) => a - b);
  const linhas = await prisma.$queryRaw<{ depexe: number }[]>`
    SELECT DISTINCT p.depexe FROM propostas p
    WHERE p.removido_em_senior IS NULL AND p.sitpro = ANY(${[...SITPRO_ATIVIDADES_VISIVEIS]}::int[]) AND p.depexe IS NOT NULL
    ORDER BY 1
  `;
  return linhas.map((l) => l.depexe);
}
