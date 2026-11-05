import { Router } from "express";
import { Pedido, Cliente, Prisma } from "@prisma/client";
import { col, registrarListaConsultavel } from "./listaConsultavel";
import { rotuloSql } from "../consultas/rotuloSql";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { sitpedTone, SITPED_LABELS } from "../domain/pedidoDominio";
import { FORFAT_LABELS, MODPRO_LABELS, SITPRO_LABELS, forfatLabel } from "../domain/propostasDominio";
import { runPedidoSyncPorClientes, ResultadoSyncPorCliente } from "../sync/pedidoSync";
import { ResultadoSyncRatsFaltantes, sincronizarRatsFaltantesDosPedidos } from "../sync/ratsDosPedidos";

// Tela "Mercado > Listar Pedidos" — espelho de E120PED (ver backend/src/sync/pedidoSync.ts).
// Só admin acessa (menu "Mercado" restrito, ver frontend/src/layout/Sidebar.tsx).
//
// REGISTROS EXCLUÍDOS NO SENIOR: toda leitura que ALIMENTA uma lista, contagem ou soma de
// pedidos filtra `removidoEmSenior: null` — senão pedido apagado no ERP segue inflando
// listagem e KPI (ver backend/src/sync/varrerRemovidos.ts).
//
// O que NÃO se filtra, de propósito:
//   - lookups de Cliente/Rat/Proposta/FormaPagamento/CondicaoPagamento, que só decoram a
//     linha: filtrar ali faria um pedido vivo aparecer sem nome de cliente. A regra geral
//     é "se o registro é lido a partir de uma FK de outra linha que continua visível, não
//     se filtra";
//   - a tela de detalhe (routes/pedidoVisualizacao.ts), que viraria 404 — ela devolve o
//     pedido com `removidoEmSenior` preenchido e a tela mostra uma tarja.
export const pedidosRouter = Router();
pedidosRouter.use(requireAuth, requireRole("admin"));

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pedidos:${label}]`, message);
  res.status(500).json({ error: message });
}

// Vínculo Pedido -> RAT -> Proposta pra um conjunto de pedidos. O pedido só guarda
// `usu_numrat` (campo customizado, casamento por valor — ver comentário em Pedido.numrat
// no schema); pra achar o nro da proposta e a forma de faturamento, resolve a RAT por
// (codemp, numrat) e a Proposta por (codemp, codpro) a partir dela.
//
// `IN` por codemp+numrat/codpro em vez de `OR` por chave composta — chamado tanto com a
// página atual (dezenas de linhas) quanto com a base inteira (milhares, em /indicadores);
// `OR` com milhares de cláusulas explode o planning time do Postgres (mesmo problema já
// corrigido em atividades.ts), então usar sempre `IN` evita ter dois caminhos diferentes
// dependendo do volume.
export async function resolverRatEProposta(pedidos: Pedido[]) {
  const codempsUnicos = [...new Set(pedidos.map((p) => p.codemp))];
  const numratsUnicos = [...new Set(pedidos.filter((p) => p.numrat != null).map((p) => Number(p.numrat)))];
  const ratsVinculadas =
    numratsUnicos.length > 0
      ? await prisma.rat.findMany({ where: { codemp: { in: codempsUnicos }, numrat: { in: numratsUnicos } } })
      : [];
  const ratPorChave = new Map(ratsVinculadas.map((r) => [`${r.codemp}-${r.numrat}`, r]));

  const codprosUnicos = [...new Set(ratsVinculadas.filter((r) => r.codpro != null).map((r) => r.codpro as number))];
  const propostasVinculadas =
    codprosUnicos.length > 0
      ? await prisma.proposta.findMany({ where: { codemp: { in: codempsUnicos }, codpro: { in: codprosUnicos } } })
      : [];
  const propostaPorChave = new Map(propostasVinculadas.map((p) => [`${p.codemp}-${p.codpro}`, p]));

  // Consultor executor da RAT (Rat.codfor) — só faz sentido quando o pedido tem RAT
  // vinculada, por isso fica junto desse resolver em vez de um lookup à parte.
  const codforsUnicos = [...new Set(ratsVinculadas.map((r) => r.codfor))];
  const consultores = codforsUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforsUnicos } } }) : [];
  const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

  return { ratPorChave, propostaPorChave, consultorPorCodfor };
}

// Forma de Pagamento (codfpg) e Condição de Pagamento (codcpg) direto do Pedido — sem
// indireção via RAT/Proposta, diferente de resolverRatEProposta. Mesmo padrão `IN`
// (não `OR`), mesmo em tabelas pequenas (12/58 linhas hoje), por consistência já que
// essa função também roda sobre a base inteira em /indicadores.
export async function resolverFormaECondicaoPagamento(pedidos: Pedido[]) {
  const codempsUnicos = [...new Set(pedidos.map((p) => p.codemp))];
  const codfpgsUnicos = [...new Set(pedidos.filter((p) => p.codfpg != null).map((p) => p.codfpg as number))];
  const codcpgsUnicos = [...new Set(pedidos.map((p) => p.codcpg))];

  const formasPagamento =
    codfpgsUnicos.length > 0
      ? await prisma.formaPagamento.findMany({ where: { codemp: { in: codempsUnicos }, codfpg: { in: codfpgsUnicos } } })
      : [];
  const formaPagamentoPorChave = new Map(formasPagamento.map((f) => [`${f.codemp}-${f.codfpg}`, f]));

  const condicoesPagamento =
    codcpgsUnicos.length > 0
      ? await prisma.condicaoPagamento.findMany({ where: { codemp: { in: codempsUnicos }, codcpg: { in: codcpgsUnicos } } })
      : [];
  const condicaoPagamentoPorChave = new Map(condicoesPagamento.map((c) => [`${c.codemp}-${c.codcpg}`, c]));

  return { formaPagamentoPorChave, condicaoPagamentoPorChave };
}

interface FiltrosPedidos {
  buscaCliente: string;
  buscaNumped: string;
  buscaNumrat: string;
  buscaCodpro: string;
  sitpedFiltro: number[];
  modproFiltro: number[];
  datemiDe: Date | null;
  datemiAte: Date | null;
  /** Só os pedidos deste cliente (tabela do cliente expandido na aba Por Cliente); null = todos. */
  codcli: number | null;
}

// Data de emissão vem do <input type="date"> como "yyyy-mm-dd". Comparada em UTC de
// propósito: `datemi` é `@db.Date`, então o Prisma devolve meia-noite UTC — montar a data
// no fuso do servidor deslocaria o limite e deixaria o pedido do próprio dia de fora.
function lerData(valor: unknown): Date | null {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const data = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(data.getTime()) ? null : data;
}

// Number("") é 0 (não NaN) — sem essa guarda, ausência do filtro viraria [0] e
// esconderia todos os pedidos. Mesmo padrão pra sitped e modpro.
function lerFiltroMultiSelect(valor: unknown): number[] {
  const raw = typeof valor === "string" ? valor : "";
  return raw
    ? raw
        .split(",")
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v))
    : [];
}

// Lê os filtros compartilhados pelas 3 rotas de listagem (Lista, Por Cliente e os itens
// de um cliente expandido) — cada rota decide quais desses aplicar.
function lerFiltros(req: import("express").Request): FiltrosPedidos {
  return {
    buscaCliente: typeof req.query.cliente === "string" ? req.query.cliente.trim().toLowerCase() : "",
    buscaNumped: typeof req.query.numped === "string" ? req.query.numped.trim() : "",
    buscaNumrat: typeof req.query.numrat === "string" ? req.query.numrat.trim() : "",
    buscaCodpro: typeof req.query.codpro === "string" ? req.query.codpro.trim() : "",
    sitpedFiltro: lerFiltroMultiSelect(req.query.sitped),
    modproFiltro: lerFiltroMultiSelect(req.query.modpro),
    datemiDe: lerData(req.query.datemiDe),
    datemiAte: lerData(req.query.datemiAte),
    codcli: typeof req.query.codcli === "string" && /^\d{1,9}$/.test(req.query.codcli) ? Number(req.query.codcli) : null,
  };
}

// Suporta lista separada por vírgula num campo de busca (ex.: "12124,12123,12121") —
// cada termo continua comparado por substring, igual busca de valor único, só que
// "bate com QUALQUER um dos termos" em vez de exigir um valor exato.
function termosBusca(valor: string): string[] {
  return valor
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function aplicarFiltros(
  pedidos: Pedido[],
  filtros: FiltrosPedidos,
  clientePorCodcli: Map<number, Cliente>,
  { comCliente = true }: { comCliente?: boolean } = {}
): Pedido[] {
  let resultado = pedidos;
  if (comCliente && filtros.buscaCliente) {
    resultado = resultado.filter((p) => {
      const cliente = clientePorCodcli.get(p.codcli);
      const label = cliente ? `${cliente.codcli} - ${cliente.nomcli}` : String(p.codcli);
      return label.toLowerCase().includes(filtros.buscaCliente);
    });
  }
  if (filtros.buscaNumped) {
    const termos = termosBusca(filtros.buscaNumped);
    resultado = resultado.filter((p) => termos.some((t) => String(p.numped).includes(t)));
  }
  if (filtros.buscaNumrat) {
    const termos = termosBusca(filtros.buscaNumrat);
    resultado = resultado.filter((p) => p.numrat != null && termos.some((t) => p.numrat!.toString().includes(t)));
  }
  if (filtros.sitpedFiltro.length > 0) {
    resultado = resultado.filter((p) => filtros.sitpedFiltro.includes(p.sitped));
  }
  // Intervalo fechado dos dois lados: quem digita 27/07 a 27/07 espera ver os pedidos
  // emitidos em 27/07. Cada limite funciona sozinho — só "de", só "até", ou os dois.
  if (filtros.datemiDe) {
    const de = filtros.datemiDe;
    resultado = resultado.filter((p) => p.datemi >= de);
  }
  if (filtros.datemiAte) {
    const ate = filtros.datemiAte;
    resultado = resultado.filter((p) => p.datemi <= ate);
  }
  return resultado;
}

// Filtro por nº da proposta — só dá pra aplicar depois de resolver a RAT de cada
// pedido (Pedido não tem a proposta direto, só via RAT), diferente dos filtros de
// aplicarFiltros que operam em cima de colunas do próprio Pedido. Por isso fica de
// fora de aplicarFiltros e é chamado depois de resolverRatEProposta em cada rota.
// Bate tanto com a proposta principal (rat.codpro) quanto com a relacionada
// (Proposta.codlev2, mostrada na coluna Proposta como "8589 → 8557") — codlev2 === 0
// não é uma referência real, mesma regra já aplicada na renderização da coluna.
function filtrarPorProposta(
  pedidos: Pedido[],
  buscaCodpro: string,
  ratPorChave: Awaited<ReturnType<typeof resolverRatEProposta>>["ratPorChave"],
  propostaPorChave: Awaited<ReturnType<typeof resolverRatEProposta>>["propostaPorChave"]
): Pedido[] {
  if (!buscaCodpro) return pedidos;
  const termos = termosBusca(buscaCodpro);
  return pedidos.filter((p) => {
    const rat = p.numrat != null ? ratPorChave.get(`${p.codemp}-${Number(p.numrat)}`) : undefined;
    if (rat?.codpro != null && termos.some((t) => String(rat.codpro).includes(t))) return true;
    const proposta = rat?.codpro != null ? propostaPorChave.get(`${rat.codemp}-${rat.codpro}`) : undefined;
    return proposta?.codlev2 != null && proposta.codlev2 !== 0 && termos.some((t) => String(proposta.codlev2).includes(t));
  });
}

// Filtro por modalidade da proposta (Proposta.modpro) — mesma indireção de
// filtrarPorProposta (Pedido -> RAT -> Proposta), por isso também fica de fora de
// aplicarFiltros e é chamado depois de resolverRatEProposta em cada rota.
function filtrarPorModalidade(
  pedidos: Pedido[],
  modproFiltro: number[],
  ratPorChave: Awaited<ReturnType<typeof resolverRatEProposta>>["ratPorChave"],
  propostaPorChave: Awaited<ReturnType<typeof resolverRatEProposta>>["propostaPorChave"]
): Pedido[] {
  if (modproFiltro.length === 0) return pedidos;
  return pedidos.filter((p) => {
    const rat = p.numrat != null ? ratPorChave.get(`${p.codemp}-${Number(p.numrat)}`) : undefined;
    const proposta = rat?.codpro != null ? propostaPorChave.get(`${rat.codemp}-${rat.codpro}`) : undefined;
    return proposta?.modpro != null && modproFiltro.includes(proposta.modpro);
  });
}


// GET / — lista de pedidos (aba Lista). Desde 03/11/2026 (trazido do CaxHub_Dash) é uma lista consultável (listaConsultavel.ts): a
// consulta resolve Pedido -> RAT -> Proposta -> Consultor e Forma/Condição de Pagamento em SQL, com os MESMOS filtros da barra de
// lerFiltros/aplicarFiltros/filtrarPorProposta/filtrarPorModalidade, para o funil, a ordem por coluna e o rodapé de totais valerem sobre
// todos os pedidos do filtro (não só a página). As outras rotas (Por Cliente, sincronizar) seguem com os filtros em memória.
const SITPED_ROTULO_SQL = rotuloSql(Prisma.sql`p.sitped`, SITPED_LABELS, "Situação");
// Mesmas regras de sitpedTone, modproTone e sitproTone.
const SITPED_TOM_SQL = Prisma.sql`(CASE WHEN p.sitped = 5 THEN 'destructive' WHEN p.sitped = 4 THEN 'success'
  WHEN p.sitped IN (1, 2, 7, 9) THEN 'warning' ELSE 'neutral' END)`;
const MODPRO_TOM_SQL = Prisma.sql`(CASE WHEN pr.modpro = 1 THEN 'warning' WHEN pr.modpro = 2 THEN 'success' ELSE 'neutral' END)`;
const SITPRO_TOM_SQL = Prisma.sql`(CASE WHEN pr.sitpro IN (4, 7, 8) THEN 'success' WHEN pr.sitpro IN (5, 6) THEN 'destructive'
  WHEN pr.sitpro IN (1, 2, 3, 9) THEN 'warning' ELSE 'neutral' END)`;
/** Algum termo da lista (busca "a,b,c") aparece no texto: mesma regra de termosBusca + includes. */
const algumTermo = (termos: string[], texto: Prisma.Sql) =>
  Prisma.sql`EXISTS (SELECT 1 FROM unnest(${termos}::text[]) AS termo WHERE position(termo IN ${texto}) > 0)`;

registrarListaConsultavel(
  pedidosRouter,
  "/",
  (req) => {
    const f = lerFiltros(req);
    const numped = termosBusca(f.buscaNumped);
    const numrat = termosBusca(f.buscaNumrat);
    const codpro = termosBusca(f.buscaCodpro);
    const sitped = f.sitpedFiltro.length ? f.sitpedFiltro : null;
    const modpro = f.modproFiltro.length ? f.modproFiltro : null;
    const de = f.datemiDe ? f.datemiDe.toISOString().slice(0, 10) : null;
    const ate = f.datemiAte ? f.datemiAte.toISOString().slice(0, 10) : null;
    return {
      interna: Prisma.sql`
        SELECT p.codemp, p.codfil, p.numped, p.codcli, p.datemi, p.datprv, p.obsped, NULLIF(trim(p.obsmot), '') AS obsmot,
               p.vlrliq::float8 AS vlrliq, p.pedcli, p.sitped,
               COALESCE(c.codcli || ' - ' || c.nomcli, p.codcli::text) AS cliente,
               ${SITPED_ROTULO_SQL} AS situacao, ${SITPED_TOM_SQL} AS "sitpedTone",
               p.numrat::text AS numrat, r.id AS "ratId",
               CASE WHEN r.id IS NULL THEN NULL ELSE COALESCE(co.nomcom, co.nomfor, 'Fornecedor ' || r.codfor) END AS consultor,
               r.codpro AS "propostaCodpro", pr.codlev2 AS "propostaCodlev2",
               CASE WHEN r.codpro IS NULL THEN NULL
                    WHEN pr.codlev2 IS NOT NULL AND pr.codlev2 <> 0 THEN r.codpro || ' → ' || pr.codlev2
                    ELSE r.codpro::text END AS proposta,
               CASE WHEN pr.codpro IS NULL THEN NULL ELSE ${rotuloSql(Prisma.sql`pr.modpro`, MODPRO_LABELS, "Modalidade")} END AS modalidade,
               CASE WHEN pr.codpro IS NULL THEN NULL ELSE ${MODPRO_TOM_SQL} END AS "modalidadeTone",
               CASE WHEN pr.codpro IS NULL THEN NULL ELSE ${rotuloSql(Prisma.sql`pr.sitpro`, SITPRO_LABELS, "Situação", "Sem situação")} END AS "situacaoProposta",
               CASE WHEN pr.codpro IS NULL THEN NULL ELSE ${SITPRO_TOM_SQL} END AS "situacaoPropostaTone",
               CASE WHEN pr.codpro IS NULL THEN NULL ELSE ${rotuloSql(Prisma.sql`pr.forfat`, FORFAT_LABELS, "Forma")} END AS faturamento,
               fp.desfpg AS "formaPagamento", cp.descpg AS "condicaoPagamento"
        FROM pedidos p
        LEFT JOIN clientes c ON c.codcli = p.codcli
        LEFT JOIN LATERAL (
          SELECT r.id, r.codemp, r.codpro, r.codfor FROM rats r WHERE r.codemp = p.codemp AND r.numrat = p.numrat ORDER BY r.id DESC LIMIT 1
        ) r ON p.numrat IS NOT NULL
        LEFT JOIN propostas pr ON pr.codemp = r.codemp AND pr.codpro = r.codpro
        LEFT JOIN LATERAL (SELECT co.nomcom, co.nomfor FROM consultores co WHERE co.codfor = r.codfor LIMIT 1) co ON r.id IS NOT NULL
        LEFT JOIN formas_pagamento fp ON fp.codemp = p.codemp AND fp.codfpg = p.codfpg
        LEFT JOIN condicoes_pagamento cp ON cp.codemp = p.codemp AND cp.codcpg = p.codcpg
        WHERE p.removido_em_senior IS NULL
          AND (${f.codcli}::int IS NULL OR p.codcli = ${f.codcli}::int)
          AND (${f.buscaCliente} = '' OR position(${f.buscaCliente} IN lower(COALESCE(c.codcli || ' - ' || c.nomcli, p.codcli::text))) > 0)
          AND (${numped.length === 0} OR ${algumTermo(numped, Prisma.sql`p.numped::text`)})
          AND (${numrat.length === 0} OR (p.numrat IS NOT NULL AND ${algumTermo(numrat, Prisma.sql`p.numrat::text`)}))
          AND (${codpro.length === 0} OR ${algumTermo(codpro, Prisma.sql`r.codpro::text`)}
               OR (pr.codlev2 IS NOT NULL AND pr.codlev2 <> 0 AND ${algumTermo(codpro, Prisma.sql`pr.codlev2::text`)}))
          AND (${sitped}::int[] IS NULL OR p.sitped = ANY(${sitped}::int[]))
          AND (${modpro}::int[] IS NULL OR pr.modpro = ANY(${modpro}::int[]))
          AND (${de}::date IS NULL OR p.datemi >= ${de}::date)
          AND (${ate}::date IS NULL OR p.datemi <= ${ate}::date)`,
      colunas: [
        col.inteiro("numped", { obrigatoria: true }),
        col.texto("cliente", { obrigatoria: true }),
        col.texto("situacao", { obrigatoria: true }),
        col.texto("numrat"),
        col.texto("consultor"),
        col.texto("proposta"),
        col.texto("modalidade"),
        col.texto("situacaoProposta"),
        col.texto("faturamento"),
        col.decimal("vlrliq"),
        col.texto("obsmot"),
        col.data("datemi", { obrigatoria: true }),
        col.data("datprv"),
        col.texto("pedcli"),
        col.texto("formaPagamento"),
        col.texto("condicaoPagamento"),
      ],
      totais: ["vlrliq"],
      ordemPadrao: Prisma.sql`x."datemi" DESC, x."numped" DESC`,
      pageSizePadrao: 30,
    };
  },
  "pedidos",
);

// Pedidos que passam nos filtros da barra da tela, já com os vínculos resolvidos. É a
// base comum de GET /por-cliente/indice e POST /sincronizar — os dois TÊM que enxergar
// exatamente o mesmo conjunto, senão o contador do botão de sincronizar não bate com o
// que a tela mostra.
async function resolverPedidosFiltrados(req: import("express").Request) {
  const pedidosTodos = await prisma.pedido.findMany({ where: { removidoEmSenior: null } });

  const codclisUnicos = [...new Set(pedidosTodos.map((p) => p.codcli))];
  const clientes = codclisUnicos.length > 0 ? await prisma.cliente.findMany({ where: { codcli: { in: codclisUnicos } } }) : [];
  const clientePorCodcli = new Map(clientes.map((c) => [c.codcli, c]));

  const filtros = lerFiltros(req);
  let pedidos = aplicarFiltros(pedidosTodos, filtros, clientePorCodcli);

  // Mesmo motivo de GET /: precisa da RAT/Proposta resolvida pra filtrar por Nro.
  // Proposta e Modalidade.
  const { ratPorChave, propostaPorChave, consultorPorCodfor } = await resolverRatEProposta(pedidos);
  pedidos = filtrarPorProposta(pedidos, filtros.buscaCodpro, ratPorChave, propostaPorChave);
  pedidos = filtrarPorModalidade(pedidos, filtros.modproFiltro, ratPorChave, propostaPorChave);

  return { pedidos, clientePorCodcli, ratPorChave, propostaPorChave, consultorPorCodfor };
}

// Clientes que batem com os filtros atuais, agregados e ordenados por valor líquido
// somado (maior primeiro) — sem paginação. Usado por POST /sincronizar, que precisa da
// lista INTEIRA de codclis do filtro, não só a da página visível. A tela agrega por conta
// própria a partir do índice, porque os filtros de coluna são client-side.
async function resolverGruposPorCliente(req: import("express").Request) {
  const { pedidos: pedidosFiltrados, clientePorCodcli } = await resolverPedidosFiltrados(req);

  const porClienteMap = new Map<number, { quantidade: number; valorLiquido: number }>();
  for (const p of pedidosFiltrados) {
    const bucket = porClienteMap.get(p.codcli) ?? { quantidade: 0, valorLiquido: 0 };
    bucket.quantidade += 1;
    bucket.valorLiquido += p.vlrliq != null ? Number(p.vlrliq) : 0;
    porClienteMap.set(p.codcli, bucket);
  }

  return [...porClienteMap.entries()]
    .map(([codcli, bucket]) => {
      const cliente = clientePorCodcli.get(codcli);
      return { codcli, nome: cliente ? `${cliente.codcli} - ${cliente.nomcli}` : String(codcli), ...bucket };
    })
    .sort((a, b) => b.valorLiquido - a.valorLiquido);
}

// GET /por-cliente/indice — índice ENXUTO de todos os pedidos que passam nos filtros da
// barra, para a aba "Por Cliente" filtrar por coluna no navegador.
//
// Por que existe: a aba carrega os itens de um cliente só quando o accordion é expandido,
// então o browser não tem como saber os valores distintos de uma coluna, nem recalcular
// "Qtd. Pedidos"/"Valor Líquido" de cada grupo, nem esconder cliente que ficou sem
// resultado. Esse índice dá exatamente isso e nada mais.
//
// Só os campos usados para filtrar e somar — os pedidos de um cliente (ao expandir) vêm de GET /?codcli=, a lista do padrão. Medido em produção: a resposta completa dos
// pedidos daria 7,7 MB, este índice dá 1,7 MB.
pedidosRouter.get("/por-cliente/indice", async (req, res) => {
  try {
    const { pedidos, clientePorCodcli } = await resolverPedidosFiltrados(req);

    const codclisPresentes = [...new Set(pedidos.map((p) => p.codcli))];

    res.json({
      // Nome do cliente vem à parte, uma vez por cliente — repetir em cada pedido
      // engordaria o índice à toa (são 265 clientes pra 12 mil pedidos).
      clientes: codclisPresentes.map((codcli) => {
        const cliente = clientePorCodcli.get(codcli);
        return { codcli, nome: cliente ? `${cliente.codcli} - ${cliente.nomcli}` : String(codcli) };
      }),
      pedidos: pedidos.map((p) => ({
        chave: `${p.codemp}-${p.codfil}-${p.numped}`,
        codcli: p.codcli,
        vlrliq: p.vlrliq != null ? Number(p.vlrliq) : null,
      })),
    });
  } catch (error) {
    handleError(res, error, "indice-por-cliente");
  }
});

// POST /por-cliente/:codcli/sincronizar — puxa do Senior, na hora, todos os pedidos
// deste cliente (ação "Sinc. ERP" da aba Por Cliente), sem esperar o job diário.
//
// Diferente do disparo de sync do painel de administração (syncErp.ts, "fire and
// forget"), aqui a requisição espera o resultado: é uma consulta pequena (um cliente
// só) e a tela precisa do número de pedidos novos/atualizados pra dar o retorno e
// recarregar a lista já com os dados novos.
const sincronizacoesEmAndamento = new Set<number>();

// Estado da sincronização em lote (POST /sincronizar), em memória — o backend roda em
// processo único e o painel de administração (syncErp.ts) já guarda o "em andamento"
// dele do mesmo jeito. Some se o processo reiniciar, e tudo bem: o efeito colateral do
// job (os upserts) é o que importa, o estado aqui é só pra tela acompanhar.
interface StatusSincronizacaoLote {
  emAndamento: boolean;
  totalClientes: number;
  iniciadoEm: string | null;
  concluidoEm: string | null;
  resultado: ResultadoSyncPorCliente | null;
  /** RATs citadas pelos pedidos que faltavam no CaxHub e foram buscadas no Senior (depois dos pedidos). */
  rats: ResultadoSyncRatsFaltantes | null;
  erro: string | null;
}

let statusLote: StatusSincronizacaoLote = {
  emAndamento: false,
  totalClientes: 0,
  iniciadoEm: null,
  concluidoEm: null,
  resultado: null,
  rats: null,
  erro: null,
};

pedidosRouter.post("/por-cliente/:codcli/sincronizar", async (req, res) => {
  const codcli = Number(req.params.codcli);
  if (!Number.isInteger(codcli)) {
    res.status(400).json({ error: "codcli inválido" });
    return;
  }
  if (statusLote.emAndamento) {
    res.status(409).json({ error: "Sincronização do filtro em andamento — aguarde ela terminar" });
    return;
  }
  // Guarda contra duplo clique / duas abas: dois pulls simultâneos do mesmo cliente
  // fariam os mesmos upserts em paralelo à toa.
  if (sincronizacoesEmAndamento.has(codcli)) {
    res.status(409).json({ error: "Sincronização deste cliente já em andamento" });
    return;
  }

  sincronizacoesEmAndamento.add(codcli);
  try {
    const resultado = await runPedidoSyncPorClientes([codcli]);
    // Depois dos pedidos: as RATs que eles citam e ainda não existem aqui (só leitura do Senior; falha de RAT não derruba a resposta).
    const rats = await sincronizarRatsFaltantesDosPedidos([codcli]);
    res.json({ ...resultado, rats });
  } catch (error) {
    handleError(res, error, "sincronizar-cliente");
  } finally {
    sincronizacoesEmAndamento.delete(codcli);
  }
});

// POST /sincronizar — mesma coisa, mas pra TODOS os clientes que batem com os filtros
// atuais (todas as páginas, não só a visível). Recebe os mesmos query params de
// GET /por-cliente.
//
// Aqui, diferente da ação de um cliente só, a requisição NÃO espera o fim: o filtro
// pode pegar centenas de clientes e o nginx da VPS corta requisição parada em 60s
// (deploy/nginx.conf não sobe o proxy_read_timeout). Responde 202 e a tela acompanha
// por GET /sincronizar/status — mesmo padrão "fire and forget" de syncErp.ts.
pedidosRouter.post("/sincronizar", async (req, res) => {
  try {
    if (statusLote.emAndamento) {
      res.status(409).json({ error: "Já existe uma sincronização de filtro em andamento" });
      return;
    }
    if (sincronizacoesEmAndamento.size > 0) {
      res.status(409).json({ error: "Existe sincronização de cliente em andamento — aguarde ela terminar" });
      return;
    }

    const grupos = await resolverGruposPorCliente(req);
    const codclis = grupos.map((g) => g.codcli);
    if (codclis.length === 0) {
      res.status(400).json({ error: "Nenhum cliente bate com os filtros atuais" });
      return;
    }

    statusLote = {
      emAndamento: true,
      totalClientes: codclis.length,
      iniciadoEm: new Date().toISOString(),
      concluidoEm: null,
      resultado: null,
      rats: null,
      erro: null,
    };

    runPedidoSyncPorClientes(codclis)
      .then(async (resultado) => {
        // Só publica o resultado depois da etapa das RATs: a tela olha `emAndamento` e lê os dois juntos.
        const rats = await sincronizarRatsFaltantesDosPedidos(codclis);
        statusLote = { ...statusLote, resultado, rats, erro: null };
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[pedidos:sincronizar-filtro] falhou:", message);
        statusLote = { ...statusLote, resultado: null, rats: null, erro: message };
      })
      .finally(() => {
        statusLote = { ...statusLote, emAndamento: false, concluidoEm: new Date().toISOString() };
      });

    res.status(202).json({ status: "iniciado", totalClientes: codclis.length });
  } catch (error) {
    handleError(res, error, "sincronizar-filtro");
  }
});

// GET /sincronizar/status — acompanhamento do POST /sincronizar. Depois que termina, o
// último resultado continua aqui até a próxima sincronização, pra tela conseguir mostrar
// o desfecho mesmo se o polling perder a virada (ou se a pessoa recarregar a página).
pedidosRouter.get("/sincronizar/status", (_req, res) => {
  res.json({ ...statusLote, clientesEmAndamento: [...sincronizacoesEmAndamento] });
});

// GET /indicadores — KPIs pra aba "Dash": sempre sobre a base inteira, sem aplicar os
// filtros de Cliente/Pedido/Situação da aba Lista (mesmo comportamento de
// /atividades/indicadores em relação aos filtros da lista de Atividades).
pedidosRouter.get("/indicadores", async (_req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({ where: { removidoEmSenior: null } });
    const total = pedidos.length;

    const naoFechados = pedidos.filter((p) => p.sitped === 9).length;
    const abertos = pedidos.filter((p) => p.sitped === 1 || p.sitped === 2).length;
    const comRatVinculada = pedidos.filter((p) => p.numrat != null).length;
    const valorLiquidoTotal = pedidos.reduce((soma, p) => soma + (p.vlrliq != null ? Number(p.vlrliq) : 0), 0);

    const { ratPorChave, propostaPorChave } = await resolverRatEProposta(pedidos);

    let ratsSincronizadasLocalmente = 0;
    const porSituacaoMap = new Map<number, number>();
    const porFaturamentoMap = new Map<number, number>();
    const porFaturamentoRdvMap = new Map<number, number>();
    for (const p of pedidos) {
      porSituacaoMap.set(p.sitped, (porSituacaoMap.get(p.sitped) ?? 0) + 1);

      const rat = p.numrat != null ? ratPorChave.get(`${p.codemp}-${Number(p.numrat)}`) : undefined;
      if (rat) ratsSincronizadasLocalmente += 1;

      const proposta = rat?.codpro != null ? propostaPorChave.get(`${rat.codemp}-${rat.codpro}`) : undefined;
      if (proposta) {
        if (proposta.forfat != null) porFaturamentoMap.set(proposta.forfat, (porFaturamentoMap.get(proposta.forfat) ?? 0) + 1);
        if (proposta.forfatrdv != null)
          porFaturamentoRdvMap.set(proposta.forfatrdv, (porFaturamentoRdvMap.get(proposta.forfatrdv) ?? 0) + 1);
      }
    }

    const codclisUnicos = [...new Set(pedidos.map((p) => p.codcli))];
    const clientes = codclisUnicos.length > 0 ? await prisma.cliente.findMany({ where: { codcli: { in: codclisUnicos } } }) : [];
    const clientePorCodcli = new Map(clientes.map((c) => [c.codcli, c]));
    const porClienteMap = new Map<number, { quantidade: number; valorLiquido: number }>();
    for (const p of pedidos) {
      const bucket = porClienteMap.get(p.codcli) ?? { quantidade: 0, valorLiquido: 0 };
      bucket.quantidade += 1;
      bucket.valorLiquido += p.vlrliq != null ? Number(p.vlrliq) : 0;
      porClienteMap.set(p.codcli, bucket);
    }
    const topClientes = [...porClienteMap.entries()]
      .sort((a, b) => b[1].valorLiquido - a[1].valorLiquido)
      .slice(0, 10)
      .map(([codcli, bucket]) => {
        const cliente = clientePorCodcli.get(codcli);
        return {
          codcli,
          nome: cliente ? `${cliente.codcli} - ${cliente.nomcli}` : String(codcli),
          quantidade: bucket.quantidade,
          valorLiquido: bucket.valorLiquido,
        };
      });

    res.json({
      total,
      naoFechados,
      abertos,
      comRatVinculada,
      ratsSincronizadasLocalmente,
      valorLiquidoTotal,
      porSituacao: [...porSituacaoMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([sitped, quantidade]) => ({ sitped, label: SITPED_LABELS[sitped] ?? `Situação ${sitped}`, tone: sitpedTone(sitped), quantidade })),
      topClientes,
      porFaturamento: [...porFaturamentoMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([forfat, quantidade]) => ({ forfat, label: forfatLabel(forfat), quantidade })),
      porFaturamentoRdv: [...porFaturamentoRdvMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([forfatrdv, quantidade]) => ({ forfatrdv, label: forfatLabel(forfatrdv), quantidade })),
    });
  } catch (error) {
    handleError(res, error, "indicadores");
  }
});
