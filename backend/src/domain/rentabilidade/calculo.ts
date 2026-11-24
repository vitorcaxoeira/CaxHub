// Cálculo dos indicadores da Rentabilidade por centro de custo (17/11/2026): lê a configuração (indicadores e contas), busca o movimento
// no banco com a MESMA regra de sinal do Resultado Analítico (FORMULA_VALOR_REALIZADO) e entrega a tabela CC × indicador. A parte de
// conta/fórmula é pura e testada em ./indicadores.ts; aqui só entra o acesso ao banco.
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { FORMULA_VALOR_REALIZADO, SITRAT_CONTABILIZADO } from "../contabilDominio";
import type { No } from "../../formulas/formula";
import {
  calcularIndicadores,
  ordenarGrupos,
  rotuloGrupo,
  contasEmMaisDeUm,
  contasSelecionadas,
  contasSemIndicador,
  classificarOrigem,
  type ContaDoPlano,
  type FonteSistema,
  type FormatoIndicador,
  type IndicadorConfigurado,
  type ValoresLinha,
} from "./indicadores";

export interface Recorte {
  /** Primeiro dia (YYYY-MM-DD) */
  inicio: string;
  /** Primeiro dia DEPOIS do período (YYYY-MM-DD), exclusivo */
  fim: string;
  /** Setor = descrição paralela da conta (`despar`); nulo = todos */
  setor: string | null;
  /** Centros de custo analíticos; nulo = todos */
  ccs: string[] | null;
  /**
   * Restringe às contas e CCs que existem nos modelos de plano da empresa (E043PCM, `modelo_planos`). É o que o BI faz com o INNER JOIN da
   * `Fato`: conta ou CC fora do modelo some do relatório.
   */
  restringirModelo: boolean;
  /**
   * Grupo = Conta Paralela da conta (`despar`, a mesma da Matriz). Nulo/indefinido = todos; "" = contas SEM grupo. Com grupo, o cálculo sai só do
   * movimento daquele grupo, e as colunas de sistema (horas) ficam só nos CCs que têm movimento nele (a aba Por Grupo, 24/11/2026).
   */
  grupo?: string | null;
}

export interface LinhaResultado {
  codccu: string;
  desccu: string;
  valores: ValoresLinha;
}

export interface ResultadoRentabilidade {
  colunas: { codigo: string; rotulo: string; formato: FormatoIndicador; /** O valor desta coluna abre a origem (lançamentos). */ origem?: boolean }[];
  linhas: LinhaResultado[];
  total: ValoresLinha;
  avisos: string[];
}

type MovimentoConta = { codemp: number; ctared: number; codccu: string; debcre: string | null; valor: number };

/** Indicadores gravados, na ordem da tela, como o cálculo espera. */
export async function carregarIndicadores(): Promise<IndicadorConfigurado[]> {
  const linhas = await prisma.rentabilidadeIndicador.findMany({ include: { contas: true }, orderBy: [{ ordem: "asc" }, { id: "asc" }] });
  return linhas.map((l) => ({
    id: l.id,
    codigo: l.codigo,
    rotulo: l.rotulo,
    tipo: l.tipo as IndicadorConfigurado["tipo"],
    base: l.base as IndicadorConfigurado["base"],
    natureza: l.natureza as IndicadorConfigurado["natureza"],
    formato: l.formato as IndicadorConfigurado["formato"],
    formulaTexto: l.formulaTexto,
    formulaArvore: (l.formulaArvore as unknown as No | null) ?? null,
    fonte: (l.fonte as FonteSistema | null) ?? null,
    ordem: l.ordem,
    visivel: l.visivel,
    contas: l.contas.map((c) => ({ codemp: c.codemp, ctared: c.ctared, acao: c.acao as "incluir" | "excluir" })),
  }));
}

export async function carregarPlano(): Promise<ContaDoPlano[]> {
  const contas = await prisma.planoContabil.findMany({ select: { codemp: true, ctared: true, paiCtared: true, anasin: true } });
  return contas;
}

