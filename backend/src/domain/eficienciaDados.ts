import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { realizadoDasAtividades, tetoDaAtividade } from "./tetoAtividade";
import { CODCLI_EMPRESA_PROPRIA, SITPRO_ATIVIDADES_VISIVEIS } from "./propostasDominio";
import { SITRAT_CANCELADO } from "./ratDominio";
import { AlocacaoEntrada, ModoEstouro, PropostaEntrada } from "./eficienciaPropostas";
import { descontarExcluido } from "./eficienciaExclusoes";

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
  modpro: number[] | null; // modalidade da proposta (USU_ModPro: Serviço, Levantamento, DRM)
  codcli: number[] | null; // cliente(s) escolhidos na tela
  codpro?: number[] | null; // proposta(s) escolhidas na tela (PS)
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
  if (f.modpro && f.modpro.length > 0) partes.push(Prisma.sql`p.modpro = ANY(${f.modpro}::int[])`);
  if (f.codcli && f.codcli.length > 0) partes.push(Prisma.sql`p.codcli = ANY(${f.codcli}::int[])`);
  if (f.codpro && f.codpro.length > 0) partes.push(Prisma.sql`p.codpro = ANY(${f.codpro}::int[])`);
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
  modpro: number | null;
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
//
// ATENÇÃO: repete em SQL as regras de `filtroRatItemRealizado` (domain/ratDominio.ts, a versão Prisma usada pelo
// teto, pela Alocação e pela Home). Se uma mudar, mude a outra.
const RAT_ITEM_VALIDO = Prisma.sql`
  ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL
  AND r.sitrat IS DISTINCT FROM ${SITRAT_CANCELADO}
  AND ri.horini IS NOT NULL AND ri.horfim > ri.horini`;

// O que o PAINEL conta: o apontamento válido acima, menos os que um gestor tirou do cálculo (exclusão ATIVA, sem
// restauração). A exclusão vale só aqui (ver domain/eficienciaExclusoes.ts); o apontamento-sem-item e o realizado das
// alocações usam o válido puro.
const RAT_ITEM_CONTA_NO_PAINEL = Prisma.sql`${RAT_ITEM_VALIDO}
  AND NOT EXISTS (
    SELECT 1 FROM eficiencia_apontamentos_excluidos ex WHERE ex."ratItemId" = ri.id AND ex."restauradoEm" IS NULL
  )`;

