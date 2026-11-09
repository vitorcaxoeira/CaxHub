import { Prisma } from "@prisma/client";
import { INTEGRACAO_ERP_LABELS, type IntegracaoErpStatus, SITRAT_LABELS, SITRAT_ORDER } from "./ratDominio";
import { RAT_ITEM_VALIDO } from "./eficienciaDados";
import { AGREGADOS_DE_FATURAMENTO, ITENS_COM_ITEM_DA_PROPOSTA } from "./gestaoPropostasSql";

// Lista de RATs de Meus Apontamentos em SQL (04/11/2026): uma linha por RAT visível, com cliente, consultor, itens, minutos e o status
// de integração com o Senior JÁ calculados no banco. É a consulta interna de `registrarListaConsultavel` (GET /rats/lista): por fora
// entram filtro e ordem por coluna, página, resumo do rodapé e colunas calculadas. Antes a lista era montada em memória sempre que havia
// busca, busca em itens ou filtro de integração (o admin enxerga ~25 mil RATs; medido 3 s+ em produção).
//
// A integração repete em SQL a regra de `calcularIntegracaoErp`/`classificarItemIntegracao` (ratDominio.ts) sobre as mesmas entradas de
// `buscarItensEIntegracao` (routes/rats.ts): por item, uma alteração de sessão ainda não equalizada (`editar_apontamento` pendente/enviando/
// bloqueada) vence tudo (com erro = falha, senão enviando); depois, `numrat` preenchido = sincronizado; senão a pendência
// `criar_apontamento` mais recente daquele item (payload.ratItemId): "invalido" ou com erro = falha, existente = enviando, ausente = pendente. Cada pendência de
// despesa ainda ativa (pendente/enviando/bloqueado) da RAT entra como mais uma entrada não confirmada. Agregado = pior caso
// (falha > enviando > pendente > sincronizado); RAT sem entrada nenhuma = pendente. Qualquer mudança lá precisa vir para cá também:
// o teste de paridade (scripts/paridadeIntegracaoRats.ts) compara as duas sobre todas as RATs do banco.

/** Recorte de visibilidade: admin vê tudo; os demais, as próprias (codfor) e as dos departamentos que gerenciam (depexe). */
export interface VisibilidadeRats {
  todas: boolean;
  codfor: number | null;
  depexes: number[];
}

/** Filtros do topo da tela (os mesmos de antes, que já têm a estrela de padrão). */
export interface FiltrosTopoRats {
  codfors: number[];
  sitrats: number[];
  /** Cliente ("codcli - nome"), número da proposta ou número da RAT no Senior, por trecho. */
  busca: string;
  /** Observação de algum item (trecho) ou id local da atividade de alguma sessão do item (só quando numérico). */
  buscaItem: string;
  integracao: IntegracaoErpStatus[];
  /**
   * Só as RATs de UMA proposta (tela Gestão Propostas, 09/11/2026). Opcionais para o resto do sistema não precisar informar. `codpro` sozinho
   * recorta a proposta em qualquer empresa; com `codemp` recorta a chave inteira.
   */
  codemp?: number | null;
  codpro?: number | null;
}

export const STATUS_INTEGRACAO: IntegracaoErpStatus[] = ["falha", "enviando", "pendente", "sincronizado"];

/** Peso do pior caso: falha > enviando > pendente > sincronizado. */
const RANK_INTEGRACAO: Record<IntegracaoErpStatus, number> = { sincronizado: 0, pendente: 1, enviando: 2, falha: 3 };

const STATUS_POR_RANK = (expr: Prisma.Sql) =>
  Prisma.sql`(CASE ${expr} WHEN 3 THEN 'falha' WHEN 2 THEN 'enviando' WHEN 0 THEN 'sincronizado' ELSE 'pendente' END)`;

const ROTULO_INTEGRACAO = (expr: Prisma.Sql) =>
  Prisma.sql`(CASE ${expr} ${Prisma.join(
    STATUS_INTEGRACAO.map((s) => Prisma.sql`WHEN ${s} THEN ${INTEGRACAO_ERP_LABELS[s]}`),
    " ",
  )} END)`;