export function filtrosComuns(alias: "r" | "o", recorte: Recorte): Prisma.Sql {
  const a = Prisma.raw(alias);
  const partes: Prisma.Sql[] = [];
  if (recorte.setor) partes.push(Prisma.sql`AND btrim(COALESCE(pc.despar, '')) = ${recorte.setor}`);
  if (recorte.grupo != null) partes.push(Prisma.sql`AND btrim(COALESCE(pc.despar, '')) = ${recorte.grupo}`);
  if (recorte.ccs && recorte.ccs.length) partes.push(Prisma.sql`AND ${a}.codccu = ANY(${recorte.ccs}::text[])`);
  if (recorte.restringirModelo) {
    partes.push(Prisma.sql`AND EXISTS (SELECT 1 FROM empresa e JOIN modelo_planos m ON m.codmpc = e.codmpc AND m.ctared = ${a}.ctared WHERE e.codemp = ${a}.codemp)`);
    partes.push(Prisma.sql`AND EXISTS (SELECT 1 FROM empresa e JOIN modelo_planos m ON m.codmpc = e.codmpu AND m.ctared::text = ${a}.codccu WHERE e.codemp = ${a}.codemp)`);
  }
  return partes.length ? Prisma.join(partes, " ") : Prisma.empty;
}

/** Realizado por (conta, CC, lado), com o sinal do Resultado Analítico. Só contas analíticas e CCs analíticos, como a `Fato` do BI. */
export async function movimentoRealizado(recorte: Recorte): Promise<MovimentoConta[]> {
  return prisma.$queryRaw<MovimentoConta[]>`
    SELECT r.codemp, r.ctared, r.codccu, r.debcre, SUM(${Prisma.raw(FORMULA_VALOR_REALIZADO)})::float8 AS valor
    FROM rateios_lancamento r
    JOIN lancamentos_contabeis l ON l.codemp = r.codemp AND l.numlct = r.numlct
    JOIN plano_contabil pc ON pc.codemp = r.codemp AND pc.ctared = r.ctared
    JOIN centros_custo cc ON cc.codemp = r.codemp AND cc.codccu = r.codccu
    WHERE r.sitrat = ${SITRAT_CONTABILIZADO} AND l.sitlct = ${SITRAT_CONTABILIZADO}
      AND r.removido_em_senior IS NULL AND l.removido_em_senior IS NULL
      AND pc.anasin = 'A' AND cc.anasin = 'A'
      AND r.datlct >= ${recorte.inicio}::date AND r.datlct < ${recorte.fim}::date
      ${filtrosComuns("r", recorte)}
    GROUP BY r.codemp, r.ctared, r.codccu, r.debcre`;
}

/** Orçado por (conta, CC): `-vlrrat`, o sinal normalizado para a convenção do realizado (ver comentário em routes/contabil.ts). */
export async function movimentoOrcado(recorte: Recorte): Promise<MovimentoConta[]> {
  return prisma.$queryRaw<MovimentoConta[]>`
    SELECT o.codemp, o.ctared, o.codccu, NULL::text AS debcre, SUM(-o.vlrrat)::float8 AS valor
    FROM orcamentos_contabeis o
    JOIN plano_contabil pc ON pc.codemp = o.codemp AND pc.ctared = o.ctared
    JOIN centros_custo cc ON cc.codemp = o.codemp AND cc.codccu = o.codccu
    WHERE o.removido_em_senior IS NULL AND pc.anasin = 'A' AND cc.anasin = 'A'
      AND o.mesano >= ${recorte.inicio}::date AND o.mesano < ${recorte.fim}::date
      ${filtrosComuns("o", recorte)}
    GROUP BY o.codemp, o.ctared, o.codccu`;
}

/** Horas apontadas no Kyria por CC: o CC é o do cliente do ticket (clientes.codccu, do E085RAT). */
async function horasKyriaPorCc(recorte: Recorte): Promise<Map<string, number>> {
  const linhas = await prisma.$queryRaw<{ codccu: string; horas: number }[]>`
    SELECT cl.codccu AS codccu, (SUM(e.minutes) / 60.0)::float8 AS horas
    FROM kyria_time_entries e
    JOIN kyria_tickets t ON t.id = e.ticket_id
    JOIN kyria_customers kc ON kc.id = t.customer_id
    JOIN clientes cl ON cl.codcli = kc.codcli
    WHERE e.started_at >= ${recorte.inicio}::date AND e.started_at < ${recorte.fim}::date AND cl.codccu IS NOT NULL
    GROUP BY cl.codccu`;
  return new Map(linhas.map((l) => [l.codccu, l.horas]));
}