// Horas de um consultor num item (o que sai do executado quando a pessoa ignora o consultor numa proposta).
export interface ExecucaoDoConsultor {
  codemp: number;
  codpro: number;
  seqite: number;
  codfor: number;
  minutos: number;
}

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
             p.sitpro, p.modpro, p.depexe AS depexe_prop,
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
        WHERE ${RAT_ITEM_CONTA_NO_PAINEL}
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
        modpro: l.modpro,
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
  // Esse realizado é compartilhado e NÃO conhece a exclusão do painel. Descontamos aqui o que um gestor tirou do
  // cálculo (por seqati), pra a eficiência/carga do consultor concordarem com o executado do item.
  const excluidoPorSeqati = await minutosExcluidosPorSeqati();
  const alocacoes: AlocacaoEntrada[] = alocRows.map((a) => ({
    codemp: a.codemp,
    codpro: a.codpro,
    seqite: a.seqite,
    codfor: a.codfor,
    alocado: tetoDaAtividade({ qtdhor: a.qtdhor, horasExcedentes: a.excedentes }),
    executado: descontarExcluido(realizado.get(a.id) ?? 0, a.seqati != null ? excluidoPorSeqati.get(a.seqati) ?? 0 : 0),
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

// Minutos que cada atividade (seqati) tem em apontamentos EXCLUÍDOS do cálculo do painel. Só conta o que o realizado
// compartilhado também contaria (RatItem válido): se a RAT foi cancelada depois da exclusão, o realizado já não somava
// aquele apontamento e descontar de novo faria a conta sair menor que a real.
async function minutosExcluidosPorSeqati(): Promise<Map<bigint, number>> {
  const linhas = await prisma.$queryRaw<{ seqati: bigint; minutos: number }[]>`
    SELECT ri.seqati, SUM(ri.horfim - ri.horini)::int AS minutos
    FROM eficiencia_apontamentos_excluidos ex
    JOIN rat_itens ri ON ri.id = ex."ratItemId"
    JOIN rats r ON r.id = ri."ratId"
    WHERE ex."restauradoEm" IS NULL AND ri.seqati > 0 AND ${RAT_ITEM_VALIDO}
    GROUP BY ri.seqati
  `;
  return new Map(linhas.map((l) => [l.seqati, l.minutos]));
}

// Horas por (item, consultor) de algumas propostas: RatItem que conta no painel (mesma regra do executado do item) por `rats.codfor`,
// mais as sessões encerradas e não confirmadas por `atividades_consultor.codfor`. A soma de todos os consultores de um item bate com o
// executado do item (a diferença, no máximo, é o arredondamento das sessões). É de onde sai a lista da aba Consultores da gaveta e o
// quanto cada consultor ignorado tira do executado.
export async function carregarExecucaoPorConsultor(propostas: { codemp: number; codpro: number }[]): Promise<ExecucaoDoConsultor[]> {
  if (propostas.length === 0) return [];
  const pares = Prisma.join(propostas.map((x) => Prisma.sql`(${x.codemp}, ${x.codpro})`));
  const [rat, sessoes] = await Promise.all([
    prisma.$queryRaw<{ codemp: number; codpro: number; seqite: number; codfor: number | null; minutos: number }[]>`
      SELECT ri.codemp, ri.codpro, ri.seqite, r.codfor, SUM(ri.horfim - ri.horini)::int AS minutos
      FROM rat_itens ri JOIN rats r ON r.id = ri."ratId"
      WHERE ${RAT_ITEM_CONTA_NO_PAINEL} AND (ri.codemp, ri.codpro) IN (${pares})
      GROUP BY ri.codemp, ri.codpro, ri.seqite, r.codfor
    `,
    prisma.$queryRaw<{ codemp: number; codpro: number; seqite: number; codfor: number; minutos: number }[]>`
      SELECT a.codemp, a.codpro, a.seqite, a.codfor, SUM(EXTRACT(EPOCH FROM (se.fim - se.inicio)) / 60)::float8 AS minutos
      FROM atividade_sessoes_execucao se JOIN atividades_consultor a ON a.id = se."atividadeId"
      WHERE se.confirmada = FALSE AND se.fim IS NOT NULL AND se."excluidaEm" IS NULL
        AND a.sitreg = 'A' AND a.removido_em_senior IS NULL AND (a.codemp, a.codpro) IN (${pares})
      GROUP BY a.codemp, a.codpro, a.seqite, a.codfor
    `,
  ]);
  const soma = new Map<string, ExecucaoDoConsultor>();
  const somar = (codemp: number, codpro: number, seqite: number, codfor: number | null, minutos: number) => {
    if (codfor == null || !(minutos > 0)) return;
    const k = `${codemp}-${codpro}-${seqite}-${codfor}`;
    const atual = soma.get(k);
    if (atual) atual.minutos += minutos;
    else soma.set(k, { codemp, codpro, seqite, codfor, minutos });
  };
  for (const r of rat) somar(r.codemp, r.codpro, r.seqite, r.codfor, r.minutos);
  for (const s of sessoes) somar(s.codemp, s.codpro, s.seqite, s.codfor, Math.round(s.minutos));
  return [...soma.values()];
}

export interface ExclusaoAtiva {
  id: number;
  ratItemId: number;
  codemp: number;
  codpro: number;
  seqite: number;
  cliente: string | null;
  item: string | null;
  codfor: number | null;
  minutos: number;
  motivo: string;
  observacao: string | null;
  excluidoPor: number;
  excluidoEm: Date;
  depexeItem: number | null;
  depexeProposta: number | null;
}

// Exclusões ATIVAS e EFETIVAS no recorte atual (mesmos filtros e escopo do painel): só entram as de apontamento que
// ainda é válido (RAT não cancelada etc.), porque é isso que de fato está fora da conta. Minutos = duração atual.
export async function carregarExclusoesAtivas(f: FiltrosEficiencia, esc: EscopoEficiencia): Promise<ExclusaoAtiva[]> {
  const cond = condicoesDePropostas(f, esc);
  return prisma.$queryRaw<ExclusaoAtiva[]>`
    SELECT ex.id, ex."ratItemId", ex.codemp, ex.codpro, ex.seqite,
           COALESCE(NULLIF(TRIM(c.apecli), ''), c.nomcli) AS cliente,
           LEFT(pi.despro, 160) AS item, r.codfor, (ri.horfim - ri.horini)::int AS minutos,
           ex.motivo, ex.observacao, ex."excluidoPor", ex."excluidoEm",
           pi.depexe AS "depexeItem", p.depexe AS "depexeProposta"
    FROM eficiencia_apontamentos_excluidos ex
    JOIN rat_itens ri ON ri.id = ex."ratItemId"
    JOIN rats r ON r.id = ri."ratId"
    JOIN propostas p ON p.codemp = ex.codemp AND p.codpro = ex.codpro
    JOIN propostas_itens pi ON pi.codemp = ex.codemp AND pi.codpro = ex.codpro AND pi.seqite = ex.seqite AND pi.removido_em_senior IS NULL
    LEFT JOIN clientes c ON c.codcli = p.codcli
    WHERE ex."restauradoEm" IS NULL AND ${RAT_ITEM_VALIDO} AND ${cond}
    ORDER BY ex."excluidoEm" DESC
  `;
}

export interface ApontamentoDoItem {
  id: number;
  data: Date | null;
  horini: number | null;
  horfim: number | null;
  descricao: string | null;
  numrat: number | null;
  codfor: number | null;
  exclusaoId: number | null;
  motivo: string | null;
  observacao: string | null;
  excluidoPor: number | null;
  excluidoEm: Date | null;
}

const LIMITE_APONTAMENTOS_DO_ITEM = 300;

// Os apontamentos válidos de UM item (mais recentes primeiro), com a situação de exclusão de cada um — é a lista de
// onde o gestor escolhe o que tirar do cálculo. Itens grandes têm milhares de linhas: devolve as 300 mais recentes e
// o total, e a tela avisa que está truncado.
export async function carregarApontamentosDoItem(
  codemp: number,
  codpro: number,
  seqite: number
): Promise<{ linhas: ApontamentoDoItem[]; total: number; minutosTotal: number }> {
  const [linhas, [tot]] = await Promise.all([
    prisma.$queryRaw<ApontamentoDoItem[]>`
      SELECT ri.id, ri.datati AS data, ri.horini, ri.horfim, LEFT(ri.desati, 300) AS descricao, ri.numrat, r.codfor,
             ex.id AS "exclusaoId", ex.motivo, ex.observacao, ex."excluidoPor", ex."excluidoEm"
      FROM rat_itens ri
      JOIN rats r ON r.id = ri."ratId"
      LEFT JOIN eficiencia_apontamentos_excluidos ex ON ex."ratItemId" = ri.id AND ex."restauradoEm" IS NULL
      WHERE ${RAT_ITEM_VALIDO} AND ri.codemp = ${codemp} AND ri.codpro = ${codpro} AND ri.seqite = ${seqite}
      ORDER BY ri.datati DESC NULLS LAST, ri.horini DESC NULLS LAST, ri.id DESC
      LIMIT ${LIMITE_APONTAMENTOS_DO_ITEM}
    `,
    prisma.$queryRaw<{ total: number; minutos: number }[]>`
      SELECT COUNT(*)::int AS total, COALESCE(SUM(ri.horfim - ri.horini), 0)::int AS minutos
      FROM rat_itens ri JOIN rats r ON r.id = ri."ratId"
      WHERE ${RAT_ITEM_VALIDO} AND ri.codemp = ${codemp} AND ri.codpro = ${codpro} AND ri.seqite = ${seqite}
    `,
  ]);
  return { linhas, total: tot?.total ?? 0, minutosTotal: tot?.minutos ?? 0 };
}

export interface PontoTendencia {
  mes: string; // "2026-09"
  total: number; // minutos executados no mês
  dentro: number; // parte que coube no vendido do item (acumulado do item em ordem de data)
}

// Quando o estouro aconteceu: cada apontamento do mês é "dentro" ou "acima" conforme o acumulado do
// item ATÉ aquele apontamento (ordem datati, horini). Só RatItem — as sessões ainda não confirmadas
// (poucas) não têm a data do apontamento definitiva.
//
// `excluirPropostas`: propostas que o usuário mandou ocultar (atípicas). A tendência é SQL e não passa
// pelo cálculo em memória, então precisa receber o mesmo recorte pra não divergir do resto da tela.
export async function carregarTendencia(
  f: FiltrosEficiencia,
  esc: EscopoEficiencia,
  meses = 12,
  excluirPropostas: { codemp: number; codpro: number }[] = [],
  // Itens e consultores (numa proposta) que a pessoa ignorou: a tendência é SQL e precisa do mesmo recorte do resto da tela.
  excluirNaProposta: { itens: { codemp: number; codpro: number; seqite: number }[]; consultores: { codemp: number; codpro: number; codfor: number }[] } = { itens: [], consultores: [] },
  // "proposta": o acumulado corre pela PROPOSTA inteira contra o vendido TOTAL dela (mesma leitura do estouro global); "item" (padrão)
  // corre item a item.
  modo: ModoEstouro = "item"
): Promise<PontoTendencia[]> {
  const cond = condicoesDePropostas(f, esc);
  const semOcultas =
    excluirPropostas.length > 0
      ? Prisma.sql`(p.codemp, p.codpro) NOT IN (${Prisma.join(excluirPropostas.map((x) => Prisma.sql`(${x.codemp}, ${x.codpro})`))})`
      : Prisma.sql`TRUE`;
  const semItensIgnorados =
    excluirNaProposta.itens.length > 0
      ? Prisma.sql`(ri.codemp, ri.codpro, ri.seqite) NOT IN (${Prisma.join(excluirNaProposta.itens.map((x) => Prisma.sql`(${x.codemp}, ${x.codpro}, ${x.seqite})`))})`
      : Prisma.sql`TRUE`;
  // COALESCE: apontamento sem consultor (codfor nulo) tem que continuar contando; `NOT IN` com NULL descartaria a linha.
  const semConsultoresIgnorados =
    excluirNaProposta.consultores.length > 0
      ? Prisma.sql`(ri.codemp, ri.codpro, COALESCE(r.codfor, -1)) NOT IN (${Prisma.join(excluirNaProposta.consultores.map((x) => Prisma.sql`(${x.codemp}, ${x.codpro}, ${x.codfor})`))})`
      : Prisma.sql`TRUE`;
  // Vendido total da proposta (modo "proposta"): soma dos itens vivos, menos os que a pessoa ignorou (eles saíram do cálculo todo).
  const itensIgnoradosNoVendido =
    excluirNaProposta.itens.length > 0
      ? Prisma.sql`AND (x.codemp, x.codpro, x.seqite) NOT IN (${Prisma.join(excluirNaProposta.itens.map((i) => Prisma.sql`(${i.codemp}, ${i.codpro}, ${i.seqite})`))})`
      : Prisma.sql``;
  const vendidoDaLinha =
    modo === "proposta"
      ? Prisma.sql`(SELECT COALESCE(SUM(x.qtdhor), 0) FROM propostas_itens x WHERE x.codemp = ri.codemp AND x.codpro = ri.codpro AND x.removido_em_senior IS NULL ${itensIgnoradosNoVendido})`
      : Prisma.sql`pi.qtdhor`;
  const particao = modo === "proposta" ? Prisma.sql`ri.codemp, ri.codpro` : Prisma.sql`ri.codemp, ri.codpro, ri.seqite`;
  const linhas = await prisma.$queryRaw<{ mes: string; total: number; dentro: number }[]>`
    WITH base AS (
      SELECT ri.datati,
             (ri.horfim - ri.horini) AS minutos,
             ${vendidoDaLinha} AS vendido,
             SUM(ri.horfim - ri.horini) OVER (
               PARTITION BY ${particao} ORDER BY ri.datati, ri.horini, ri.id
             ) AS acum
      FROM rat_itens ri
      JOIN rats r ON r.id = ri."ratId"
      JOIN propostas p ON p.codemp = ri.codemp AND p.codpro = ri.codpro
      JOIN propostas_itens pi ON pi.codemp = ri.codemp AND pi.codpro = ri.codpro AND pi.seqite = ri.seqite AND pi.removido_em_senior IS NULL
      WHERE ${RAT_ITEM_CONTA_NO_PAINEL} AND ri.datati IS NOT NULL AND ${cond} AND ${semOcultas} AND ${semItensIgnorados} AND ${semConsultoresIgnorados}
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

// Clientes que aparecem como opção do filtro: os que têm proposta ativa DENTRO do escopo do usuário (o gestor só vê os
// clientes das propostas que já enxerga). Só propostas com ao menos um item, como o resto do painel.
export async function carregarClientesDoEscopo(esc: EscopoEficiencia): Promise<{ codcli: number; nome: string }[]> {
  const cond = condicoesDePropostas({ tipo: "all", sitpro: [], modpro: null, codcli: null, depexe: null }, esc);
  return prisma.$queryRaw<{ codcli: number; nome: string }[]>`
    SELECT DISTINCT p.codcli, COALESCE(NULLIF(TRIM(c.apecli), ''), c.nomcli, 'Cliente ' || p.codcli) AS nome
    FROM propostas p
    LEFT JOIN clientes c ON c.codcli = p.codcli
    WHERE ${cond}
      AND EXISTS (SELECT 1 FROM propostas_itens pi WHERE pi.codemp = p.codemp AND pi.codpro = p.codpro AND pi.removido_em_senior IS NULL)
    ORDER BY nome
  `;
}

// Propostas que aparecem como opção do filtro de proposta: as ativas do escopo do usuário, com cliente (a tela filtra por cliente/tipo).
export async function carregarPropostasDoEscopo(esc: EscopoEficiencia): Promise<{ codemp: number; codpro: number; codcli: number; cliente: string }[]> {
  const cond = condicoesDePropostas({ tipo: "all", sitpro: [], modpro: null, codcli: null, depexe: null }, esc);
  return prisma.$queryRaw<{ codemp: number; codpro: number; codcli: number; cliente: string }[]>`
    SELECT p.codemp, p.codpro, p.codcli, COALESCE(NULLIF(TRIM(c.apecli), ''), c.nomcli, 'Cliente ' || p.codcli) AS cliente
    FROM propostas p
    LEFT JOIN clientes c ON c.codcli = p.codcli
    WHERE ${cond}
      AND EXISTS (SELECT 1 FROM propostas_itens pi WHERE pi.codemp = p.codemp AND pi.codpro = p.codpro AND pi.removido_em_senior IS NULL)
    ORDER BY p.codpro DESC
  `;
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