/** Rótulo da situação como a tela mostra (sitratLabelEfetivo): "Excluída" quando removida no Senior. */
const ROTULO_SITRAT = Prisma.sql`(CASE
  WHEN r.removido_em_senior IS NOT NULL THEN 'Excluída'
  WHEN r.sitrat IS NULL THEN '—'
  ${Prisma.join(
    SITRAT_ORDER.map((s) => Prisma.sql`WHEN r.sitrat = ${s} THEN ${SITRAT_LABELS[s]}`),
    " ",
  )}
  ELSE 'Situação ' || r.sitrat::text
END)`;

/** Domínio do funil de "Sinc. ERP" e de "Situação" (rótulos que a tela mostra). */
export const ROTULOS_INTEGRACAO = STATUS_INTEGRACAO.map((s) => INTEGRACAO_ERP_LABELS[s]);
export const ROTULOS_SITRAT = [...SITRAT_ORDER.map((s) => SITRAT_LABELS[s]), "Excluída"];

export interface OpcoesConsultaRats {
  /** Só as candidatas a "Fechar Todos": Digitado (9) e não removidas no Senior. */
  somenteDigitadasAtivas?: boolean;
  /**
   * Itens, minutos e integração calculados para o recorte INTEIRO de uma vez (agregados com hash), e não por linha. Necessário quando a
   * pessoa filtra, ordena, resume ou lista valores dessas colunas (ou o filtro de sincronização do topo está ativo); ver
   * `precisaCalcularConjunto`. Sem isso, cada uma é subconsulta por linha e o Postgres só a calcula para as linhas da página.
   */
  conjunto?: boolean;
  /**
   * Acrescenta, por RAT, o que é faturável: `minutosFaturaveis`, `minutosNaoFaturaveis`, `valorFaturamento` e `valorNaoFaturado` (mesma régua da lista de
   * propostas, domain/gestaoPropostasSql.ts: só apontamento válido, faturável = item com fatser S/A). Desligado, o SQL é idêntico ao de antes.
   * Em MINUTOS, como `totalMinutos`. Subconsultas por linha nos dois modos: a lista é sempre de UMA proposta (no máximo algumas centenas de RATs).
   */
  comFaturamento?: boolean;
}

/** Colunas cujo cálculo por linha é caro (agregado de itens e pendências): filtrar, ordenar ou resumir por elas pede o modo conjunto. */
export const COLUNAS_PESADAS_RATS = ["totalItens", "totalMinutos", "integracao", "integracaoLabel"];

/** O pedido da lista (query de registrarListaConsultavel) precisa das colunas pesadas para o recorte inteiro? */
export function precisaCalcularConjunto(query: Record<string, unknown>, filtros: FiltrosTopoRats): boolean {
  if (filtros.integracao.length > 0) return true;
  // Filtro, ordem, resumo e aba "Valores" chegam como texto (JSON ou nome); coluna calculada (calc_<id>) pode depender de qualquer uma.
  const pedido = [query.filtros, query.ordem, query.resumo, query.coluna].filter((v): v is string => typeof v === "string").join(" ");
  return /calc_\d/.test(pedido) || COLUNAS_PESADAS_RATS.some((c) => new RegExp(`\\b${c}\\b`).test(pedido));
}

/**
 * `com` (CTEs) e `interna` (uma linha por RAT, já com os filtros do topo) para `registrarListaConsultavel`. Sem ORDER BY nem LIMIT.
 * Colunas expostas: id, numrat, datemi, codemp, codpro, numprj, codfor, sitrat, depexe, excluida, sitratLabel, cliente, consultorNome,
 * totalItens, totalMinutos, integracao, integracaoLabel.
 */