/** Horas de RAT por CC: o CC é o do projeto (projetos.codccu, da E615PRJ). RAT cancelada e linha removida do Senior ficam fora. */
async function horasRatPorCc(recorte: Recorte): Promise<Map<string, number>> {
  const linhas = await prisma.$queryRaw<{ codccu: string; horas: number }[]>`
    SELECT p.codccu AS codccu, (SUM(i.horfim - i.horini) / 60.0)::float8 AS horas
    FROM rat_itens i
    JOIN rats r ON r.id = i."ratId" AND r.sitrat IS DISTINCT FROM 5
    JOIN projetos p ON p.codemp = r.codemp AND p.numprj = r.numprj
    WHERE i.datati >= ${recorte.inicio}::date AND i.datati < ${recorte.fim}::date AND i.horfim > i.horini
      AND i.removido_em_senior IS NULL AND p.codccu IS NOT NULL
    GROUP BY p.codccu`;
  return new Map(linhas.map((l) => [l.codccu, l.horas]));
}

interface CustoPorCc {
  custo: Map<string, number>;
  /** Horas que ficaram de fora do custo: sem consultor vinculado ou sem custo-hora no mês da hora. */
  horasSemCusto: number;
}

/**
 * Custo real das horas do Kyria por CC (18/11/2026): cada apontamento vale minutos ÷ 60 × o custo-hora do consultor (kyria_members.codusu →
 * consultor_custo_hora) NO MÊS do apontamento (dia de Brasília). Mesmos filtros de período e CC de `horasKyriaPorCc`.
 */
async function custoKyriaPorCc(recorte: Recorte): Promise<CustoPorCc> {
  const linhas = await prisma.$queryRaw<{ codccu: string; custo: number; sem_custo: number }[]>`
    SELECT cl.codccu AS codccu,
           COALESCE(SUM((e.minutes / 60.0) * cch.custo_hora), 0)::float8 AS custo,
           COALESCE(SUM(e.minutes / 60.0) FILTER (WHERE cch.custo_hora IS NULL), 0)::float8 AS sem_custo
    FROM kyria_time_entries e
    JOIN kyria_tickets t ON t.id = e.ticket_id
    JOIN kyria_customers kc ON kc.id = t.customer_id
    JOIN clientes cl ON cl.codcli = kc.codcli
    LEFT JOIN kyria_members m ON m.id = e.user_id
    LEFT JOIN consultor_custo_hora cch ON cch.codusu = m.codusu AND cch.competencia = date_trunc('month', e.started_at AT TIME ZONE 'America/Sao_Paulo')::date
    WHERE e.started_at >= ${recorte.inicio}::date AND e.started_at < ${recorte.fim}::date AND cl.codccu IS NOT NULL
    GROUP BY cl.codccu`;
  return { custo: new Map(linhas.map((l) => [l.codccu, l.custo])), horasSemCusto: linhas.reduce((s, l) => s + l.sem_custo, 0) };
}

/**
 * Custo real das horas de RAT por CC: horas do item × o custo-hora do consultor executor (rats.codfor → consultores) no mês da atividade. Quando o
 * fornecedor tem dois cadastros de consultor, vale o de menor código que tenha custo no mês.
 */
