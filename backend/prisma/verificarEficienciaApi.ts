// Verificação ponta a ponta de routes/eficiencia.ts contra o banco local, SÓ LEITURA.
// Sobe um Express mínimo (sem os syncs do server.ts) e usa usuários que já existem.
// Rodar: node_modules/.bin/ts-node --transpile-only prisma/verificarEficienciaApi.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { codforsDoTime, resolverContextoConsultor } from "../src/domain/contextoProjeto";
import { eficienciaRouter } from "../src/routes/eficiencia";

let falhas = 0;
let total = 0;
function confere(nome: string, ok: boolean, detalhe = "") {
  total++;
  if (!ok) {
    falhas++;
    console.error(`FALHOU: ${nome} ${detalhe}`);
  }
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/eficiencia", eficienciaRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/eficiencia`;

  const chamar = async (caminho: string, token?: string) => {
    const r = await fetch(base + caminho, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const corpo = await r.json().catch(() => null);
    return { status: r.status, corpo: corpo as any };
  };

  try {
    // ---- usuários existentes: um admin, um gestor (com time), um sem gestão ----
    const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: "ativo" }, select: { id: true } });
    if (!admin) throw new Error("sem usuário admin no banco local");

    // Gestor = usuário não-admin cujo e-mail casa com um Consultor que consta em DepartamentoGestor.
    const gestores = await prisma.departamentoGestor.findMany();
    let gestor: { userId: number; role: string; email: string; departamentos: number[] } | null = null;
    const gestoresIds = new Set<number>();
    for (const g of gestores) {
      const consultor = await prisma.consultor.findFirst({ where: { codemp: g.codemp, codusu: Number(g.usuges) }, select: { email: true } });
      if (!consultor?.email) continue;
      const user = await prisma.user.findFirst({
        where: { email: { equals: consultor.email, mode: "insensitive" }, status: "ativo" },
        select: { id: true, email: true, role: { select: { name: true } } },
      });
      if (!user || user.role.name === "admin") continue;
      gestoresIds.add(user.id);
      const deps = gestores.filter((x) => x.codemp === g.codemp && Number(x.usuges) === Number(g.usuges)).map((x) => x.depexe);
      if (!gestor || deps.length > gestor.departamentos.length) gestor = { userId: user.id, role: user.role.name, email: user.email, departamentos: deps };
    }
    const semGestaoRow = await prisma.user.findFirst({
      where: { role: { name: { in: ["consultoria", "suporte", "desenvolvimento"] } }, status: "ativo", id: { notIn: [...gestoresIds] } },
      select: { id: true, role: { select: { name: true } } },
    });
    const semGestao = semGestaoRow ? { id: semGestaoRow.id, role: semGestaoRow.role.name } : null;
    console.log(`admin=${admin.id} gestor=${gestor ? `${gestor.userId} (deps ${gestor.departamentos})` : "NENHUM"} semGestao=${semGestao?.id ?? "NENHUM"}`);

    const tAdmin = signToken({ userId: admin.id, role: "admin" });

    // ---- acesso ----
    confere("sem token = 401", (await chamar("/painel")).status === 401);
    if (semGestao) {
      const t = signToken({ userId: semGestao.id, role: semGestao.role });
      confere("usuário sem gestão = 403 no painel", (await chamar("/painel", t)).status === 403);
      confere("usuário sem gestão = 403 no filtro", (await chamar("/filtros", t)).status === 403);
    }

    // ---- admin ----
    let t0 = Date.now();
    const adm = await chamar("/painel?tipo=all", tAdmin);
    console.log(`admin /painel?tipo=all: ${Date.now() - t0} ms`);
    confere("admin /painel = 200", adm.status === 200, JSON.stringify(adm.corpo).slice(0, 200));
    const c = adm.corpo;
    confere("escopo admin", c.meta.escopo === "admin");
    confere("vendido total ≈ 49.208,9 h", Math.abs(c.resumo.vendido / 60 - 49208.9) < 0.5, String(c.resumo.vendido / 60));
    confere("propostas ativas = 292", c.resumo.propostas === 292 && c.propostas.length === 292, String(c.propostas.length));
    confere("soma das linhas = resumo", c.propostas.reduce((t: number, p: any) => t + p.executado, 0) === c.resumo.executado);
    confere("dentro + acima = executado", c.resumo.dentro + c.resumo.acima === c.resumo.executado);
    confere("tendência tem 11-12 meses", c.tendencia.length >= 11 && c.tendencia.every((p: any) => p.dentro <= p.total));
    confere("admin vê apontadoSemItem", c.qualidade.apontadoSemItem != null);
    confere("limiares no payload", c.meta.limiares.estouroMinimoMin === 60);

    const clientesSo = await chamar("/painel?tipo=cli", tAdmin);
    const internas = await chamar("/painel?tipo=int", tAdmin);
    confere("tipo=cli sem interna", clientesSo.corpo.propostas.every((p: any) => !p.interna));
    confere("tipo=int só interna", internas.corpo.propostas.length > 0 && internas.corpo.propostas.every((p: any) => p.interna));
    confere("cli + int = todas", clientesSo.corpo.propostas.length + internas.corpo.propostas.length === 292);

    const exec = await chamar("/painel?tipo=all&sitpro=7", tAdmin);
    confere("sitpro=7 só em execução", exec.corpo.propostas.every((p: any) => p.sitpro === 7));
    confere("sitpro inválido ignorado (volta ao padrão 4,7)", (await chamar("/painel?tipo=all&sitpro=8", tAdmin)).corpo.propostas.length === 292);

    const cap60 = await chamar("/painel?tipo=all&cap=60", tAdmin);
    confere("cap=60 dobra os meses", Math.abs(cap60.corpo.carga.meses - 2 * c.carga.meses) < 0.01, `${cap60.corpo.carga.meses} vs ${c.carga.meses}`);
    confere("cap absurda é limitada (>= 20 h)", (await chamar("/painel?cap=1", tAdmin)).corpo.meta.capacidadeHorasMes === 20);

    // ---- gaveta da proposta e do consultor (admin) ----
    const alvo = c.propostas.find((p: any) => p.itens > 0 && p.executado > 0);
    const det = await chamar(`/propostas/${alvo.codemp}/${alvo.codpro}`, tAdmin);
    confere("detalhe da proposta = 200", det.status === 200);
    confere("detalhe bate com a linha da lista", det.corpo.executado === alvo.executado && det.corpo.vendido === alvo.vendido);
    confere("proposta inexistente = 404", (await chamar("/propostas/1/999999999", tAdmin)).status === 404);
    confere("proposta inválida = 400", (await chamar("/propostas/abc/1", tAdmin)).status === 400);

    const consultor = c.equipe.consultores[0];
    const detC = await chamar(`/consultores/${consultor.codfor}`, tAdmin);
    confere("detalhe do consultor = 200", detC.status === 200, JSON.stringify(detC.corpo).slice(0, 150));
    confere("consultor: itens somam o pendente", detC.corpo.itens.reduce((t: number, i: any) => t + i.pendente, 0) === detC.corpo.pendente);
    confere("consultor inexistente = 404", (await chamar("/consultores/99999999", tAdmin)).status === 404);

    // ---- gestor: recorte por departamento e por time ----
    if (gestor) {
      const tG = signToken({ userId: gestor.userId, role: gestor.role });
      // O time de verdade, pela MESMA função do backend (não pela tabela da tela, que filtra por horas).
      const time = (await codforsDoTime(gestor.role, await resolverContextoConsultor(gestor.email))) as Set<number>;
      console.log(`time do gestor: ${time.size} consultores`);
      t0 = Date.now();
      const g = await chamar("/painel?tipo=all", tG);
      console.log(`gestor /painel?tipo=all: ${Date.now() - t0} ms · ${g.corpo?.propostas?.length} propostas · ${g.corpo?.equipe?.consultores?.length} consultores`);
      confere("gestor /painel = 200", g.status === 200, JSON.stringify(g.corpo).slice(0, 200));
      confere("escopo gestor", g.corpo.meta.escopo === "gestor");
      confere("gestor vê menos que o admin", g.corpo.propostas.length < c.propostas.length);
      confere("propostas do gestor ⊆ propostas do admin", g.corpo.propostas.every((p: any) => c.propostas.some((a: any) => a.codpro === p.codpro)));
      confere("gestor NÃO vê apontadoSemItem", g.corpo.qualidade.apontadoSemItem == null);

      const filtros = await chamar("/filtros", tG);
      confere("filtro de departamento só lista os dele", filtros.corpo.departamentos.every((d: any) => gestor!.departamentos.includes(d.valor)));

      // consultores do gestor ⊆ time; um de fora do time dá 403
      confere("equipe do gestor ⊆ time", g.corpo.equipe.consultores.every((x: any) => time.has(x.codfor)));
      const foraDoTime = c.equipe.consultores.find((x: any) => !time.has(x.codfor));
      if (foraDoTime) {
        const r = await chamar(`/consultores/${foraDoTime.codfor}`, tG);
        confere(`consultor fora do time = 403 (${foraDoTime.nome})`, r.status === 403, String(r.status));
      }
      const dentro = g.corpo.equipe.consultores[0];
      if (dentro) confere("consultor do time = 200", (await chamar(`/consultores/${dentro.codfor}`, tG)).status === 200);

      // proposta fora do escopo dele = 404
      const idsG = new Set<number>(g.corpo.propostas.map((p: any) => p.codpro));
      const fora = c.propostas.find((p: any) => !idsG.has(p.codpro));
      if (fora) confere("proposta fora do escopo = 404", (await chamar(`/propostas/${fora.codemp}/${fora.codpro}`, tG)).status === 404);

      // na gaveta, ninguém de fora do time aparece com nome
      const dentroDoEscopo = g.corpo.propostas.find((p: any) => p.itens > 0 && p.executado > 0);
      if (dentroDoEscopo) {
        const d = await chamar(`/propostas/${dentroDoEscopo.codemp}/${dentroDoEscopo.codpro}`, tG);
        const nomes = d.corpo.itens.flatMap((i: any) => i.consultores.map((x: any) => x.codfor));
        confere("gaveta do gestor: só consultores do time aparecem com nome", nomes.every((f: number) => time.has(f)));
      }
      // ... e a gaveta do admin mostra gente de fora do time do gestor (prova que o recorte é do gestor, não do dado)
      const emTodas = c.propostas.find((p: any) => p.itens > 0 && p.executado > 0 && idsG.has(p.codpro));
      if (emTodas) {
        const da = await chamar(`/propostas/${emTodas.codemp}/${emTodas.codpro}`, tAdmin);
        const dg = await chamar(`/propostas/${emTodas.codemp}/${emTodas.codpro}`, tG);
        const nomeadosAdmin = da.corpo.itens.reduce((t: number, i: any) => t + i.consultores.length, 0);
        const nomeadosGestor = dg.corpo.itens.reduce((t: number, i: any) => t + i.consultores.length, 0);
        confere("gestor nomeia no máximo o que o admin nomeia", nomeadosGestor <= nomeadosAdmin, `${nomeadosGestor} vs ${nomeadosAdmin}`);
        confere("semAlocação do item não muda com o recorte", da.corpo.semAlocacao === dg.corpo.semAlocacao);
      }
    } else {
      console.warn("AVISO: nenhum gestor não-admin com usuário correspondente — pulei os testes de recorte.");
    }
  } finally {
    server.close();
    await prisma.$disconnect();
  }

  console.log(`${total - falhas}/${total} verificações ok`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