export function consultaRatsLista(
  vis: VisibilidadeRats,
  filtros: FiltrosTopoRats,
  opcoes: OpcoesConsultaRats = {},
): { com: Prisma.Sql; interna: Prisma.Sql } {
  const condicoes: Prisma.Sql[] = [];
  if (!vis.todas) {
    const ou: Prisma.Sql[] = [];
    if (vis.codfor != null) ou.push(Prisma.sql`r.codfor = ${vis.codfor}`);
    if (vis.depexes.length > 0) ou.push(Prisma.sql`r.depexe IN (${Prisma.join(vis.depexes)})`);
    condicoes.push(ou.length > 0 ? Prisma.sql`(${Prisma.join(ou, " OR ")})` : Prisma.sql`FALSE`);
  }
  if (filtros.codfors.length > 0) condicoes.push(Prisma.sql`r.codfor IN (${Prisma.join(filtros.codfors)})`);
  // RAT sem situação (sitrat null) fica de fora sempre que o filtro está ativo — `IN` já exclui NULL.
  if (filtros.sitrats.length > 0) condicoes.push(Prisma.sql`r.sitrat IN (${Prisma.join(filtros.sitrats)})`);
  if (filtros.codpro != null) condicoes.push(Prisma.sql`r.codpro = ${filtros.codpro}`);
  if (filtros.codemp != null) condicoes.push(Prisma.sql`r.codemp = ${filtros.codemp}`);
  if (opcoes.somenteDigitadasAtivas) condicoes.push(Prisma.sql`r.sitrat = 9 AND r.removido_em_senior IS NULL`);
  const ondeVis = condicoes.length > 0 ? Prisma.sql`WHERE ${Prisma.join(condicoes, " AND ")}` : Prisma.empty;

  // Pendência criar_apontamento mais recente de cada item (payload.ratItemId), como pendenciaPorRatItem em buscarItensEIntegracao.
  // Nome do consultor por codfor (poucas centenas): uma tabela pequena por consulta, ligada por hash às RATs. O mesmo codfor pode estar em
  // mais de um usuário do Senior (3 casos em 04/11/2026; nenhum codfor em mais de uma empresa); GET /rats escolhia ao acaso (ordem física).
  // Aqui é determinístico: o não removido primeiro, depois o menor codusu.
  const cons = Prisma.sql`cons AS MATERIALIZED (
      SELECT DISTINCT ON (c.codfor) c.codfor, COALESCE(c.nomcom, c.nomfor) AS nome
      FROM consultores c
      WHERE c.codfor IS NOT NULL
      ORDER BY c.codfor, (c.removido_em_senior IS NULL) DESC, c.codusu ASC
    )`;
  const pend = Prisma.sql`pend AS MATERIALIZED (
      SELECT DISTINCT ON (q.rid) q.rid, q.status, q."ultimoErro"
      FROM (
        SELECT (sp.payload->>'ratItemId')::int AS rid, sp.id, sp.status, sp."ultimoErro"
        FROM sincronizacao_pendente sp
        WHERE sp.tipo = 'criar_apontamento' AND (sp.payload->>'ratItemId') ~ '^[0-9]{1,9}$'
      ) q
      ORDER BY q.rid, q.id DESC
    )`;
  // Alteração de sessão (tipEve A) ainda não equalizada: o item tem numrat mas não está sincronizado até ela sair.
  const pendEd = Prisma.sql`pend_ed AS MATERIALIZED (
      SELECT DISTINCT ON (q.rid) q.rid, q.status, q."ultimoErro"
      FROM (
        SELECT (sp.payload->>'ratItemId')::int AS rid, sp.id, sp.status, sp."ultimoErro"
        FROM sincronizacao_pendente sp
        WHERE sp.tipo = 'editar_apontamento' AND sp.status IN ('pendente', 'enviando', 'bloqueado')
          AND (sp.payload->>'ratItemId') ~ '^[0-9]{1,9}$'
      ) q
      ORDER BY q.rid, q.id DESC
    )`;
  const rankDoItem = Prisma.sql`CASE
      WHEN e.rid IS NOT NULL THEN CASE WHEN COALESCE(e."ultimoErro", '') <> '' THEN ${RANK_INTEGRACAO.falha} ELSE ${RANK_INTEGRACAO.enviando} END
      WHEN i.numrat IS NOT NULL THEN ${RANK_INTEGRACAO.sincronizado}
      WHEN p.rid IS NULL THEN ${RANK_INTEGRACAO.pendente}
      WHEN p.status = 'invalido' OR COALESCE(p."ultimoErro", '') <> '' THEN ${RANK_INTEGRACAO.falha}
      ELSE ${RANK_INTEGRACAO.enviando}
    END`;
  const rankDaDespesa = Prisma.sql`CASE WHEN COALESCE(spd."ultimoErro", '') <> '' THEN ${RANK_INTEGRACAO.falha} ELSE ${RANK_INTEGRACAO.enviando} END`;
  const despesasAtivas = Prisma.sql`registros_despesa_viagem d
    JOIN sincronizacao_pendente_despesa spd ON spd."despesaId" = d.id AND spd.status IN ('pendente', 'enviando', 'bloqueado')`;
  const minutosDoItem = Prisma.sql`CASE WHEN i.horini IS NOT NULL AND i.horfim IS NOT NULL THEN i.horfim - i.horini ELSE 0 END`;

  // Duas formas de calcular itens, minutos e integração, com o MESMO resultado (teste de paridade):
  // - por linha (padrão): subconsultas correlacionadas na lista de colunas; sem filtro/ordem/resumo por elas o Postgres só as calcula
  //   para as linhas da página, depois do ORDER BY/LIMIT (abertura da tela com ~25 mil RATs do admin);
  // - conjunto: agregados com hash sobre o recorte inteiro, para quando a pessoa filtra/ordena/resume por elas.
  let com: Prisma.Sql;
  let juncoes: Prisma.Sql;
  let totalItens: Prisma.Sql;
  let totalMinutos: Prisma.Sql;
  let rank: Prisma.Sql;
  if (opcoes.conjunto) {
    com = Prisma.sql`WITH ${cons}, ${pend}, ${pendEd},
      ia AS (
        SELECT i."ratId", COUNT(*)::int AS n, COALESCE(SUM(${minutosDoItem}), 0)::int AS minutos, MAX(${rankDoItem}) AS rk
        FROM rat_itens i
        JOIN rats r ON r.id = i."ratId"
        LEFT JOIN pend p ON p.rid = i.id
        LEFT JOIN pend_ed e ON e.rid = i.id
        ${ondeVis}
        GROUP BY i."ratId"
      ),
      da AS (
        SELECT r.id AS "ratId", MAX(${rankDaDespesa}) AS rk
        FROM rats r
        JOIN ${despesasAtivas} ON d.codemp = r.codemp AND d.numrat = r.numrat AND d.excluida_em IS NULL
        ${ondeVis}
        GROUP BY r.id
      )`;
    juncoes = Prisma.sql`LEFT JOIN ia ON ia."ratId" = r.id LEFT JOIN da ON da."ratId" = r.id`;
    totalItens = Prisma.sql`COALESCE(ia.n, 0)`;
    totalMinutos = Prisma.sql`COALESCE(ia.minutos, 0)`;
    rank = Prisma.sql`COALESCE(GREATEST(ia.rk, da.rk), ${RANK_INTEGRACAO.pendente})`;
  } else {
    // MATERIALIZED (acima): é lida dentro de subconsulta correlacionada; sem isso o Postgres a refaria por linha.
    com = Prisma.sql`WITH ${cons}, ${pend}, ${pendEd}`;
    juncoes = Prisma.empty;
    totalItens = Prisma.sql`(SELECT COUNT(*)::int FROM rat_itens i WHERE i."ratId" = r.id)`;
    totalMinutos = Prisma.sql`(SELECT COALESCE(SUM(${minutosDoItem}), 0)::int FROM rat_itens i WHERE i."ratId" = r.id)`;
    rank = Prisma.sql`COALESCE(GREATEST(
      (SELECT MAX(${rankDoItem}) FROM rat_itens i LEFT JOIN pend p ON p.rid = i.id LEFT JOIN pend_ed e ON e.rid = i.id WHERE i."ratId" = r.id),
      (SELECT MAX(${rankDaDespesa}) FROM ${despesasAtivas} WHERE d.codemp = r.codemp AND d.numrat = r.numrat AND d.excluida_em IS NULL)
    ), ${RANK_INTEGRACAO.pendente})`;
  }

  // Faturamento por RAT (opcional): o agregado de UMA RAT, sobre os mesmos apontamentos válidos que a lista de propostas soma.
  const doRat = (agregado: Prisma.Sql, cast: string) =>
    Prisma.sql`(SELECT COALESCE(${agregado}, 0)${Prisma.raw(cast)} FROM ${ITENS_COM_ITEM_DA_PROPOSTA} WHERE ri."ratId" = r.id AND ${RAT_ITEM_VALIDO})`;
  const faturamento = opcoes.comFaturamento
    ? Prisma.sql`,
      ${doRat(AGREGADOS_DE_FATURAMENTO.minutosFaturaveis, "::int")} AS "minutosFaturaveis",
      ${doRat(AGREGADOS_DE_FATURAMENTO.minutosNaoFaturaveis, "::int")} AS "minutosNaoFaturaveis",
      ${doRat(AGREGADOS_DE_FATURAMENTO.valorFaturavel, "::float8")} AS "valorFaturamento",
      ${doRat(AGREGADOS_DE_FATURAMENTO.valorNaoFaturavel, "::float8")} AS "valorNaoFaturado"`
    : Prisma.empty;

  const base = Prisma.sql`
    SELECT r.id, r.numrat, r.datemi, r.codemp, r.codpro, r.numprj, r.codfor, r.sitrat, r.depexe,
      (r.removido_em_senior IS NOT NULL) AS excluida,
      ${ROTULO_SITRAT} AS "sitratLabel",
      (SELECT cli.codcli::text || ' - ' || cli.nomcli
         FROM propostas p JOIN clientes cli ON cli.codcli = p.codcli
         WHERE p.codemp = r.codemp AND p.codpro = r.codpro) AS cliente,
      COALESCE(cons.nome, 'Fornecedor ' || r.codfor::text) AS "consultorNome",
      ${totalItens} AS "totalItens",
      ${totalMinutos} AS "totalMinutos",
      ${STATUS_POR_RANK(rank)} AS integracao${faturamento}
    FROM rats r
    LEFT JOIN cons ON cons.codfor = r.codfor
    ${juncoes} ${ondeVis}`;

  // Filtros do topo que olham o que só existe depois dos joins (cliente, integração) ou dentro dos itens.
  const fora: Prisma.Sql[] = [];
  const busca = filtros.busca.trim().toLowerCase();
  if (busca) {
    fora.push(Prisma.sql`(
      position(${busca} in lower(COALESCE(b.cliente, ''))) > 0
      OR position(${busca} in COALESCE(b.codpro::text, '')) > 0
      OR position(${busca} in COALESCE(b.numrat::text, '')) > 0
    )`);
  }
  const buscaItem = filtros.buscaItem.trim();
  if (buscaItem) {
    const numerica = /^\d{1,9}$/.test(buscaItem) ? Number(buscaItem) : null;
    fora.push(Prisma.sql`EXISTS (
      SELECT 1 FROM rat_itens ri
      WHERE ri."ratId" = b.id
        AND (
          position(${buscaItem.toLowerCase()} in lower(COALESCE(ri.desati, ''))) > 0
          ${numerica != null ? Prisma.sql`OR EXISTS (SELECT 1 FROM atividade_sessoes_execucao s WHERE s."ratItemId" = ri.id AND s."atividadeId" = ${numerica})` : Prisma.empty}
        )
    )`);
  }
  if (filtros.integracao.length > 0) fora.push(Prisma.sql`b.integracao IN (${Prisma.join(filtros.integracao)})`);
  const ondeFora = fora.length > 0 ? Prisma.sql`WHERE ${Prisma.join(fora, " AND ")}` : Prisma.empty;

  const interna = Prisma.sql`SELECT b.*, ${ROTULO_INTEGRACAO(Prisma.sql`b.integracao`)} AS "integracaoLabel" FROM (${base}) b ${ondeFora}`;
  return { com, interna };
}

/** Ordem padrão da lista (a de sempre): Digitado primeiro, emissão mais recente, proposta crescente, id decrescente. */
export const ORDEM_PADRAO_RATS = Prisma.sql`(CASE WHEN x."sitrat" = 9 THEN 0 ELSE 1 END), x."datemi" DESC NULLS LAST, COALESCE(x."codpro", 0), x."id" DESC`;