async function custoRatPorCc(recorte: Recorte): Promise<CustoPorCc> {
  const linhas = await prisma.$queryRaw<{ codccu: string; custo: number; sem_custo: number }[]>`
    SELECT p.codccu AS codccu,
           COALESCE(SUM(((i.horfim - i.horini) / 60.0) * cc.custo_hora), 0)::float8 AS custo,
           COALESCE(SUM((i.horfim - i.horini) / 60.0) FILTER (WHERE cc.custo_hora IS NULL), 0)::float8 AS sem_custo
    FROM rat_itens i
    JOIN rats r ON r.id = i."ratId" AND r.sitrat IS DISTINCT FROM 5
    JOIN projetos p ON p.codemp = r.codemp AND p.numprj = r.numprj
    LEFT JOIN LATERAL (
      SELECT cch.custo_hora FROM consultores co
      JOIN consultor_custo_hora cch ON cch.codemp = co.codemp AND cch.codusu = co.codusu AND cch.competencia = date_trunc('month', i.datati)::date
      WHERE co.codemp = r.codemp AND co.codfor = r.codfor ORDER BY co.codusu LIMIT 1
    ) cc ON true
    WHERE i.datati >= ${recorte.inicio}::date AND i.datati < ${recorte.fim}::date AND i.horfim > i.horini
      AND i.removido_em_senior IS NULL AND p.codccu IS NOT NULL
    GROUP BY p.codccu`;
  return { custo: new Map(linhas.map((l) => [l.codccu, l.custo])), horasSemCusto: linhas.reduce((s, l) => s + l.sem_custo, 0) };
}

function somarMapas(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const saida = new Map(a);
  for (const [cc, v] of b) saida.set(cc, (saida.get(cc) ?? 0) + v);
  return saida;
}

function somarPorCc(movimento: MovimentoConta[], selecionadas: Set<string>, natureza: IndicadorConfigurado["natureza"]): Map<string, number> {
  const saida = new Map<string, number>();
  for (const m of movimento) {
    if (!selecionadas.has(`${m.codemp}:${m.ctared}`)) continue;
    if (natureza === "debito" && m.debcre !== "D") continue;
    if (natureza === "credito" && m.debcre !== "C") continue;
    saida.set(m.codccu, (saida.get(m.codccu) ?? 0) + m.valor);
  }
  return saida;
}

