import { Prisma } from "@prisma/client";
import type { ExtrasDaConsulta, FonteCampos } from "../consultas/camposRelacionados";
import { rotuloSql } from "../consultas/rotuloSql";
import { RAT_ITEM_VALIDO } from "./eficienciaDados";
import { FATSER_FATURAVEL } from "./eficienciaPropostas";
import { CODCLI_EMPRESA_PROPRIA, DEPEXE_LABELS, FORFAT_LABELS, MODPRO_LABELS, SITPRO_LABELS } from "./propostasDominio";

// Lista mestre da tela Gestão Propostas (09/11/2026): uma linha por proposta, de TODAS as situações, com as horas e os valores que as RATs
// executaram. É a consulta interna de `registrarListaConsultavel` (routes/gestaoPropostas.ts): por fora entram filtro e ordem por coluna,
// página, resumo do rodapé, colunas calculadas e a exportação (Excel, impressão, PDF).
//
// HORAS saem em HORAS DECIMAIS (não em minutos como na Alocação): a lista exporta CSV/PDF e minuto cru no Excel não se lê (o irmão
// `projetos.ts /propostas` faz o mesmo). A lista filha de RATs (consultaRatsLista) continua em minutos.
//
// O QUE ENTRA EM "HORAS EM RAT": os apontamentos válidos (`RAT_ITEM_VALIDO`: sem RAT cancelada, nada removido no Senior, duração positiva).
// Por isso NÃO bate com o `totalMinutos` de /rats/lista, que soma tudo (só nas RATs ligadas a propostas são ~1.313 h de RAT cancelada, 139 h
// removidas e 10 linhas de duração não positiva, medido em 09/11/2026). Também NÃO desconta os apontamentos que um gestor tirou do cálculo do
// Painel de Eficiência (`RAT_ITEM_CONTA_NO_PAINEL`): hoje são 0, mas no dia em que houver, as duas telas divergem de propósito.
//
// FATURÁVEL = item da proposta com fatser S (Faturamento Normal) ou A (Antecipado) — `FATSER_FATURAVEL`, a mesma régua do Painel de Eficiência.
// Todo o resto (N, C, H, I, em branco, ou apontamento sem item de proposta casado) é NÃO faturável. As duas partes somam sempre o total em RAT.

/** RAT que impede "Finalizar" a proposta: Digitado (9) ou Fechado (1). Fonte única da regra (SQL da lista e rota da ação). */
export const SITRAT_BLOQUEIA_FINALIZAR = [9, 1] as const;

/**
 * "Propostas" (copiado da Eficiência, 09/11/2026): de clientes (todas menos as da própria empresa), internas (cliente = a própria empresa,
 * CODCLI_EMPRESA_PROPRIA) ou todas. A mesma regra de `condicoesDePropostas` em domain/eficienciaDados.ts.
 */
export type TipoProposta = "cli" | "int" | "all";

/** Filtros do topo da tela (todos são campos da própria proposta, nenhum depende de coluna pesada). */
export interface FiltrosGestaoPropostas {
  tipo: TipoProposta;
  /** `null` = sem recorte (todas as situações). */
  situacoes: number[] | null;
  depexes: number[] | null;
  modpros: number[] | null;
  /** Cliente, número da proposta, do projeto ou trecho da descrição. */
  busca: string;
}

export interface OpcoesGestaoPropostas {
  /**
   * Agregados de RAT calculados para o recorte INTEIRO de uma vez (hash), em vez de uma subconsulta por linha. Necessário quando a pessoa filtra,
   * ordena, resume ou lista valores de uma coluna pesada (ver `precisaCalcularConjunto`).
   */
  conjunto?: boolean;
  /** Campos extras de proposta/cliente que a pessoa ligou (consultas/camposRelacionados.ts). Sem eles a consulta é a de sempre. */
  extras?: ExtrasDaConsulta;
  /** As duas colunas em R$ só existem para quem pode ver valores de proposta: quem não pode nem recebe o número na resposta. */
  comValores?: boolean;
}

/**
 * Tabelas cujos campos a pessoa pode ligar como coluna (12/11/2026): a própria proposta (alias `p`) e o cliente (alias `c`), os dois já ligados
 * na consulta. `sencli` (senha do cliente no Senior) nunca é oferecido.
 */
