// Paridade da lista de RATs em SQL (domain/ratsListaSql.ts) com o cálculo em JS de GET /rats (routes/rats.ts), sobre TODAS as RATs do
// banco: integração com o Senior, cliente, consultor, itens, minutos e rótulo da situação. Somente leitura.
// Uso: npx ts-node --transpile-only scripts/paridadeIntegracaoRats.ts
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import { buscarItensEIntegracao, buscarPropostasPorChave } from "../src/routes/rats";
import { consultaRatsLista } from "../src/domain/ratsListaSql";
import { sitratLabelEfetivo } from "../src/domain/ratDominio";

async function main() {
  // Os dois modos da consulta (por linha e conjunto) precisam dar o mesmo resultado que o JS.
  for (const conjunto of [false, true]) await comparar(conjunto);
}

async function comparar(conjunto: boolean) {
  const t0 = Date.now();
  const { com, interna } = consultaRatsLista(
    { todas: true, codfor: null, depexes: [] },
    { codfors: [], sitrats: [], busca: "", buscaItem: "", integracao: [] },
    { conjunto },
  );
  const sql = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`${com} SELECT * FROM (${interna}) x`);
  console.log(`== modo ${conjunto ? "conjunto" : "por linha"}
SQL: ${sql.length} RATs em ${Date.now() - t0} ms`);

  const t1 = Date.now();
  const rats = await prisma.rat.findMany({
    select: { id: true, codemp: true, codfor: true, codpro: true, numrat: true, sitrat: true, removidoEmSenior: true },
  });
  const { itensPorRat, integracaoPorRat } = await buscarItensEIntegracao(rats);
  const propostaPorChave = await buscarPropostasPorChave(rats);
  const consultores = await prisma.consultor.findMany({ where: { codfor: { in: [...new Set(rats.map((r) => r.codfor))] } } });
  const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));
  console.log(`JS:  ${rats.length} RATs em ${Date.now() - t1} ms`);

  const porId = new Map(sql.map((l) => [Number(l.id), l]));
  const divergencias: Record<string, { id: number; js: unknown; sql: unknown }[]> = {};
  const anotar = (campo: string, id: number, js: unknown, sqlV: unknown) => {
    if (js === sqlV) return;
    (divergencias[campo] ??= []).push({ id, js, sql: sqlV });
  };
  for (const r of rats) {
    const l = porId.get(r.id);
    if (!l) {
      anotar("faltando no SQL", r.id, "existe", "ausente");
      continue;
    }
    const itens = itensPorRat.get(r.id) ?? [];
    const proposta = r.codpro != null ? propostaPorChave.get(`${r.codemp}-${r.codpro}`) : undefined;
    const consultor = consultorPorCodfor.get(r.codfor);
    anotar("integracao", r.id, integracaoPorRat.get(r.id) ?? "pendente", l.integracao);
    anotar("cliente", r.id, proposta ? `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}` : null, l.cliente);
    anotar("consultorNome", r.id, consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${r.codfor}`, l.consultorNome);
    anotar("totalItens", r.id, itens.length, Number(l.totalItens));
    anotar(
      "totalMinutos",
      r.id,
      itens.reduce((s, i) => s + (i.horini != null && i.horfim != null ? i.horfim - i.horini : 0), 0),
      Number(l.totalMinutos),
    );
    anotar("sitratLabel", r.id, sitratLabelEfetivo(r), l.sitratLabel);
  }
  if (sql.length !== rats.length) console.log(`!! contagem diferente: SQL ${sql.length} x JS ${rats.length}`);
  const campos = Object.keys(divergencias);
  if (campos.length === 0) {
    console.log("PARIDADE OK: nenhuma divergência");
    return;
  }
  for (const c of campos) {
    console.log(`!! ${c}: ${divergencias[c].length} divergência(s). Exemplos:`, JSON.stringify(divergencias[c].slice(0, 5)));
  }
  process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