export async function calcularRentabilidade(recorte: Recorte, indicadores?: IndicadorConfigurado[]): Promise<ResultadoRentabilidade> {
  const config = indicadores ?? (await carregarIndicadores());
  const avisos: string[] = [];
  if (config.length === 0) return { colunas: [], linhas: [], total: {}, avisos: ["Nenhum indicador configurado. Cadastre ou importe a configuração em Administração › Indicadores de Rentabilidade."] };

  const plano = await carregarPlano();
  const precisaRealizado = config.some((i) => i.tipo === "contas" && i.base === "realizado");
  const precisaOrcado = config.some((i) => i.tipo === "contas" && i.base === "orcado");
  const [realizado, orcado] = await Promise.all([precisaRealizado ? movimentoRealizado(recorte) : [], precisaOrcado ? movimentoOrcado(recorte) : []]);

  const bases = new Map<string, Map<string, number>>();
  for (const i of config) {
    if (i.tipo === "contas") {
      const selecionadas = contasSelecionadas(i.contas, plano);
      if (selecionadas.size === 0) avisos.push(`${i.rotulo} (${i.codigo}) não seleciona nenhuma conta analítica.`);
      bases.set(i.codigo, somarPorCc(i.base === "orcado" ? orcado : realizado, selecionadas, i.natureza));
    }
  }
  const sistema = config.filter((i) => i.tipo === "sistema");
  if (sistema.length) {
    const usa = (...fontes: string[]) => sistema.some((i) => fontes.includes(i.fonte ?? ""));
    const vazio: CustoPorCc = { custo: new Map<string, number>(), horasSemCusto: 0 };
    const [kyria, rat, custoKyria, custoRat] = await Promise.all([
      usa("HorasKyria") ? horasKyriaPorCc(recorte) : new Map<string, number>(),
      usa("HorasRat") ? horasRatPorCc(recorte) : new Map<string, number>(),
      usa("CustoKyria", "CustoReal") ? custoKyriaPorCc(recorte) : vazio,
      usa("CustoRat", "CustoReal") ? custoRatPorCc(recorte) : vazio,
    ]);
    const basePorFonte: Record<string, Map<string, number>> = {
      HorasKyria: kyria,
      HorasRat: rat,
      CustoKyria: custoKyria.custo,
      CustoRat: custoRat.custo,
      CustoReal: somarMapas(custoKyria.custo, custoRat.custo),
    };
    for (const i of sistema) {
      const base = basePorFonte[i.fonte ?? ""] ?? new Map<string, number>();
      bases.set(i.codigo, recorte.ccs?.length ? new Map([...base].filter(([cc]) => recorte.ccs!.includes(cc))) : base);
    }
    const semCusto = (usa("CustoKyria", "CustoReal") ? custoKyria.horasSemCusto : 0) + (usa("CustoRat", "CustoReal") ? custoRat.horasSemCusto : 0);
    if (semCusto >= 0.05) {
      avisos.push(`${semCusto.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h do período ficaram fora do custo real: consultor sem vínculo (Kyria/RAT) ou sem custo-hora no mês (Administração › Custo-hora real).`);
    }
    if (recorte.setor) avisos.push("As horas do sistema (Kyria e RAT) ainda não filtram por setor: aparecem inteiras mesmo com um setor escolhido.");
  }

  // Com grupo: as horas do sistema só nos CCs que têm movimento em conta DAQUELE grupo (senão um CC sem lançamento no grupo entraria com horas).
  if (recorte.grupo != null) {
    const ccsDoGrupo = new Set<string>();
    for (const i of config) if (i.tipo === "contas") for (const [cc, v] of bases.get(i.codigo) ?? []) if (Math.abs(v) >= 0.005) ccsDoGrupo.add(cc);
    for (const i of config) if (i.tipo === "sistema") bases.set(i.codigo, new Map([...(bases.get(i.codigo) ?? [])].filter(([cc]) => ccsDoGrupo.has(cc))));
  }

  // Linhas = CCs com algum valor diferente de zero em indicador de conta ou de sistema.
  const comValor = new Set<string>();
  for (const base of bases.values()) for (const [cc, v] of base) if (Math.abs(v) >= 0.005) comValor.add(cc);
  const codigosCc = [...comValor].sort();
  const centros = codigosCc.length ? await prisma.centroCusto.findMany({ where: { codccu: { in: codigosCc } }, select: { codccu: true, desccu: true } }) : [];
  const descricao = new Map(centros.map((c) => [c.codccu, c.desccu]));

  const { porLinha, total } = calcularIndicadores(config, bases, codigosCc);
  const visiveis = config.filter((i) => i.visivel);
  return {
    colunas: visiveis.map((i) => ({ codigo: i.codigo, rotulo: i.rotulo, formato: i.formato, origem: classificarOrigem(i.codigo, config) !== null })),
    linhas: codigosCc.map((cc) => ({ codccu: cc, desccu: descricao.get(cc) ?? "", valores: porLinha.get(cc)! })),
    total,
    avisos,
  };
}

/** Grupos (Conta Paralela; "" = sem grupo) com lançamento contabilizado no recorte, sem ordem. */
export async function gruposComMovimento(recorte: Recorte): Promise<string[]> {
  const linhas = await prisma.$queryRaw<{ grupo: string }[]>`
    SELECT DISTINCT btrim(COALESCE(pc.despar, '')) AS grupo
    FROM rateios_lancamento r
    JOIN lancamentos_contabeis l ON l.codemp = r.codemp AND l.numlct = r.numlct
    JOIN plano_contabil pc ON pc.codemp = r.codemp AND pc.ctared = r.ctared
    JOIN centros_custo cc ON cc.codemp = r.codemp AND cc.codccu = r.codccu
    WHERE r.sitrat = ${SITRAT_CONTABILIZADO} AND l.sitlct = ${SITRAT_CONTABILIZADO}
      AND r.removido_em_senior IS NULL AND l.removido_em_senior IS NULL
      AND pc.anasin = 'A' AND cc.anasin = 'A'
      AND r.datlct >= ${recorte.inicio}::date AND r.datlct < ${recorte.fim}::date
      ${filtrosComuns("r", { ...recorte, grupo: undefined })}`;
  return linhas.map((l) => l.grupo);
}

export interface GrupoResultado {
  /** Conta Paralela ("" = sem grupo). */
  grupo: string;
  rotulo: string;
  total: ValoresLinha;
  linhas: LinhaResultado[];
}