export const FONTES_GESTAO_PROPOSTAS: FonteCampos[] = [
  { id: "proposta", titulo: "Proposta", tabela: "propostas", alias: "p" },
  { id: "cliente", titulo: "Cliente", tabela: "clientes", alias: "c", omitir: ["sencli"] },
];

/** Colunas cujo cálculo é caro (agregado de RAT): filtrar, ordenar ou resumir por elas pede o modo conjunto. */
export const COLUNAS_PESADAS_GESTAO_PROPOSTAS = [
  "horasRat",
  "saldoHoras",
  "horasFaturadas",
  "horasNaoFaturadas",
  "valorFaturamento",
  "valorNaoFaturado",
  "totalRats",
  "ratsBloqueando",
];

/** O pedido da lista (query de registrarListaConsultavel) precisa das colunas pesadas para o recorte inteiro? */
export function precisaCalcularConjunto(query: Record<string, unknown>): boolean {
  // Filtro, ordem, resumo e aba "Valores" chegam como texto (JSON ou nome); coluna calculada (calc_<id>) pode depender de qualquer uma.
  const pedido = [query.filtros, query.ordem, query.resumo, query.coluna].filter((v): v is string => typeof v === "string").join(" ");
  return /calc_\d/.test(pedido) || COLUNAS_PESADAS_GESTAO_PROPOSTAS.some((c) => new RegExp(`\\b${c}\\b`).test(pedido));
}

// ---------- Expressões de faturamento (também usadas pela lista filha de RATs, ratsListaSql.ts) ----------

/**
 * Item faturável, derivado de FATSER_FATURAVEL (nunca uma lista literal aqui). `UPPER(BTRIM(...))` é obrigatório: há item com fatser 'n'
 * minúsculo e em branco no banco. `COALESCE(...,'')` faz o apontamento sem item de proposta casado cair em "não faturável" — é isso que fecha a
 * soma. Propositalmente DIFERENTE de `semFaturamento()` (eficienciaPropostas.ts), que trata fatser nulo/vazio como faturável.
 */
const FATURAVEL = Prisma.sql`UPPER(BTRIM(COALESCE(pi.fatser, ''))) IN (${Prisma.join(FATSER_FATURAVEL.map((f) => Prisma.sql`${f}`))})`;

/** Duração do apontamento em minutos (RAT_ITEM_VALIDO garante horfim > horini). */
const DURACAO = Prisma.sql`(ri.horfim - ri.horini)`;

/**
 * `rats r` + `rat_itens ri` + o item da proposta (`pi`) que o apontamento executou. O casamento usa o codpro DA RAT: o apontamento sem
 * `codpro` próprio herda o da RAT, e `ri.codpro` nunca diverge de `r.codpro` quando existe.
 */
export const RATS_COM_ITEM_DA_PROPOSTA = Prisma.sql`rats r
  JOIN rat_itens ri ON ri."ratId" = r.id
  LEFT JOIN propostas_itens pi ON pi.codemp = r.codemp AND pi.codpro = r.codpro AND pi.seqite = ri.seqite AND pi.removido_em_senior IS NULL`;

/** Os apontamentos de UMA RAT já em curso (`r` vem da consulta de fora) com o item da proposta: para o faturamento por RAT em ratsListaSql.ts. */
export const ITENS_COM_ITEM_DA_PROPOSTA = Prisma.sql`rat_itens ri
  LEFT JOIN propostas_itens pi ON pi.codemp = r.codemp AND pi.codpro = r.codpro AND pi.seqite = ri.seqite AND pi.removido_em_senior IS NULL`;

