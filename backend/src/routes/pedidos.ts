import { Router } from "express";
import { Pedido, Cliente } from "@prisma/client";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { sitpedLabel, sitpedTone, SITPED_LABELS } from "../domain/pedidoDominio";
import { forfatLabel, modproLabel, modproTone, sitproLabel, sitproTone } from "../domain/propostasDominio";
import { runPedidoSyncPorClientes, ResultadoSyncPorCliente } from "../sync/pedidoSync";

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

interface Lookups {
  clientePorCodcli: Map<number, Cliente>;
  ratPorChave: Awaited<ReturnType<typeof resolverRatEProposta>>["ratPorChave"];
  propostaPorChave: Awaited<ReturnType<typeof resolverRatEProposta>>["propostaPorChave"];
  consultorPorCodfor: Awaited<ReturnType<typeof resolverRatEProposta>>["consultorPorCodfor"];
  formaPagamentoPorChave: Awaited<ReturnType<typeof resolverFormaECondicaoPagamento>>["formaPagamentoPorChave"];
  condicaoPagamentoPorChave: Awaited<ReturnType<typeof resolverFormaECondicaoPagamento>>["condicaoPagamentoPorChave"];
}

// Monta a linha de resposta de um pedido com todos os labels/vínculos resolvidos —
// reaproveitada por GET /, GET /por-cliente/:codcli/itens (e qualquer rota futura que
// precise da mesma forma de linha).
function mapearPedido(p: Pedido, lookups: Lookups) {
  const cliente = lookups.clientePorCodcli.get(p.codcli);
  const rat = p.numrat != null ? lookups.ratPorChave.get(`${p.codemp}-${Number(p.numrat)}`) : undefined;
  const proposta = rat?.codpro != null ? lookups.propostaPorChave.get(`${rat.codemp}-${rat.codpro}`) : undefined;
  const consultor = rat ? lookups.consultorPorCodfor.get(rat.codfor) : undefined;
  const formaPagamento = p.codfpg != null ? lookups.formaPagamentoPorChave.get(`${p.codemp}-${p.codfpg}`) : undefined;
  const condicaoPagamento = lookups.condicaoPagamentoPorChave.get(`${p.codemp}-${p.codcpg}`);
  return {
    codemp: p.codemp,
    codfil: p.codfil,
    numped: p.numped,
    cliente: cliente ? `${cliente.codcli} - ${cliente.nomcli}` : String(p.codcli),
    datemi: p.datemi,
    datprv: p.datprv,
    obsped: p.obsped,
    obsmot: p.obsmot,
    vlrliq: p.vlrliq != null ? Number(p.vlrliq) : null,
    pedcli: p.pedcli,
    sitped: p.sitped,
    sitpedLabel: sitpedLabel(p.sitped),
    sitpedTone: sitpedTone(p.sitped),
    numrat: p.numrat != null ? p.numrat.toString() : null,
    // Id local da RAT vinculada (PK de Rat, não o numrat do Senior) — usado pra linkar
    // pra tela de visualização da RAT (frontend/src/pages/projetos/RatVisualizacao.tsx).
    ratId: rat?.id ?? null,
    // Nome do consultor executor da RAT vinculada — só existe quando há RAT (rat != null).
    consultorNome: rat ? (consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${rat.codfor}`) : null,
    propostaCodpro: rat?.codpro ?? null,
    propostaCodlev2: proposta?.codlev2 ?? null,
    propostaModproLabel: proposta ? modproLabel(proposta.modpro) : null,
    propostaModproTone: proposta ? modproTone(proposta.modpro) : null,
    propostaSitproLabel: proposta ? sitproLabel(proposta.sitpro) : null,
    propostaSitproTone: proposta ? sitproTone(proposta.sitpro) : null,
    faturamentoLabel: proposta ? forfatLabel(proposta.forfat) : null,
    formaPagamentoLabel: formaPagamento?.desfpg ?? null,
    condicaoPagamentoLabel: condicaoPagamento?.descpg ?? null,
  };
}

// GET / — lista de pedidos, com filtro de cliente (busca livre), número do pedido,
// número da RAT, número da proposta e situação (multi-select). Mesmo padrão de
// GET /rats: carrega tudo via Prisma, filtra em memória, pagina por último — não há
// regra de visibilidade por usuário aqui (admin vê tudo).
pedidosRouter.get("/", async (req, res) => {
  try {
    let pedidos = await prisma.pedido.findMany({
      where: { removidoEmSenior: null },
      orderBy: [{ datemi: "desc" }, { numped: "desc" }],
    });

    const codclisUnicos = [...new Set(pedidos.map((p) => p.codcli))];
    const clientes = codclisUnicos.length > 0 ? await prisma.cliente.findMany({ where: { codcli: { in: codclisUnicos } } }) : [];
    const clientePorCodcli = new Map(clientes.map((c) => [c.codcli, c]));

    const filtros = lerFiltros(req);
    pedidos = aplicarFiltros(pedidos, filtros, clientePorCodcli);

    // RAT/Proposta/Consultor resolvidos ANTES da paginação (não só na página atual) —
    // precisa disso pra saber se um pedido bate com o filtro de Nro. Proposta antes de
    // paginar. Roda sobre o conjunto já reduzido pelos filtros "baratos" acima
    // (cliente/pedido/RAT/situação), não a base inteira sem filtro nenhum.
    const { ratPorChave, propostaPorChave, consultorPorCodfor } = await resolverRatEProposta(pedidos);
    pedidos = filtrarPorProposta(pedidos, filtros.buscaCodpro, ratPorChave, propostaPorChave);
    pedidos = filtrarPorModalidade(pedidos, filtros.modproFiltro, ratPorChave, propostaPorChave);

    const total = pedidos.length;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
    const inicioPagina = (page - 1) * pageSize;
    pedidos = pedidos.slice(inicioPagina, inicioPagina + pageSize);

    // Forma/Condição de Pagamento só pra página atual, mesmo padrão de rats.ts.
    const { formaPagamentoPorChave, condicaoPagamentoPorChave } = await resolverFormaECondicaoPagamento(pedidos);
    const lookups: Lookups = {
      clientePorCodcli,
      ratPorChave,
      propostaPorChave,
      consultorPorCodfor,
      formaPagamentoPorChave,
      condicaoPagamentoPorChave,
    };

    res.json({
      total,
      pedidos: pedidos.map((p) => mapearPedido(p, lookups)),
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// Clientes que batem com os filtros atuais, agregados e ordenados por valor líquido
// somado (maior primeiro) — sem paginação. Usado tanto por GET /por-cliente (que pagina
// o resultado) quanto por POST /sincronizar (que precisa da lista INTEIRA de codclis do
// filtro, não só a da página visível).
async function resolverGruposPorCliente(req: import("express").Request) {
  const pedidosTodos = await prisma.pedido.findMany({ where: { removidoEmSenior: null } });

  const codclisUnicos = [...new Set(pedidosTodos.map((p) => p.codcli))];
  const clientes = codclisUnicos.length > 0 ? await prisma.cliente.findMany({ where: { codcli: { in: codclisUnicos } } }) : [];
  const clientePorCodcli = new Map(clientes.map((c) => [c.codcli, c]));

  const filtros = lerFiltros(req);
  let pedidosFiltrados = aplicarFiltros(pedidosTodos, filtros, clientePorCodcli);

  // Mesmo motivo de GET /: precisa da RAT/Proposta resolvida pra filtrar por Nro.
  // Proposta e Modalidade.
  const { ratPorChave, propostaPorChave } = await resolverRatEProposta(pedidosFiltrados);
  pedidosFiltrados = filtrarPorProposta(pedidosFiltrados, filtros.buscaCodpro, ratPorChave, propostaPorChave);
  pedidosFiltrados = filtrarPorModalidade(pedidosFiltrados, filtros.modproFiltro, ratPorChave, propostaPorChave);

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

// GET /por-cliente — mesmos filtros de GET /, mas agrupado por cliente, ordenado por
// valor líquido somado (maior primeiro). Paginação é por cliente, não por pedido.
pedidosRouter.get("/por-cliente", async (req, res) => {
  try {
    const grupos = await resolverGruposPorCliente(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
    const inicioPagina = (page - 1) * pageSize;

    res.json({ total: grupos.length, clientes: grupos.slice(inicioPagina, inicioPagina + pageSize) });
  } catch (error) {
    handleError(res, error, "por-cliente");
  }
});

// GET /por-cliente/:codcli/itens — pedidos de um cliente específico, sob os mesmos
// filtros de Pedido/Situação/RAT (não de Cliente, que já é o :codcli do path). Sem
// paginação, mesmo padrão de GET /rats/:id/itens — mostra tudo do grupo já filtrado.
pedidosRouter.get("/por-cliente/:codcli/itens", async (req, res) => {
  try {
    const codcli = Number(req.params.codcli);
    if (!Number.isFinite(codcli)) {
      res.status(400).json({ error: "codcli inválido" });
      return;
    }

    let pedidos = await prisma.pedido.findMany({
      where: { codcli, removidoEmSenior: null },
      orderBy: [{ datemi: "desc" }, { numped: "desc" }],
    });

    const cliente = await prisma.cliente.findUnique({ where: { codcli } });
    const clientePorCodcli = new Map(cliente ? [[cliente.codcli, cliente]] : []);

    const filtros = lerFiltros(req);
    pedidos = aplicarFiltros(pedidos, filtros, clientePorCodcli, { comCliente: false });

    const { ratPorChave, propostaPorChave, consultorPorCodfor } = await resolverRatEProposta(pedidos);
    pedidos = filtrarPorProposta(pedidos, filtros.buscaCodpro, ratPorChave, propostaPorChave);
    pedidos = filtrarPorModalidade(pedidos, filtros.modproFiltro, ratPorChave, propostaPorChave);

    const { formaPagamentoPorChave, condicaoPagamentoPorChave } = await resolverFormaECondicaoPagamento(pedidos);
    const lookups: Lookups = {
      clientePorCodcli,
      ratPorChave,
      propostaPorChave,
      consultorPorCodfor,
      formaPagamentoPorChave,
      condicaoPagamentoPorChave,
    };

    res.json({ itens: pedidos.map((p) => mapearPedido(p, lookups)) });
  } catch (error) {
    handleError(res, error, "por-cliente-itens");
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
  erro: string | null;
}

let statusLote: StatusSincronizacaoLote = {
  emAndamento: false,
  totalClientes: 0,
  iniciadoEm: null,
  concluidoEm: null,
  resultado: null,
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
    res.json(resultado);
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
      erro: null,
    };

    runPedidoSyncPorClientes(codclis)
      .then((resultado) => {
        statusLote = { ...statusLote, resultado, erro: null };
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[pedidos:sincronizar-filtro] falhou:", message);
        statusLote = { ...statusLote, resultado: null, erro: message };
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