export interface ResultadoPorGrupo {
  colunas: ResultadoRentabilidade["colunas"];
  grupos: GrupoResultado[];
  /** O total do recorte (o mesmo de calcularRentabilidade sem grupo). */
  total: ValoresLinha;
  avisos: string[];
}

/**
 * A aba Por Grupo (24/11/2026): o cálculo de CADA grupo com movimento (ordem de `ordenarGrupos`), mais o total do recorte. Cada grupo soma só as contas dele;
 * o mesmo CC aparece em cada grupo em que tem movimento. Grupos sem linha são omitidos.
 */
export async function calcularRentabilidadePorGrupo(recorte: Recorte, indicadores?: IndicadorConfigurado[]): Promise<ResultadoPorGrupo> {
  const config = indicadores ?? (await carregarIndicadores());
  const geral = await calcularRentabilidade({ ...recorte, grupo: undefined }, config);
  const grupos: GrupoResultado[] = [];
  for (const g of ordenarGrupos(await gruposComMovimento(recorte))) {
    const r = await calcularRentabilidade({ ...recorte, grupo: g }, config);
    if (r.linhas.length === 0) continue;
    grupos.push({ grupo: g, rotulo: rotuloGrupo(g), total: r.total, linhas: r.linhas });
  }
  return { colunas: geral.colunas, grupos, total: geral.total, avisos: geral.avisos };
}

export interface Diagnostico {
  semIndicador: { codemp: number; ctared: number; clacta: string; descta: string; valor: number }[];
  emMaisDeUm: { codemp: number; ctared: number; clacta: string; descta: string; indicadores: string[] }[];
}

/** O que o BI não avisa: conta com movimento que nenhum indicador de soma pega, e conta pega por mais de um indicador de soma. */
export async function diagnosticarContas(recorte: Recorte): Promise<Diagnostico> {
  const config = (await carregarIndicadores()).filter((i) => i.tipo === "contas");
  const plano = await carregarPlano();
  const movimento = await movimentoRealizado(recorte);
  const porConta = new Map<string, number>();
  for (const m of movimento) porConta.set(`${m.codemp}:${m.ctared}`, (porConta.get(`${m.codemp}:${m.ctared}`) ?? 0) + m.valor);
  const comMovimento = [...porConta.entries()].filter(([, v]) => Math.abs(v) >= 0.005).map(([k]) => k);

  // Indicadores com EXATAMENTE as mesmas contas (ex.: Pessoal e as variantes só débito / só crédito dele) são variações do mesmo indicador, não
  // sobreposição: contam como um grupo só. Sobreposição de verdade é a mesma conta em seleções DIFERENTES.
  const grupos = new Map<string, { codigos: string[]; contas: Set<string> }>();
  for (const i of config) {
    const contas = contasSelecionadas(i.contas, plano);
    const assinatura = [...contas].sort().join(",");
    const g = grupos.get(assinatura);
    if (g) g.codigos.push(i.codigo);
    else grupos.set(assinatura, { codigos: [i.codigo], contas });
  }
  const selecionadas = new Map([...grupos.values()].map((g) => [g.codigos.join(" / "), g.contas]));
  const sem = contasSemIndicador(comMovimento, selecionadas);
  const dup = contasEmMaisDeUm(selecionadas);

  const chaves = [...new Set([...sem, ...dup.map((d) => d.conta)])];
  const dados = chaves.length
    ? await prisma.planoContabil.findMany({ where: { OR: chaves.map((k) => ({ codemp: Number(k.split(":")[0]), ctared: Number(k.split(":")[1]) })) }, select: { codemp: true, ctared: true, clacta: true, descta: true } })
    : [];
  const info = new Map(dados.map((d) => [`${d.codemp}:${d.ctared}`, d]));
  const base = (k: string) => ({ codemp: Number(k.split(":")[0]), ctared: Number(k.split(":")[1]), clacta: info.get(k)?.clacta ?? "", descta: info.get(k)?.descta ?? "" });
  return {
    semIndicador: sem.map((k) => ({ ...base(k), valor: Math.round((porConta.get(k) ?? 0) * 100) / 100 })).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
    emMaisDeUm: dup.map((d) => ({ ...base(d.conta), indicadores: d.indicadores })),
  };
}