/** Agregados SOBRE `RATS_COM_ITEM_DA_PROPOSTA` filtrado por `RAT_ITEM_VALIDO`. Minutos inteiros e valores em R$ (horas × valor-hora do item). */
export const AGREGADOS_DE_FATURAMENTO = {
  minutosRat: Prisma.sql`SUM(${DURACAO})`,
  minutosFaturaveis: Prisma.sql`SUM(CASE WHEN ${FATURAVEL} THEN ${DURACAO} ELSE 0 END)`,
  minutosNaoFaturaveis: Prisma.sql`SUM(CASE WHEN ${FATURAVEL} THEN 0 ELSE ${DURACAO} END)`,
  // numeric ANTES da divisão: minuto / 60 em inteiro truncaria. O float8 só no fim, para o JSON.
  valorFaturavel: Prisma.sql`SUM(CASE WHEN ${FATURAVEL} THEN ${DURACAO}::numeric / 60 * COALESCE(pi.valhor, 0) ELSE 0 END)`,
  valorNaoFaturavel: Prisma.sql`SUM(CASE WHEN ${FATURAVEL} THEN 0 ELSE ${DURACAO}::numeric / 60 * COALESCE(pi.valhor, 0) END)`,
};

/** Situação e tom do selo, em SQL (mesmas regras de `sitproLabel`/`sitproTone`, propostasDominio.ts). Esperam a proposta com alias `p`. */
export const SITUACAO_PROPOSTA_SQL = rotuloSql(Prisma.sql`p.sitpro`, SITPRO_LABELS, "Situação", "Sem situação");
export const TOM_PROPOSTA_SQL = Prisma.sql`(CASE WHEN p.sitpro IN (4, 7, 8) THEN 'success' WHEN p.sitpro IN (5, 6) THEN 'destructive'
  WHEN p.sitpro IN (1, 2, 3, 9) THEN 'warning' ELSE 'neutral' END)`;

// ---------- Consulta ----------

/** Escapa % _ \ para o termo da busca entrar num LIKE sem virar curinga. */
const termoLike = (t: string) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * `com` (CTEs) e `interna` (uma linha por proposta, já com os filtros do topo) para `registrarListaConsultavel`. Sem ORDER BY nem LIMIT.
 * Colunas expostas: codemp, codpro, codlev2, modpro, modproLabel, modproRelac, modproRelacLabel, numprj, sitpro, sitproLabel, sitproTone, cliente, despro, datret, depexeLabel, forfatLabel, depcusrecLabel, modproLabel,
 * totalItens, totalRats, ratsBloqueando, horasProposta, horasRat, saldoHoras, horasFaturadas, horasNaoFaturadas e, com `comValores`,
 * valorFaturamento e valorNaoFaturado.
 */
