import { Router } from "express";
import { Pedido } from "@prisma/client";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { sitpedLabel, sitpedTone, SITPED_LABELS } from "../domain/pedidoDominio";
import { forfatLabel } from "../domain/propostasDominio";

// Tela "Mercado > Listar Pedidos" — espelho de E120PED (ver backend/src/sync/pedidoSync.ts).
// Só admin acessa (menu "Mercado" restrito, ver frontend/src/layout/Sidebar.tsx).
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
async function resolverRatEProposta(pedidos: Pedido[]) {
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

  return { ratPorChave, propostaPorChave };
}

// GET / — lista de pedidos, com filtro de cliente (busca livre), número do pedido e
// situação (multi-select). Mesmo padrão de GET /rats: carrega tudo via Prisma, filtra em
// memória, pagina por último — não há regra de visibilidade por usuário aqui (admin vê tudo).
pedidosRouter.get("/", async (req, res) => {
  try {
    let pedidos = await prisma.pedido.findMany({ orderBy: [{ datemi: "desc" }, { numped: "desc" }] });

    const codclisUnicos = [...new Set(pedidos.map((p) => p.codcli))];
    const clientes = codclisUnicos.length > 0 ? await prisma.cliente.findMany({ where: { codcli: { in: codclisUnicos } } }) : [];
    const clientePorCodcli = new Map(clientes.map((c) => [c.codcli, c]));

    const buscaCliente = typeof req.query.cliente === "string" ? req.query.cliente.trim().toLowerCase() : "";
    if (buscaCliente) {
      pedidos = pedidos.filter((p) => {
        const cliente = clientePorCodcli.get(p.codcli);
        const label = cliente ? `${cliente.codcli} - ${cliente.nomcli}` : String(p.codcli);
        return label.toLowerCase().includes(buscaCliente);
      });
    }

    const buscaNumped = typeof req.query.numped === "string" ? req.query.numped.trim() : "";
    if (buscaNumped) {
      pedidos = pedidos.filter((p) => String(p.numped).includes(buscaNumped));
    }

    const sitpedRaw = typeof req.query.sitped === "string" ? req.query.sitped : "";
    // Number("") é 0 (não NaN) — sem essa guarda, ausência do filtro virava sitped=[0]
    // e escondia todos os pedidos.
    const sitpedFiltro = sitpedRaw
      ? sitpedRaw
          .split(",")
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v))
      : [];
    if (sitpedFiltro.length > 0) {
      pedidos = pedidos.filter((p) => sitpedFiltro.includes(p.sitped));
    }

    const total = pedidos.length;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
    const inicioPagina = (page - 1) * pageSize;
    pedidos = pedidos.slice(inicioPagina, inicioPagina + pageSize);

    // Lookups extras (RAT/Proposta) só pra página atual, mesmo padrão de rats.ts.
    const { ratPorChave, propostaPorChave } = await resolverRatEProposta(pedidos);

    res.json({
      total,
      pedidos: pedidos.map((p) => {
        const cliente = clientePorCodcli.get(p.codcli);
        const rat = p.numrat != null ? ratPorChave.get(`${p.codemp}-${Number(p.numrat)}`) : undefined;
        const proposta = rat?.codpro != null ? propostaPorChave.get(`${rat.codemp}-${rat.codpro}`) : undefined;
        return {
          codemp: p.codemp,
          codfil: p.codfil,
          numped: p.numped,
          cliente: cliente ? `${cliente.codcli} - ${cliente.nomcli}` : String(p.codcli),
          datemi: p.datemi,
          datprv: p.datprv,
          obsped: p.obsped,
          pedcli: p.pedcli,
          sitped: p.sitped,
          sitpedLabel: sitpedLabel(p.sitped),
          sitpedTone: sitpedTone(p.sitped),
          numrat: p.numrat != null ? p.numrat.toString() : null,
          propostaCodpro: rat?.codpro ?? null,
          faturamentoLabel: proposta ? forfatLabel(proposta.forfat) : null,
          faturamentoRdvLabel: proposta ? forfatLabel(proposta.forfatrdv) : null,
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// GET /indicadores — KPIs pra aba "Dash": sempre sobre a base inteira, sem aplicar os
// filtros de Cliente/Pedido/Situação da aba Lista (mesmo comportamento de
// /atividades/indicadores em relação aos filtros da lista de Atividades). Sem campo
// monetário em Pedido/Rat/Proposta — os KPIs são contagens e distribuições por
// categoria, não valores.
pedidosRouter.get("/indicadores", async (_req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany();
    const total = pedidos.length;

    const naoFechados = pedidos.filter((p) => p.sitped === 9).length;
    const abertos = pedidos.filter((p) => p.sitped === 1 || p.sitped === 2).length;
    const comRatVinculada = pedidos.filter((p) => p.numrat != null).length;

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
    const porClienteMap = new Map<number, number>();
    for (const p of pedidos) {
      porClienteMap.set(p.codcli, (porClienteMap.get(p.codcli) ?? 0) + 1);
    }
    const topClientes = [...porClienteMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([codcli, quantidade]) => {
        const cliente = clientePorCodcli.get(codcli);
        return { codcli, nome: cliente ? `${cliente.codcli} - ${cliente.nomcli}` : String(codcli), quantidade };
      });

    res.json({
      total,
      naoFechados,
      abertos,
      comRatVinculada,
      ratsSincronizadasLocalmente,
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