export function consultaGestaoPropostas(filtros: FiltrosGestaoPropostas, opcoes: OpcoesGestaoPropostas = {}): { com: Prisma.Sql; interna: Prisma.Sql } {
  const comValores = opcoes.comValores !== false;
  const condicoes: Prisma.Sql[] = [];
  if (filtros.tipo === "cli") condicoes.push(Prisma.sql`p.codcli <> ${CODCLI_EMPRESA_PROPRIA}`);
  if (filtros.tipo === "int") condicoes.push(Prisma.sql`p.codcli = ${CODCLI_EMPRESA_PROPRIA}`);
  if (filtros.situacoes) condicoes.push(Prisma.sql`p.sitpro = ANY(${filtros.situacoes}::int[])`);
  if (filtros.depexes) condicoes.push(Prisma.sql`p.depexe = ANY(${filtros.depexes}::int[])`);
  if (filtros.modpros) condicoes.push(Prisma.sql`p.modpro = ANY(${filtros.modpros}::int[])`);
  const busca = filtros.busca.trim().toLowerCase();
  if (busca) {
    const like = termoLike(busca);
    condicoes.push(Prisma.sql`(
      lower(c.nomcli) LIKE ${like}
      OR p.codcli::text LIKE ${like}
      OR p.codpro::text LIKE ${like}
      OR COALESCE(p.numprj::text, '') LIKE ${like}
      OR lower(COALESCE(p.despro, '')) LIKE ${like}
    )`);
  }
  const onde = condicoes.length > 0 ? Prisma.sql`WHERE ${Prisma.join(condicoes, " AND ")}` : Prisma.empty;

  const itens = Prisma.sql`itens AS (
      SELECT codemp, codpro, COUNT(*)::int AS n, COALESCE(SUM(qtdhor), 0)::int AS minutos
      FROM propostas_itens WHERE removido_em_senior IS NULL
      GROUP BY codemp, codpro
    )`;

  const A = AGREGADOS_DE_FATURAMENTO;
  const bloqueia = Prisma.join(SITRAT_BLOQUEIA_FINALIZAR.map((s) => Prisma.sql`${s}`));
  let com: Prisma.Sql;
  let juncoes: Prisma.Sql;
  let minRat: Prisma.Sql;
  let minFat: Prisma.Sql;
  let valFat: Prisma.Sql;
  let valNaoFat: Prisma.Sql;
  let totalRats: Prisma.Sql;
  let ratsBloqueando: Prisma.Sql;
  if (opcoes.conjunto) {
    com = Prisma.sql`WITH ${itens},
      rat_prop AS (
        SELECT r.codemp, r.codpro,
               COALESCE(${A.minutosRat}, 0)::int AS min_rat,
               COALESCE(${A.minutosFaturaveis}, 0)::int AS min_fat,
               COALESCE(${A.valorFaturavel}, 0)::float8 AS val_fat,
               COALESCE(${A.valorNaoFaturavel}, 0)::float8 AS val_nfat
        FROM ${RATS_COM_ITEM_DA_PROPOSTA}
        WHERE r.codpro IS NOT NULL AND ${RAT_ITEM_VALIDO}
        GROUP BY r.codemp, r.codpro
      ),
      rat_cab AS (
        SELECT codemp, codpro, COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE sitrat IN (${bloqueia})))::int AS bloq
        FROM rats WHERE codpro IS NOT NULL AND removido_em_senior IS NULL
        GROUP BY codemp, codpro
      )`;
    juncoes = Prisma.sql`LEFT JOIN rat_prop rp ON rp.codemp = p.codemp AND rp.codpro = p.codpro
      LEFT JOIN rat_cab rc ON rc.codemp = p.codemp AND rc.codpro = p.codpro`;
    minRat = Prisma.sql`COALESCE(rp.min_rat, 0)`;
    minFat = Prisma.sql`COALESCE(rp.min_fat, 0)`;
    valFat = Prisma.sql`COALESCE(rp.val_fat, 0)`;
    valNaoFat = Prisma.sql`COALESCE(rp.val_nfat, 0)`;
    totalRats = Prisma.sql`COALESCE(rc.n, 0)`;
    ratsBloqueando = Prisma.sql`COALESCE(rc.bloq, 0)`;
  } else {
    // Por linha: sem filtro/ordem/resumo por coluna pesada o Postgres só calcula estas subconsultas para as linhas da página (índice
    // rats(codemp, codpro) obrigatório: sem ele cada uma é um seq scan em ~25 mil RATs).
    com = Prisma.sql`WITH ${itens}`;
    juncoes = Prisma.empty;
    const doRat = (agregado: Prisma.Sql, cast: Prisma.Sql) =>
      Prisma.sql`(SELECT COALESCE(${agregado}, 0)${cast} FROM ${RATS_COM_ITEM_DA_PROPOSTA} WHERE r.codemp = p.codemp AND r.codpro = p.codpro AND ${RAT_ITEM_VALIDO})`;
    minRat = doRat(A.minutosRat, Prisma.sql`::int`);
    minFat = doRat(A.minutosFaturaveis, Prisma.sql`::int`);
    valFat = doRat(A.valorFaturavel, Prisma.sql`::float8`);
    valNaoFat = doRat(A.valorNaoFaturavel, Prisma.sql`::float8`);
    totalRats = Prisma.sql`(SELECT COUNT(*)::int FROM rats r WHERE r.codemp = p.codemp AND r.codpro = p.codpro AND r.removido_em_senior IS NULL)`;
    ratsBloqueando = Prisma.sql`(SELECT COUNT(*)::int FROM rats r WHERE r.codemp = p.codemp AND r.codpro = p.codpro AND r.removido_em_senior IS NULL AND r.sitrat IN (${bloqueia}))`;
  }

  const base = Prisma.sql`
    SELECT p.codemp, p.codpro, p.numprj, p.sitpro,
           -- Proposta Relacionada (USU_CodLev2): 0 no Senior é "sem relacionada" (como em routes/pedidos.ts), vira nulo para filtrar como vazio.
           NULLIF(p.codlev2, 0) AS codlev2,
           p.modpro,
           -- Modalidade da proposta relacionada (a mesma tabela, ligada pelo codlev2): nula quando não há relacionada ou ela não está no CaxHub.
           rel.modpro AS "modproRelac",
           ${rotuloSql(Prisma.sql`rel.modpro`, MODPRO_LABELS, "Modalidade", null)} AS "modproRelacLabel",
           ${SITUACAO_PROPOSTA_SQL} AS "sitproLabel",
           ${TOM_PROPOSTA_SQL} AS "sitproTone",
           (p.codcli::text || ' - ' || c.nomcli) AS cliente,
           p.despro,
           NULLIF(p.datret, DATE '1900-12-31') AS datret,
           ${rotuloSql(Prisma.sql`p.depexe`, DEPEXE_LABELS, "Depto.")} AS "depexeLabel",
           ${rotuloSql(Prisma.sql`p.forfat`, FORFAT_LABELS, "Forma")} AS "forfatLabel",
           (SELECT string_agg(t.rotulo, ', ' ORDER BY t.rotulo)
              FROM (SELECT DISTINCT ${rotuloSql(Prisma.sql`pi2.depcusrec`, DEPEXE_LABELS, "Depto.")} AS rotulo
                      FROM propostas_itens pi2
                     WHERE pi2.codemp = p.codemp AND pi2.codpro = p.codpro AND pi2.removido_em_senior IS NULL AND pi2.depcusrec IS NOT NULL) t) AS "depcusrecLabel",
           ${rotuloSql(Prisma.sql`p.modpro`, MODPRO_LABELS, "Modalidade")} AS "modproLabel",
           COALESCE(it.n, 0) AS "totalItens",
           COALESCE(it.minutos, 0) AS min_proposta,
           ${minRat} AS min_rat,
           ${minFat} AS min_fat,
           ${comValores ? Prisma.sql`${valFat} AS val_fat, ${valNaoFat} AS val_nfat,` : Prisma.empty}
           ${totalRats} AS "totalRats",
           ${ratsBloqueando} AS "ratsBloqueando"
           ${opcoes.extras?.selecao ?? Prisma.empty}
    FROM propostas p
    JOIN clientes c ON c.codcli = p.codcli
    LEFT JOIN itens it ON it.codemp = p.codemp AND it.codpro = p.codpro
    LEFT JOIN propostas rel ON rel.codemp = p.codemp AND rel.codpro = NULLIF(p.codlev2, 0)
    ${juncoes}
    ${onde}`;

  // Camada de fora: as colunas que DERIVAM das calculadas ficam aqui, então as somas fecham por construção
  // (horasFaturadas + horasNaoFaturadas = horasRat; saldoHoras = horasProposta − horasRat).
  const interna = Prisma.sql`
    SELECT b.codemp, b.codpro, b.codlev2, b.modpro, b."modproRelac", b."modproRelacLabel", b.numprj, b.sitpro, b."sitproLabel", b."sitproTone", b.cliente, b.despro, b.datret,
           b."depexeLabel", b."forfatLabel", b."depcusrecLabel", b."modproLabel", b."totalItens", b."totalRats", b."ratsBloqueando",
           (b.min_proposta::numeric / 60)::float8 AS "horasProposta",
           (b.min_rat::numeric / 60)::float8 AS "horasRat",
           ((b.min_proposta - b.min_rat)::numeric / 60)::float8 AS "saldoHoras",
           (b.min_fat::numeric / 60)::float8 AS "horasFaturadas",
           ((b.min_rat - b.min_fat)::numeric / 60)::float8 AS "horasNaoFaturadas"
           ${comValores ? Prisma.sql`, b.val_fat::float8 AS "valorFaturamento", b.val_nfat::float8 AS "valorNaoFaturado"` : Prisma.empty}
           ${opcoes.extras?.repasse ?? Prisma.empty}
    FROM (${base}) b`;
  return { com, interna };
}

/** Ordem padrão da lista: número da proposta decrescente (as mais novas primeiro). */
export const ORDEM_PADRAO_GESTAO_PROPOSTAS = Prisma.sql`x."codpro" DESC`;
