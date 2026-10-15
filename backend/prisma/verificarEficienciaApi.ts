// Verificação ponta a ponta de routes/eficiencia.ts contra o banco local.
// Sobe um Express mínimo (sem os syncs do server.ts) e usa usuários que já existem.
// A parte de exclusão de apontamento GRAVA no banco local; tudo o que o script cria é apagado no `finally`.
// Rodar: node_modules/.bin/ts-node --transpile-only prisma/verificarEficienciaApi.ts
import "dotenv/config";
import express from "express";
import { Prisma } from "@prisma/client";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { codforsDoTime, resolverContextoConsultor } from "../src/domain/contextoProjeto";
import { eficienciaRouter } from "../src/routes/eficiencia";
import { hojeIso } from "../src/domain/eficienciaAcoes";
import { avisarAcoesVencidas } from "../src/sync/acoesEficienciaVencidas";

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

  const chamar = async (caminho: string, token?: string, opcoes: { method?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opcoes.body !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(base + caminho, { method: opcoes.method ?? "GET", headers, body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined });
    const corpo = await r.json().catch(() => null);
    return { status: r.status, corpo: corpo as any };
  };

  // Tudo o que o script gravar fica registrado aqui pra ser apagado no finally (mesmo se uma verificação falhar).
  const inicio = new Date();
  const ratItensTocados = new Set<number>();
  const acoesCriadas = new Set<number>();

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
    // Referência calculada NA HORA direto das tabelas (e não números fixos): o script passa em qualquer banco.
    const [ref] = await prisma.$queryRaw<{ propostas: number; vendido: number }[]>`
      SELECT COUNT(DISTINCT (p.codemp, p.codpro))::int AS propostas, COALESCE(SUM(pi.qtdhor), 0)::int AS vendido
      FROM propostas p
      JOIN propostas_itens pi ON pi.codemp = p.codemp AND pi.codpro = p.codpro AND pi.removido_em_senior IS NULL
      WHERE p.removido_em_senior IS NULL AND p.sitpro IN (4, 7)`;
    console.log(`referência no banco: ${ref.propostas} propostas, ${(ref.vendido / 60).toFixed(1)} h vendidas`);
    confere("vendido total = soma direta dos itens (sitpro 4/7)", c.resumo.vendido === ref.vendido, `${c.resumo.vendido} vs ${ref.vendido}`);
    confere("propostas ativas = contagem direta", c.resumo.propostas === ref.propostas && c.propostas.length === ref.propostas, `${c.propostas.length} vs ${ref.propostas}`);
    confere("soma das linhas = resumo", c.propostas.reduce((t: number, p: any) => t + p.executado, 0) === c.resumo.executado);
    confere("dentro + acima = executado", c.resumo.dentro + c.resumo.acima === c.resumo.executado);
    confere("tendência tem 11-12 meses", c.tendencia.length >= 11 && c.tendencia.every((p: any) => p.dentro <= p.total));
    confere("admin vê apontadoSemItem", c.qualidade.apontadoSemItem != null);
    confere("limiares no payload", c.meta.limiares.estouroMinimoMin === 60);

    const clientesSo = await chamar("/painel?tipo=cli", tAdmin);
    const internas = await chamar("/painel?tipo=int", tAdmin);
    confere("tipo=cli sem interna", clientesSo.corpo.propostas.every((p: any) => !p.interna));
    confere("tipo=int só interna", internas.corpo.propostas.length > 0 && internas.corpo.propostas.every((p: any) => p.interna));
    confere("cli + int = todas", clientesSo.corpo.propostas.length + internas.corpo.propostas.length === ref.propostas);

    const exec = await chamar("/painel?tipo=all&sitpro=7", tAdmin);
    confere("sitpro=7 só em execução", exec.corpo.propostas.every((p: any) => p.sitpro === 7));
    confere("sitpro inválido ignorado (volta ao padrão 4,7)", (await chamar("/painel?tipo=all&sitpro=8", tAdmin)).corpo.propostas.length === ref.propostas);

    // ---- filtros de sistema e de cliente ----
    const filtrosAdmin = await chamar("/filtros", tAdmin);
    confere("/filtros devolve modalidades e clientes (e não mais sistemas)", filtrosAdmin.corpo.modalidades?.length > 0 && filtrosAdmin.corpo.clientes?.length > 0 && filtrosAdmin.corpo.sistemas === undefined);
    confere("clientes das opções são os das propostas ativas, sem repetir", (() => {
      const ids = filtrosAdmin.corpo.clientes.map((x: any) => x.valor);
      const dosDados = new Set(c.propostas.map((p: any) => p.codcli));
      return new Set(ids).size === ids.length && [...dosDados].every((id) => ids.includes(id));
    })());
    const mod = c.propostas.find((p: any) => p.modpro != null)?.modpro;
    if (mod != null) {
      const porMod = await chamar(`/painel?tipo=all&modpro=${mod}`, tAdmin);
      confere("modpro: só propostas da modalidade escolhida", porMod.corpo.propostas.length > 0 && porMod.corpo.propostas.every((p: any) => p.modpro === mod));
      confere("modpro: o total bate com as linhas da mesma modalidade na carteira cheia", porMod.corpo.propostas.length === c.propostas.filter((p: any) => p.modpro === mod).length);
      confere("a linha traz o rótulo da modalidade", typeof porMod.corpo.propostas[0].modproRotulo === "string" && porMod.corpo.propostas[0].modproRotulo.length > 0);
    }
    const cli1 = filtrosAdmin.corpo.clientes[0].valor;
    const cli2 = filtrosAdmin.corpo.clientes[1]?.valor;
    const porCli = await chamar(`/painel?tipo=all&codcli=${cli1}`, tAdmin);
    confere("codcli: só propostas do cliente escolhido", porCli.status === 200 && porCli.corpo.propostas.length > 0 && porCli.corpo.propostas.every((p: any) => p.codcli === cli1));
    confere("codcli: a carteira e o resumo encolhem para só esse cliente", porCli.corpo.resumo.vendido === c.propostas.filter((p: any) => p.codcli === cli1).reduce((t: number, p: any) => t + p.vendido, 0) && porCli.corpo.clientes.length === 1);
    if (cli2 != null) {
      const porDois = await chamar(`/painel?tipo=all&codcli=${cli1},${cli2}`, tAdmin);
      confere("codcli: vários clientes somam", porDois.corpo.propostas.length === c.propostas.filter((p: any) => p.codcli === cli1 || p.codcli === cli2).length && porDois.corpo.clientes.length <= 2);
    }
    confere("codcli inexistente = carteira vazia, sem erro", (await chamar("/painel?tipo=all&codcli=999999999", tAdmin)).corpo.propostas.length === 0);
    confere("codcli com lixo é ignorado (volta à carteira inteira)", (await chamar("/painel?tipo=all&codcli=abc", tAdmin)).corpo.propostas.length === c.propostas.length);
    confere("o filtro de cliente também vale pra tendência (não passa do total)", porCli.corpo.tendencia.reduce((t: number, p: any) => t + p.total, 0) <= c.tendencia.reduce((t: number, p: any) => t + p.total, 0));

    // ---- filtro de departamento recorta a EQUIPE ao time dele (como o líder só vê o time dele) ----
    // Escolhe um departamento que tenha time e que apareça entre as propostas.
    let depTeste: { depexe: number; time: Set<number> } | null = null;
    for (const d of filtrosAdmin.corpo.departamentos) {
      const time = new Set<number>((await prisma.departamentoTime.findMany({ where: { depexe: d.valor, sitreg: "A" }, select: { codusu: true, codemp: true } }).then(async (linhas) => {
        const cons = linhas.length ? await prisma.consultor.findMany({ where: { OR: linhas.map((l) => ({ codemp: l.codemp, codusu: Number(l.codusu) })), codfor: { not: null } }, select: { codfor: true } }) : [];
        return cons.map((x) => x.codfor as number);
      })));
      if (time.size > 0) {
        const t = await chamar(`/painel?tipo=all&depexe=${d.valor}`, tAdmin);
        if (t.corpo.equipe.consultores.length > 0 && t.corpo.equipe.consultores.length < c.equipe.consultores.length) {
          depTeste = { depexe: d.valor, time };
          break;
        }
      }
    }
    confere("achei um departamento com time menor que a equipe toda para testar o recorte", depTeste != null);
    if (depTeste) {
      const dt = depTeste;
      const comDep = await chamar(`/painel?tipo=all&depexe=${dt.depexe}`, tAdmin);
      confere("depexe: a Equipe só traz consultores do time do departamento", comDep.corpo.equipe.consultores.every((x: any) => dt.time.has(x.codfor)));
      confere("depexe: o mapa de alocação também", comDep.corpo.equipe.mapa.consultores.every((x: any) => dt.time.has(x.codfor)));
      confere("depexe: a equipe encolhe em relação à carteira toda", comDep.corpo.equipe.consultores.length < c.equipe.consultores.length);
      confere("depexe: alertas de capacidade só falam de gente do time", comDep.corpo.alertas.filter((a: any) => a.alvo.tipo === "consultor").every((a: any) => dt.time.has(a.alvo.codfor)));
      confere("depexe: a carga pendente total só cai (nunca sobe)", comDep.corpo.carga.pendente <= c.carga.pendente);
      confere("depexe: o executado das propostas NÃO muda por causa do recorte de equipe (só as propostas são recortadas)", comDep.corpo.resumo.executado <= c.resumo.executado);
      const semFiltroDeNovo = await chamar("/painel?tipo=all", tAdmin);
      confere("sem departamento a equipe volta a ser a toda", semFiltroDeNovo.corpo.equipe.consultores.length === c.equipe.consultores.length);
      // Departamento sem time: equipe vazia, sem erro.
      confere("depexe inexistente: equipe vazia, sem erro", (await chamar("/painel?tipo=all&depexe=987654", tAdmin)).corpo.equipe.consultores.length === 0);
    }

    // ---- ignorar propostas dos cálculos (check na lista; escolha pessoal, nada gravado no servidor) ----
    const at = c.qualidade.atipicas;
    confere("o parâmetro de atípicas e o aviso de atípicas saíram do payload", c.meta.atipicas === undefined);
    confere("cada linha da lista traz ignorada=false por padrão e a marca de atípica", c.propostas.every((p: any) => p.ignorada === false && typeof p.atipica === "boolean"));
    confere("a marca de atípica bate com a lista da Qualidade", c.propostas.filter((p: any) => p.atipica).length === at.length && at.every((a: any) => c.propostas.find((p: any) => p.codpro === a.codpro)?.atipica === true));
    // Ignora a maior proposta em estouro (e uma segunda, se houver) e confere que tudo o que é conta sai, mas a linha fica.
    const ordenadas = [...c.propostas].sort((a: any, b: any) => b.acima - a.acima);
    const alvo1 = ordenadas[0];
    const alvo2 = ordenadas[1];
    const ign = (...ps: any[]) => `&ignorar=${ps.map((p) => `${p.codemp}:${p.codpro}`).join(",")}`;
    const ig1 = await chamar(`/painel?tipo=all${ign(alvo1)}`, tAdmin);
    confere("ignorar = 200", ig1.status === 200, JSON.stringify(ig1.corpo).slice(0, 120));
    confere("a proposta ignorada CONTINUA na lista, marcada, pra poder desmarcar", ig1.corpo.propostas.length === c.propostas.length && ig1.corpo.propostas.find((p: any) => p.codpro === alvo1.codpro)?.ignorada === true);
    confere("só ela vem marcada", ig1.corpo.propostas.filter((p: any) => p.ignorada).length === 1);
    confere("o resumo perde exatamente o vendido e o executado dela", ig1.corpo.resumo.vendido === c.resumo.vendido - alvo1.vendido && ig1.corpo.resumo.executado === c.resumo.executado - alvo1.executado && ig1.corpo.resumo.propostas === c.resumo.propostas - 1, `${ig1.corpo.resumo.executado} vs ${c.resumo.executado - alvo1.executado}`);
    confere("o estouro da carteira cai o estouro dela", ig1.corpo.resumo.acima === c.resumo.acima - alvo1.acima);
    confere("ela some do pareto, dos alertas de proposta e dos clientes", !ig1.corpo.pareto.linhas.some((l: any) => l.codpro === alvo1.codpro) && !ig1.corpo.alertas.some((a: any) => a.alvo.tipo === "proposta" && a.alvo.codpro === alvo1.codpro) && ig1.corpo.clientes.reduce((t: number, x: any) => t + x.propostas, 0) === c.clientes.reduce((t: number, x: any) => t + x.propostas, 0) - 1);
    confere("a tendência não aumenta", ig1.corpo.tendencia.reduce((t: number, p: any) => t + p.total, 0) <= c.tendencia.reduce((t: number, p: any) => t + p.total, 0));
    confere("a equipe também não passa da original (carga e executado só caem)", ig1.corpo.carga.pendente <= c.carga.pendente && ig1.corpo.equipe.consultores.every((x: any) => x.executado <= (c.equipe.consultores.find((y: any) => y.codfor === x.codfor)?.executado ?? 0)));
    if (alvo2) {
      const ig2 = await chamar(`/painel?tipo=all${ign(alvo1, alvo2)}`, tAdmin);
      confere("ignorar duas propostas: o resumo perde as duas", ig2.corpo.resumo.propostas === c.resumo.propostas - 2 && ig2.corpo.resumo.executado === c.resumo.executado - alvo1.executado - alvo2.executado);
    }
    confere("a aba Qualidade marca a atípica ignorada (e segue listando)", (() => {
      const atipIgn = at.find((a: any) => a.codpro === alvo1.codpro);
      if (!atipIgn) return true; // a maior em estouro pode não ser atípica; nada a conferir
      return ig1.corpo.qualidade.atipicas.find((a: any) => a.codpro === alvo1.codpro)?.ignorada === true;
    })());
    confere("ignorar proposta inexistente / lixo é ignorado sem erro", (await chamar("/painel?tipo=all&ignorar=999:999999,abc,1:,:2,1:2:3", tAdmin)).corpo.propostas.length === c.propostas.length);
    confere("sem o parâmetro, volta tudo", (await chamar("/painel?tipo=all", tAdmin)).corpo.resumo.executado === c.resumo.executado);
    confere("a gaveta da proposta NÃO é afetada por ignorar (mostra o que a proposta tem)", (await chamar(`/propostas/${alvo1.codemp}/${alvo1.codpro}`, tAdmin)).corpo.executado === alvo1.executado);

    // ---- ignorar consultores dos indicadores da equipe (mesmo estilo: escolha pessoal, só reflete na equipe) ----
    confere("cada consultor da lista vem com ignorado=false por padrão", c.equipe.consultores.length > 0 && c.equipe.consultores.every((x: any) => x.ignorado === false));
    const eq0 = [...c.equipe.consultores].sort((a: any, b: any) => b.pendente - a.pendente || b.executado - a.executado);
    const cons1 = eq0[0];
    const cons2 = eq0[1];
    const ic1 = await chamar(`/painel?tipo=all&ignorarConsultor=${cons1.codfor}`, tAdmin);
    confere("ignorar consultor = 200", ic1.status === 200, JSON.stringify(ic1.corpo).slice(0, 120));
    confere("ele CONTINUA na lista, marcado, com os números reais (pra poder desmarcar)", (() => {
      const l = ic1.corpo.equipe.consultores.find((x: any) => x.codfor === cons1.codfor);
      return !!l && l.ignorado === true && l.executado === cons1.executado && l.pendente === cons1.pendente && l.eficiencia === cons1.eficiencia;
    })());
    confere("só ele vem marcado e a lista tem o mesmo tamanho", ic1.corpo.equipe.consultores.filter((x: any) => x.ignorado).length === 1 && ic1.corpo.equipe.consultores.length === c.equipe.consultores.length);
    confere("a carga pendente perde exatamente a dele", ic1.corpo.carga.pendente === c.carga.pendente - cons1.pendente, `${ic1.corpo.carga.pendente} vs ${c.carga.pendente - cons1.pendente}`);
    confere("a alocação a revisar perde exatamente a dele", ic1.corpo.carga.revisar === c.carga.revisar - cons1.revisar);
    confere("os consultores em sobrecarga só caem", ic1.corpo.carga.consultoresEmSobrecarga <= c.carga.consultoresEmSobrecarga);
    confere("ele sai do mapa de alocação", !ic1.corpo.equipe.mapa.consultores.some((x: any) => x.codfor === cons1.codfor) && !ic1.corpo.equipe.mapa.celulas.some((x: any) => x.codfor === cons1.codfor));
    confere("os alertas de capacidade não citam mais o consultor ignorado", !ic1.corpo.alertas.some((a: any) => a.alvo?.tipo === "consultor" && a.alvo.codfor === cons1.codfor));
    confere("as horas das PROPOSTAS não mudam (resumo, lista, clientes e tendência iguais)", ic1.corpo.resumo.vendido === c.resumo.vendido && ic1.corpo.resumo.executado === c.resumo.executado && ic1.corpo.resumo.acima === c.resumo.acima && ic1.corpo.propostas.length === c.propostas.length && ic1.corpo.propostas.every((x: any, i: number) => x.executado === c.propostas[i].executado && x.semAlocacao === c.propostas[i].semAlocacao) && JSON.stringify(ic1.corpo.tendencia) === JSON.stringify(c.tendencia));
    confere("os OUTROS consultores não mudam", c.equipe.consultores.filter((x: any) => x.codfor !== cons1.codfor).every((x: any) => {
      const n = ic1.corpo.equipe.consultores.find((y: any) => y.codfor === x.codfor);
      return !!n && n.executado === x.executado && n.pendente === x.pendente && n.revisar === x.revisar && n.ignorado === false;
    }));
    if (cons2) {
      const ic2 = await chamar(`/painel?tipo=all&ignorarConsultor=${cons1.codfor},${cons2.codfor}`, tAdmin);
      confere("ignorar dois consultores: a carga perde as duas", ic2.corpo.carga.pendente === c.carga.pendente - cons1.pendente - cons2.pendente && ic2.corpo.equipe.consultores.filter((x: any) => x.ignorado).length === 2);
    }
    const combinado = await chamar(`/painel?tipo=all${ign(alvo1)}&ignorarConsultor=${cons1.codfor}`, tAdmin);
    confere("proposta E consultor ignorados juntos: resumo perde a proposta e a carga perde o consultor", combinado.corpo.resumo.executado === c.resumo.executado - alvo1.executado && combinado.corpo.equipe.consultores.find((x: any) => x.codfor === cons1.codfor)?.ignorado === true && combinado.corpo.carga.pendente <= ig1.corpo.carga.pendente);
    confere("codfor com lixo / inexistente é ignorado sem erro e sem marcar ninguém", (await chamar("/painel?tipo=all&ignorarConsultor=abc,-1,0,99999999,1.5", tAdmin)).corpo.equipe.consultores.every((x: any) => x.ignorado === false));
    confere("sem o parâmetro, volta tudo", (await chamar("/painel?tipo=all", tAdmin)).corpo.carga.pendente === c.carga.pendente);
    confere("a gaveta do consultor NÃO é afetada por ignorar", (await chamar(`/consultores/${cons1.codfor}`, tAdmin)).status === 200);

    // ---- ignorar item e consultor DENTRO da proposta (gaveta): reflete na proposta, na lista e na carteira ----
    {
      const alvoG = c.propostas.filter((p: any) => p.itens >= 2 && p.executado > 0).sort((a: any, b: any) => b.executado - a.executado)[0];
      if (!alvoG) {
        console.warn("AVISO: sem proposta com 2+ itens e horas — pulei os testes de ignorar dentro da proposta.");
      } else {
        const base = `/propostas/${alvoG.codemp}/${alvoG.codpro}`;
        const g0 = await chamar(base, tAdmin);
        confere("gaveta traz a lista de consultores, itens com ignorado=false e nada em semIgnorar", Array.isArray(g0.corpo.consultores) && g0.corpo.itens.every((i: any) => i.ignorado === false) && g0.corpo.semIgnorar === null && g0.corpo.ignorados.itens === 0 && g0.corpo.ignorados.consultores === 0);
        const somaConsultores = g0.corpo.consultores.reduce((t: number, x: any) => t + x.executado, 0) + g0.corpo.outrosConsultores.executado;
        confere("a soma das horas dos consultores bate com o executado da proposta (±1 min por item de arredondamento)", Math.abs(somaConsultores - g0.corpo.executado) <= g0.corpo.itens.length, `${somaConsultores} vs ${g0.corpo.executado}`);
        confere("consultores vêm ordenados por horas e todos com horas > 0 ou ignorados", g0.corpo.consultores.every((x: any, i: number, a: any[]) => i === 0 || a[i - 1].executado >= x.executado));

        // --- item ---
        const itemAlvo = [...g0.corpo.itens].sort((a: any, b: any) => b.executado - a.executado)[0];
        const qItem = `ignorarItem=${alvoG.codemp}:${alvoG.codpro}:${itemAlvo.seqite}`;
        const g1 = await chamar(`${base}?${qItem}`, tAdmin);
        confere("ignorar item = 200 e o item CONTINUA na lista, marcado, com os números reais", g1.status === 200 && g1.corpo.itens.find((i: any) => i.seqite === itemAlvo.seqite)?.ignorado === true && g1.corpo.itens.find((i: any) => i.seqite === itemAlvo.seqite)?.executado === itemAlvo.executado);
        confere("o topo perde o vendido e o executado do item", g1.corpo.vendido === g0.corpo.vendido - itemAlvo.vendido && g1.corpo.executado === g0.corpo.executado - itemAlvo.executado, `${g1.corpo.executado} vs ${g0.corpo.executado - itemAlvo.executado}`);
        confere("semIgnorar guarda os números de antes e ignorados.itens = 1", g1.corpo.semIgnorar?.executado === g0.corpo.executado && g1.corpo.semIgnorar?.vendido === g0.corpo.vendido && g1.corpo.ignorados.itens === 1);
        const p1 = await chamar(`/painel?tipo=all&${qItem}`, tAdmin);
        const l1 = p1.corpo.propostas.find((p: any) => p.codpro === alvoG.codpro);
        confere("a lista de propostas reflete o item ignorado", l1.executado === alvoG.executado - itemAlvo.executado && l1.vendido === alvoG.vendido - itemAlvo.vendido && l1.itens === alvoG.itens - 1, `${l1.executado} vs ${alvoG.executado - itemAlvo.executado}`);
        confere("a carteira perde exatamente o item", p1.corpo.resumo.executado === c.resumo.executado - itemAlvo.executado && p1.corpo.resumo.vendido === c.resumo.vendido - itemAlvo.vendido);
        confere("o painel informa quantos itens estão ignorados", p1.corpo.meta.ignoradosNaProposta.itens === 1 && p1.corpo.meta.ignoradosNaProposta.consultores === 0);
        confere("a tendência não aumenta", p1.corpo.tendencia.reduce((t: number, x: any) => t + x.total, 0) <= c.tendencia.reduce((t: number, x: any) => t + x.total, 0));

        // --- consultor na proposta ---
        const consAlvo = g0.corpo.consultores.find((x: any) => x.executado > 0);
        if (!consAlvo) {
          console.warn("AVISO: proposta sem consultor visível com horas — pulei o teste de ignorar consultor na proposta.");
        } else {
          const qCons = `ignorarConsultorProposta=${alvoG.codemp}:${alvoG.codpro}:${consAlvo.codfor}`;
          const g2 = await chamar(`${base}?${qCons}`, tAdmin);
          confere("ignorar consultor = 200 e ele CONTINUA na aba, marcado, com as horas reais", g2.status === 200 && g2.corpo.consultores.find((x: any) => x.codfor === consAlvo.codfor)?.ignorado === true && g2.corpo.consultores.find((x: any) => x.codfor === consAlvo.codfor)?.executado === consAlvo.executado);
          const esperado = Math.max(0, g0.corpo.executado - consAlvo.executado);
          confere("o executado da proposta perde as horas dele (±1 min por item)", Math.abs(g2.corpo.executado - esperado) <= g0.corpo.itens.length, `${g2.corpo.executado} vs ${esperado}`);
          confere("o vendido não muda e os outros consultores ficam como estavam", g2.corpo.vendido === g0.corpo.vendido && g0.corpo.consultores.filter((x: any) => x.codfor !== consAlvo.codfor).every((x: any) => g2.corpo.consultores.find((y: any) => y.codfor === x.codfor)?.executado === x.executado));
          confere("ignorados.consultores = 1 e semIgnorar preenchido", g2.corpo.ignorados.consultores === 1 && g2.corpo.semIgnorar?.executado === g0.corpo.executado);
          confere("ele sai das linhas por item (equipe da proposta)", !g2.corpo.itens.some((i: any) => i.consultores.some((x: any) => x.codfor === consAlvo.codfor)));
          const p2 = await chamar(`/painel?tipo=all&${qCons}`, tAdmin);
          const l2 = p2.corpo.propostas.find((p: any) => p.codpro === alvoG.codpro);
          confere("a lista e a carteira refletem o consultor ignorado na proposta", Math.abs(l2.executado - esperado) <= alvoG.itens && p2.corpo.resumo.executado < c.resumo.executado || consAlvo.executado === 0);
          confere("o painel informa o consultor ignorado", p2.corpo.meta.ignoradosNaProposta.consultores === 1);
          confere("ele continua na lista da aba Equipe (a marca de equipe é outra coisa) e a carga dele naquela proposta some", p2.corpo.equipe.consultores.every((x: any) => x.ignorado === false));
          // juntos
          const pj = await chamar(`/painel?tipo=all&${qItem}&${qCons}`, tAdmin);
          confere("item e consultor ignorados juntos: 200 e os dois contados", pj.status === 200 && pj.corpo.meta.ignoradosNaProposta.itens === 1 && pj.corpo.meta.ignoradosNaProposta.consultores === 1);
        }
        confere("parâmetros com lixo são ignorados sem erro", (await chamar(`/painel?tipo=all&ignorarItem=abc,1:2,9:9:9&ignorarConsultorProposta=x,1:1:1:1,8:8:8`, tAdmin)).corpo.resumo.executado === c.resumo.executado);
        confere("sem os parâmetros, a gaveta volta ao normal", (await chamar(base, tAdmin)).corpo.executado === g0.corpo.executado);
        confere("a gaveta do consultor NÃO é afetada", (await chamar(`/consultores/${cons1.codfor}`, tAdmin)).status === 200);
      }
    }

    // ---- modo de estouro (por item × pela proposta), filtro de proposta e eficiência financeira ----
    {
      const gm = await chamar("/painel?tipo=all&estouro=proposta", tAdmin);
      confere("estouro=proposta = 200 e o painel diz o modo", gm.status === 200 && gm.corpo.meta.modoEstouro === "proposta" && c.meta.modoEstouro === "item");
      confere("vendido e executado iguais nos dois modos", gm.corpo.resumo.vendido === c.resumo.vendido && gm.corpo.resumo.executado === c.resumo.executado && gm.corpo.propostas.length === c.propostas.length);
      confere("pela proposta: acima de cada proposta = max(0, executado − vendido)", gm.corpo.propostas.every((p: any) => p.acima === Math.max(0, p.executado - p.vendido)));
      confere("pela proposta: saldo de cada proposta = max(0, vendido − executado)", gm.corpo.propostas.every((p: any) => p.saldo === Math.max(0, p.vendido - p.executado)));
      confere("os dois estouros vêm em cada linha e batem com o modo item", gm.corpo.propostas.every((p: any, i: number) => p.acimaPorItem === c.propostas[i].acima && p.acimaGlobal === Math.max(0, p.executado - p.vendido)) && c.propostas.every((p: any) => p.acimaPorItem === p.acima));
      confere("pela proposta o estouro em HORAS da carteira nunca passa do por item", gm.corpo.resumo.acima <= c.resumo.acima);
      confere("pela proposta: carteira = soma das propostas e dentro + acima = executado", gm.corpo.resumo.acima === gm.corpo.propostas.reduce((t: number, p: any) => t + p.acima, 0) && gm.corpo.resumo.dentro + gm.corpo.resumo.acima === gm.corpo.resumo.executado);
      confere("pela proposta: a eficiência da carteira sobe ou fica igual (estouro menor)", (gm.corpo.resumo.eficiencia ?? 0) >= (c.resumo.eficiencia ?? 0));
      confere("a tendência soma o mesmo total e o 'dentro' só cresce", gm.corpo.tendencia.reduce((t: number, x: any) => t + x.total, 0) === c.tendencia.reduce((t: number, x: any) => t + x.total, 0) && gm.corpo.tendencia.reduce((t: number, x: any) => t + x.dentro, 0) >= c.tendencia.reduce((t: number, x: any) => t + x.dentro, 0));
      confere("equipe e carga não mudam de modo (são por alocação)", gm.corpo.carga.pendente === c.carga.pendente && gm.corpo.carga.revisar === c.carga.revisar);
      confere("modo desconhecido volta a 'item'", (await chamar("/painel?tipo=all&estouro=xyz", tAdmin)).corpo.resumo.acima === c.resumo.acima);
      const comItemEstourado = c.propostas.find((p: any) => p.acimaPorItem > 0 && p.acimaGlobal === 0);
      if (comItemEstourado) {
        const gI = await chamar(`/propostas/${comItemEstourado.codemp}/${comItemEstourado.codpro}`, tAdmin);
        const gP = await chamar(`/propostas/${comItemEstourado.codemp}/${comItemEstourado.codpro}?estouro=proposta`, tAdmin);
        confere("gaveta: item estourado compensado vira sem estouro pela proposta, e os dois números aparecem", gI.corpo.acima === comItemEstourado.acimaPorItem && gP.corpo.acima === 0 && gP.corpo.acimaPorItem === comItemEstourado.acimaPorItem && gP.corpo.modoEstouro === "proposta");
        confere("gaveta: situação pela proposta não é Estouro", gP.corpo.situacao !== "bad");
      } else {
        console.warn("AVISO: nenhuma proposta com item estourado compensado — pulei o teste da gaveta nesse caso.");
      }

      // filtro de proposta
      const [pA, pB] = c.propostas;
      const fp1 = await chamar(`/painel?tipo=all&codpro=${pA.codpro}`, tAdmin);
      confere("codpro recorta a uma proposta (e o resumo é só dela)", fp1.corpo.propostas.length === 1 && fp1.corpo.propostas[0].codpro === pA.codpro && fp1.corpo.resumo.executado === pA.executado);
      const fp2 = await chamar(`/painel?tipo=all&codpro=${pA.codpro},${pB.codpro}`, tAdmin);
      confere("codpro com duas propostas", fp2.corpo.propostas.length === 2);
      confere("codpro inexistente = carteira vazia sem erro", (await chamar("/painel?tipo=all&codpro=999999999", tAdmin)).corpo.propostas.length === 0);
      confere("codpro com lixo é ignorado (volta à carteira inteira)", (await chamar("/painel?tipo=all&codpro=abc", tAdmin)).corpo.propostas.length === c.propostas.length);
      confere("codpro + codcli de outro cliente = vazio (os filtros se somam)", (await chamar(`/painel?tipo=all&codpro=${pA.codpro}&codcli=${pA.codcli === 999999 ? 1 : 999999}`, tAdmin)).corpo.propostas.length === 0);
      const fl = await chamar("/filtros", tAdmin);
      confere("/filtros traz as propostas do escopo (PS · cliente, com cliente e tipo)", Array.isArray(fl.corpo.propostas) && fl.corpo.propostas.length >= c.propostas.length && fl.corpo.propostas.every((p: any) => typeof p.valor === "number" && p.rotulo.startsWith("PS ") && typeof p.codcli === "number" && typeof p.interna === "boolean"));
      confere("toda proposta da carteira está nas opções do filtro", c.propostas.every((p: any) => fl.corpo.propostas.some((o: any) => o.valor === p.codpro)));

      // eficiência financeira
      const fin = c.financeiro;
      const [refVal] = await prisma.$queryRaw<{ valor: number }[]>`
        SELECT COALESCE(SUM(pi.qtdhor::numeric / 60 * COALESCE(pi.valhor, 0)), 0)::float8 AS valor
        FROM propostas p
        JOIN propostas_itens pi ON pi.codemp = p.codemp AND pi.codpro = p.codpro AND pi.removido_em_senior IS NULL
        WHERE p.removido_em_senior IS NULL AND p.sitpro IN (4, 7)`;
      confere("financeiro: valor vendido = soma direta qtdhor × valhor no banco", Math.abs(fin.resumo.valorVendido - refVal.valor) < 1, `${fin.resumo.valorVendido} vs ${refVal.valor}`);
      confere("financeiro: soma das propostas = resumo", Math.abs(fin.propostas.reduce((t: number, p: any) => t + p.valorVendido, 0) - fin.resumo.valorVendido) < 1 && Math.abs(fin.propostas.reduce((t: number, p: any) => t + p.valorExecutado, 0) - fin.resumo.valorExecutado) < 1 && fin.propostas.length === c.propostas.length);
      confere("financeiro: soma dos clientes = resumo e propostas dos clientes = total", Math.abs(fin.clientes.reduce((t: number, x: any) => t + x.valorVendido, 0) - fin.resumo.valorVendido) < 1 && fin.clientes.reduce((t: number, x: any) => t + x.propostas, 0) === c.propostas.length);
      confere("financeiro: dentro + acima = executado (resumo e linhas)", Math.abs(fin.resumo.valorDentro + fin.resumo.valorAcima - fin.resumo.valorExecutado) < 0.01 && fin.propostas.every((p: any) => Math.abs(p.valorDentro + p.valorAcima - p.valorExecutado) < 0.01));
      confere("financeiro: o estouro em R$ da carteira é o impacto das horas", Math.abs(fin.resumo.valorAcima - Math.min(c.resumo.impacto, fin.resumo.valorExecutado)) < 1);
      confere("financeiro: eficiência entre 0 e 1 e valores não negativos", fin.resumo.eficiencia != null && fin.resumo.eficiencia >= 0 && fin.resumo.eficiencia <= 1 && fin.propostas.every((p: any) => p.valorVendido >= 0 && p.valorExecutado >= 0 && p.valorSaldo >= 0));
      confere("financeiro: valor em itens sem faturamento é parte do vendido", fin.resumo.valorSemFaturamento >= 0 && fin.resumo.valorSemFaturamento <= fin.resumo.valorVendido);
      const finG = (await chamar("/painel?tipo=all&estouro=proposta", tAdmin)).corpo.financeiro;
      confere("financeiro pela proposta: vendido e executado iguais e dentro + acima = executado (o valor-hora médio pode custar mais ou menos que o por item)", Math.abs(finG.resumo.valorVendido - fin.resumo.valorVendido) < 1 && Math.abs(finG.resumo.valorExecutado - fin.resumo.valorExecutado) < 1 && finG.resumo.valorAcima <= finG.resumo.valorExecutado && finG.resumo.valorDentro + finG.resumo.valorAcima === finG.resumo.valorExecutado || Math.abs(finG.resumo.valorDentro + finG.resumo.valorAcima - finG.resumo.valorExecutado) < 0.01);
      const finP = (await chamar(`/painel?tipo=all&codpro=${pA.codpro}`, tAdmin)).corpo.financeiro;
      confere("financeiro respeita o filtro de proposta", finP.propostas.length === 1 && finP.clientes.length === 1 && finP.propostas[0].codpro === pA.codpro);
      const finIgn = (await chamar(`/painel?tipo=all&ignorar=${pA.codemp}:${pA.codpro}`, tAdmin)).corpo.financeiro;
      confere("financeiro: proposta ignorada sai do valor", finIgn.propostas.length === fin.propostas.length - 1 && finIgn.resumo.valorVendido < fin.resumo.valorVendido + 0.01 && !finIgn.propostas.some((p: any) => p.codpro === pA.codpro));
    }

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

    // ---- excluir apontamento do cálculo do painel (admin) ----
    // Alvo: o primeiro item que tem um apontamento válido, ainda não excluído.
    let alvoEx: { codemp: number; codpro: number; seqite: number; ratItemId: number; minutos: number } | null = null;
    for (const p of c.propostas.filter((x: any) => x.executado > 0).slice(0, 30)) {
      const detP = await chamar(`/propostas/${p.codemp}/${p.codpro}`, tAdmin);
      for (const it of detP.corpo.itens.filter((i: any) => i.executado > 0)) {
        const l = await chamar(`/propostas/${p.codemp}/${p.codpro}/itens/${it.seqite}/apontamentos`, tAdmin);
        const ap = l.corpo?.apontamentos?.find((a: any) => !a.excluido && a.minutos > 0);
        if (ap) {
          alvoEx = { codemp: p.codemp, codpro: p.codpro, seqite: it.seqite, ratItemId: ap.id, minutos: ap.minutos };
          break;
        }
      }
      if (alvoEx) break;
    }
    confere("achou um apontamento para testar a exclusão", alvoEx != null);
    if (alvoEx) {
      const A = alvoEx;
      ratItensTocados.add(A.ratItemId);
      const caminhoProp = `/propostas/${A.codemp}/${A.codpro}`;
      const executadoDoItem = async () => (await chamar(caminhoProp, tAdmin)).corpo.itens.find((i: any) => i.seqite === A.seqite).executado as number;
      const executadoDaProposta = async () => (await chamar(caminhoProp, tAdmin)).corpo.executado as number;
      const painelAgora = async () => (await chamar("/painel?tipo=all", tAdmin)).corpo;

      const itemAntes = await executadoDoItem();
      const propostaAntes = await executadoDaProposta();
      const pAntes = await painelAgora();
      const totalExclAntes = pAntes.exclusoes.total as number;
      const minExclAntes = pAntes.exclusoes.minutos as number;
      confere("payload traz a lista fechada de motivos", pAntes.motivosExclusao.length === 4);

      // Validação do corpo e acesso (nada disso grava).
      const excluir = (corpo: unknown, token = tAdmin) => chamar(`/apontamentos/${A.ratItemId}/excluir`, token, { method: "POST", body: corpo });
      confere("sem token = 401", (await chamar(`/apontamentos/${A.ratItemId}/excluir`, undefined, { method: "POST", body: {} })).status === 401);
      if (semGestao) {
        confere("usuário sem gestão = 403 ao excluir", (await excluir({ motivo: "indevido" }, signToken({ userId: semGestao.id, role: semGestao.role }))).status === 403);
      }
      confere("sem motivo = 400", (await excluir({})).status === 400);
      confere("motivo fora da lista = 400", (await excluir({ motivo: "porque_sim" })).status === 400);
      confere('motivo "outro" sem observação = 400', (await excluir({ motivo: "outro" })).status === 400);
      confere('motivo "outro" só com espaços = 400', (await excluir({ motivo: "outro", observacao: "   " })).status === 400);
      confere("observação acima de 300 caracteres = 400", (await excluir({ motivo: "indevido", observacao: "x".repeat(301) })).status === 400);
      confere("apontamento inexistente = 404", (await chamar(`/apontamentos/999999999/excluir`, tAdmin, { method: "POST", body: { motivo: "indevido" } })).status === 404);
      confere("id inválido = 400", (await chamar(`/apontamentos/abc/excluir`, tAdmin, { method: "POST", body: { motivo: "indevido" } })).status === 400);
      confere("nada mudou depois das recusas", (await executadoDoItem()) === itemAntes);

      // Excluir de verdade.
      const ex1 = await excluir({ motivo: "retrabalho", observacao: "teste automatizado" });
      confere("excluir = 201", ex1.status === 201, JSON.stringify(ex1.corpo));
      confere("o item perde exatamente os minutos do apontamento", (await executadoDoItem()) === itemAntes - A.minutos, `${itemAntes} - ${A.minutos}`);
      confere("a proposta perde os mesmos minutos", (await executadoDaProposta()) === propostaAntes - A.minutos);
      const pDepois = await painelAgora();
      confere("o painel perde os mesmos minutos no executado", pDepois.resumo.executado === pAntes.resumo.executado - A.minutos, `${pDepois.resumo.executado} vs ${pAntes.resumo.executado - A.minutos}`);
      confere("exclusoes.total sobe 1", pDepois.exclusoes.total === totalExclAntes + 1);
      confere("exclusoes.minutos sobe os minutos do apontamento", pDepois.exclusoes.minutos === minExclAntes + A.minutos);
      const linhaEx = pDepois.exclusoes.lista.find((e: any) => e.ratItemId === A.ratItemId);
      confere("a lista mostra a exclusão com motivo, autor e permissão de restaurar", !!linhaEx && linhaEx.motivo === "retrabalho" && linhaEx.motivoRotulo.includes("Retrabalho") && linhaEx.observacao === "teste automatizado" && linhaEx.podeRestaurar === true && linhaEx.excluidoPorNome !== "—", JSON.stringify(linhaEx));
      const lista1 = await chamar(`${caminhoProp}/itens/${A.seqite}/apontamentos`, tAdmin);
      const linhaAp = lista1.corpo.apontamentos.find((a: any) => a.id === A.ratItemId);
      confere("a lista de apontamentos marca como excluído, com o motivo", linhaAp?.excluido === true && linhaAp.motivo === "retrabalho");
      confere("admin pode decidir no item", lista1.corpo.podeDecidir === true);

      confere("excluir de novo o mesmo apontamento = 409", (await excluir({ motivo: "indevido" })).status === 409);
      confere("o 409 não mexeu na conta", (await executadoDoItem()) === itemAntes - A.minutos);

      // Restaurar.
      const rest = (token = tAdmin) => chamar(`/apontamentos/${A.ratItemId}/restaurar`, token, { method: "POST" });
      if (semGestao) {
        confere("usuário sem gestão = 403 ao restaurar", (await rest(signToken({ userId: semGestao.id, role: semGestao.role }))).status === 403);
      }
      confere("restaurar = 200", (await rest()).status === 200);
      confere("restaurado: o item volta ao valor original", (await executadoDoItem()) === itemAntes);
      const pRest = await painelAgora();
      confere("restaurado: o painel volta ao valor original", pRest.resumo.executado === pAntes.resumo.executado);
      confere("restaurado: exclusoes volta ao total anterior", pRest.exclusoes.total === totalExclAntes);
      confere("restaurar de novo = 404", (await rest()).status === 404);

      // Histórico: depois de restaurar, o MESMO apontamento pode ser excluído outra vez (o índice único é só das ativas).
      confere("excluir de novo depois de restaurar = 201", (await excluir({ motivo: "treinamento" })).status === 201);
      confere("e a conta cai de novo", (await executadoDoItem()) === itemAntes - A.minutos);
      confere("restaurar a segunda = 200", (await rest()).status === 200);
      const linhas = await prisma.apontamentoForaDoCalculo.findMany({ where: { ratItemId: A.ratItemId, excluidoEm: { gte: inicio } }, orderBy: { id: "asc" } });
      confere("o histórico guarda as 2 exclusões, as duas restauradas", linhas.length === 2 && linhas.every((l) => l.restauradoEm != null && l.restauradoPor === admin.id), JSON.stringify(linhas.map((l) => l.restauradoEm)));
      confere("o snapshot guarda item, minutos e autor", linhas[0].seqite === A.seqite && linhas[0].minutos === A.minutos && linhas[0].excluidoPor === admin.id);

      // Auditoria: 2 exclusões + 2 restaurações.
      const eventos = await prisma.auditEvento.findMany({ where: { entidadeTipo: "eficiencia_apontamento", entidadeId: String(A.ratItemId), ocorridoEm: { gte: inicio } }, select: { eventoTipo: true, codpro: true } });
      confere(
        "a auditoria registrou 2 exclusões e 2 restaurações",
        eventos.filter((e) => e.eventoTipo === "EFICIENCIA_APONTAMENTO_EXCLUIDO").length === 2 && eventos.filter((e) => e.eventoTipo === "EFICIENCIA_APONTAMENTO_RESTAURADO").length === 2 && eventos.every((e) => e.codpro === A.codpro),
        JSON.stringify(eventos)
      );
    }

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
      // O gestor só vê, no filtro, os clientes das propostas que ele enxerga (nunca a lista inteira da casa).
      const clientesDoGestor = new Set(g.corpo.propostas.map((p: any) => p.codcli));
      confere("filtro de cliente do gestor = só clientes das propostas dele", filtros.corpo.clientes.length > 0 && filtros.corpo.clientes.every((x: any) => clientesDoGestor.has(x.valor)) && filtros.corpo.clientes.length < filtrosAdmin.corpo.clientes.length);

      // consultores do gestor ⊆ time; um de fora do time dá 403
      confere("equipe do gestor ⊆ time", g.corpo.equipe.consultores.every((x: any) => time.has(x.codfor)));
      // Com filtro de departamento o gestor continua preso ao time dele (o recorte do filtro só ESTREITA, nunca amplia).
      const gDepProprio = await chamar(`/painel?tipo=all&depexe=${gestor.departamentos[0]}`, tG);
      confere("gestor + filtro do departamento dele: equipe ⊆ time dele", gDepProprio.status === 200 && gDepProprio.corpo.equipe.consultores.every((x: any) => time.has(x.codfor)));
      const depAlheio = filtrosAdmin.corpo.departamentos.find((d: any) => !gestor!.departamentos.includes(d.valor));
      if (depAlheio) {
        const gDepAlheio = await chamar(`/painel?tipo=all&depexe=${depAlheio.valor}`, tG);
        confere("gestor + filtro de departamento que NÃO é dele: equipe continua ⊆ time dele", gDepAlheio.status === 200 && gDepAlheio.corpo.equipe.consultores.every((x: any) => time.has(x.codfor)));
      }
      const foraDoTime = c.equipe.consultores.find((x: any) => !time.has(x.codfor));
      if (foraDoTime) {
        const r = await chamar(`/consultores/${foraDoTime.codfor}`, tG);
        confere(`consultor fora do time = 403 (${foraDoTime.nome})`, r.status === 403, String(r.status));
      }
      const dentro = g.corpo.equipe.consultores[0];
      if (dentro) confere("consultor do time = 200", (await chamar(`/consultores/${dentro.codfor}`, tG)).status === 200);

      // proposta fora do escopo dele = 404
      const idsG = new Set<number>(g.corpo.propostas.map((p: any) => p.codpro));
      const filtrosG = await chamar("/filtros", tG);
      confere("filtro de propostas do gestor só traz as do escopo dele", filtrosG.corpo.propostas.length > 0 && filtrosG.corpo.propostas.every((o: any) => idsG.has(o.valor)));
      const fora = c.propostas.find((p: any) => !idsG.has(p.codpro));
      if (fora) confere("proposta fora do escopo = 404", (await chamar(`/propostas/${fora.codemp}/${fora.codpro}`, tG)).status === 404);

      // na gaveta, ninguém de fora do time aparece com nome
      const dentroDoEscopo = g.corpo.propostas.find((p: any) => p.itens > 0 && p.executado > 0);
      if (dentroDoEscopo) {
        const d = await chamar(`/propostas/${dentroDoEscopo.codemp}/${dentroDoEscopo.codpro}`, tG);
        const nomes = d.corpo.itens.flatMap((i: any) => i.consultores.map((x: any) => x.codfor));
        confere("gaveta do gestor: só consultores do time aparecem com nome", nomes.every((f: number) => time.has(f)));
        confere("gaveta do gestor: a aba Consultores lista só o time (os demais entram somados em outros)", d.corpo.consultores.every((x: any) => time.has(x.codfor)) && typeof d.corpo.outrosConsultores.quantidade === "number");
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
      // ---- gestor: quem pode tirar apontamento do cálculo (item OU proposta do departamento dele; admin sempre) ----
      const deps = gestor.departamentos;
      // Um apontamento válido por caso: (a) item do departamento do gestor; (b) proposta compartilhada, item de OUTRO
      // departamento; (c) proposta fora do escopo dele. Achados direto no banco, sem depender de números fixos.
      const apontamentoValido = Prisma.sql`ri.removido_em_senior IS NULL AND r.removido_em_senior IS NULL AND r.sitrat IS DISTINCT FROM 5 AND ri.horini IS NOT NULL AND ri.horfim > ri.horini`;
      const achar = async (condicao: Prisma.Sql) => {
        const [x] = await prisma.$queryRaw<{ id: number; codemp: number; codpro: number; seqite: number }[]>`
          SELECT ri.id, ri.codemp, ri.codpro, ri.seqite
          FROM rat_itens ri JOIN rats r ON r.id = ri."ratId"
          JOIN propostas p ON p.codemp = ri.codemp AND p.codpro = ri.codpro AND p.removido_em_senior IS NULL AND p.sitpro IN (4, 7)
          JOIN propostas_itens pi ON pi.codemp = ri.codemp AND pi.codpro = ri.codpro AND pi.seqite = ri.seqite AND pi.removido_em_senior IS NULL
          WHERE ${apontamentoValido} AND ${condicao}
          ORDER BY ri.id DESC LIMIT 1`;
        return x ?? null;
      };
      const itemDoGestor = await achar(Prisma.sql`pi.depexe = ANY(${deps}::int[])`);
      const itemDeOutroNaCompartilhada = await achar(Prisma.sql`NOT (COALESCE(pi.depexe, -1) = ANY(${deps}::int[])) AND NOT (COALESCE(p.depexe, -1) = ANY(${deps}::int[]))
        AND EXISTS (SELECT 1 FROM propostas_itens o WHERE o.codemp = p.codemp AND o.codpro = p.codpro AND o.removido_em_senior IS NULL AND o.depexe = ANY(${deps}::int[]))`);
      const foraDoEscopo = await achar(Prisma.sql`NOT (COALESCE(p.depexe, -1) = ANY(${deps}::int[]))
        AND NOT EXISTS (SELECT 1 FROM propostas_itens o WHERE o.codemp = p.codemp AND o.codpro = p.codpro AND o.removido_em_senior IS NULL AND o.depexe = ANY(${deps}::int[]))`);
      const excluirComo = (token: string, ratItemId: number) => chamar(`/apontamentos/${ratItemId}/excluir`, token, { method: "POST", body: { motivo: "indevido" } });

      if (itemDoGestor) {
        ratItensTocados.add(itemDoGestor.id);
        const listaG = await chamar(`/propostas/${itemDoGestor.codemp}/${itemDoGestor.codpro}/itens/${itemDoGestor.seqite}/apontamentos`, tG);
        confere("gestor vê a lista de apontamentos do item dele e pode decidir", listaG.status === 200 && listaG.corpo.podeDecidir === true, JSON.stringify(listaG.corpo).slice(0, 120));
        confere("gestor exclui apontamento de item do departamento dele = 201", (await excluirComo(tG, itemDoGestor.id)).status === 201);
        const painelG = await chamar("/painel?tipo=all", tG);
        const meu = painelG.corpo.exclusoes?.lista?.find((e: any) => e.ratItemId === itemDoGestor.id);
        confere("e vê a exclusão no painel dele, podendo restaurar", !!meu && meu.podeRestaurar === true);
        confere("admin também enxerga essa exclusão", (await chamar("/painel?tipo=all", tAdmin)).corpo.exclusoes.lista.some((e: any) => e.ratItemId === itemDoGestor.id));
        confere("gestor restaura = 200", (await chamar(`/apontamentos/${itemDoGestor.id}/restaurar`, tG, { method: "POST" })).status === 200);
      } else {
        console.warn("AVISO: sem apontamento de item do departamento do gestor — pulei a exclusão positiva do gestor.");
      }
      if (itemDeOutroNaCompartilhada) {
        ratItensTocados.add(itemDeOutroNaCompartilhada.id);
        const listaC = await chamar(`/propostas/${itemDeOutroNaCompartilhada.codemp}/${itemDeOutroNaCompartilhada.codpro}/itens/${itemDeOutroNaCompartilhada.seqite}/apontamentos`, tG);
        confere("proposta compartilhada: o gestor VÊ o item de outro departamento, mas não pode decidir", listaC.status === 200 && listaC.corpo.podeDecidir === false);
        confere("excluir item de outro departamento = 403", (await excluirComo(tG, itemDeOutroNaCompartilhada.id)).status === 403);
        confere("o 403 não gravou nada", (await prisma.apontamentoForaDoCalculo.count({ where: { ratItemId: itemDeOutroNaCompartilhada.id, excluidoEm: { gte: inicio } } })) === 0);
      } else {
        console.warn("AVISO: sem proposta compartilhada com item de outro departamento — pulei o 403.");
      }
      if (foraDoEscopo) {
        ratItensTocados.add(foraDoEscopo.id);
        confere("proposta fora do escopo: listar = 404", (await chamar(`/propostas/${foraDoEscopo.codemp}/${foraDoEscopo.codpro}/itens/${foraDoEscopo.seqite}/apontamentos`, tG)).status === 404);
        confere("proposta fora do escopo: excluir = 404", (await excluirComo(tG, foraDoEscopo.id)).status === 404);
        confere("o 404 não gravou nada", (await prisma.apontamentoForaDoCalculo.count({ where: { ratItemId: foraDoEscopo.id, excluidoEm: { gte: inicio } } })) === 0);
      }

      // ---- plano de ação: quem cria, quem vê, quem muda o status, avisos e a rotina de vencidas ----
      const gestorCodfor = (await resolverContextoConsultor(gestor.email)).consultor?.codfor ?? null;
      // Um responsável de verdade: consultor do time do gestor, com login, que NÃO é gestor nem admin.
      let resp: { userId: number; codfor: number; role: string } | null = null;
      for (const codfor of time) {
        if (codfor === gestorCodfor) continue;
        const cons = await prisma.consultor.findFirst({ where: { codfor }, select: { email: true } });
        if (!cons?.email) continue;
        const u = await prisma.user.findFirst({ where: { email: { equals: cons.email, mode: "insensitive" }, status: "ativo" }, select: { id: true, role: { select: { name: true } } } });
        if (u && !gestoresIds.has(u.id) && u.role.name !== "admin") {
          resp = { userId: u.id, codfor, role: u.role.name };
          break;
        }
      }
      confere("achei um responsável (consultor do time, sem gestão) para testar o plano de ação", resp != null);

      const hoje = hojeIso();
      const daqui = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
      const comoGestor = (caminho: string, opcoes?: { method?: string; body?: unknown }) => chamar(`/acoes${caminho}`, tG, opcoes);
      const propostaRef = g.corpo.propostas[0];

      // Recusas (nada grava).
      const corpoBase = { titulo: "[teste] Redistribuir carga", responsavelCodfor: resp?.codfor ?? gestorCodfor, prazo: daqui(10), codemp: propostaRef.codemp, codpro: propostaRef.codpro, origemAlerta: "Alerta de teste" };
      confere("sem token = 401", (await chamar("/acoes", undefined)).status === 401);
      if (semGestao) {
        const tSem = signToken({ userId: semGestao.id, role: semGestao.role });
        confere("sem gestão não cria = 403", (await chamar("/acoes", tSem, { method: "POST", body: corpoBase })).status === 403);
        confere("sem gestão não lista a aba do painel = 403", (await chamar("/acoes", tSem)).status === 403);
        confere("sem gestão abre 'minhas' (vazia) = 200", (await chamar("/acoes/minhas", tSem)).status === 200);
      }
      confere("sem título = 400", (await comoGestor("", { method: "POST", body: { ...corpoBase, titulo: "" } })).status === 400);
      confere("prazo no passado = 400", (await comoGestor("", { method: "POST", body: { ...corpoBase, prazo: daqui(-3) } })).status === 400);
      if (foraDoTime) confere("responsável fora do time = 403", (await comoGestor("", { method: "POST", body: { ...corpoBase, responsavelCodfor: foraDoTime.codfor } })).status === 403);
      if (fora) confere("proposta fora do escopo = 404", (await comoGestor("", { method: "POST", body: { ...corpoBase, codemp: fora.codemp, codpro: fora.codpro } })).status === 404);

      // Criar.
      const criada = await comoGestor("", { method: "POST", body: corpoBase });
      confere("gestor cria ação = 201", criada.status === 201, JSON.stringify(criada.corpo));
      const acaoId: number = criada.corpo?.id;
      if (acaoId) acoesCriadas.add(acaoId);
      confere("ação nasce aberta, com o responsável e a referência", criada.corpo?.status === "aberta" && criada.corpo.responsavelCodfor === corpoBase.responsavelCodfor && criada.corpo.codpro === propostaRef.codpro && criada.corpo.cliente != null && criada.corpo.podeEditar === true);
      confere("o prazo volta como data de calendário (AAAA-MM-DD)", /^\d{4}-\d{2}-\d{2}$/.test(criada.corpo?.prazo ?? ""));

      const lista = await comoGestor("");
      confere("gestor vê a ação na lista e as contagens contam", lista.status === 200 && lista.corpo.acoes.some((x: any) => x.id === acaoId) && lista.corpo.contagens.abertas >= 1);
      confere("admin também vê", (await chamar("/acoes", tAdmin)).corpo.acoes.some((x: any) => x.id === acaoId));
      if (semGestao) {
        const tSem = signToken({ userId: semGestao.id, role: semGestao.role });
        confere("quem não tem relação com a ação recebe 404 ao mexer nela", (await chamar(`/acoes/${acaoId}/status`, tSem, { method: "PATCH", body: { status: "concluida" } })).status === 404);
        confere("e 404 ao excluir", (await chamar(`/acoes/${acaoId}`, tSem, { method: "DELETE" })).status === 404);
      }

      // O responsável: avisado, vê só as dele, muda só o status.
      if (resp) {
        const tR = signToken({ userId: resp.userId, role: resp.role });
        const aviso = await prisma.notificacao.findMany({ where: { userId: resp.userId, tipo: "acao_eficiencia_atribuida", criadoEm: { gte: inicio } } });
        confere("o responsável foi avisado pelo sino (1 aviso)", aviso.length === 1 && aviso[0].mensagem.includes("[teste] Redistribuir carga"), String(aviso.length));
        const minhas = await chamar("/acoes/minhas", tR);
        confere("responsável vê a ação em 'minhas'", minhas.status === 200 && minhas.corpo.acoes.some((x: any) => x.id === acaoId));
        confere("e a vê com permissão só de status", minhas.corpo.acoes.find((x: any) => x.id === acaoId)?.podeMudarStatus === true && minhas.corpo.acoes.find((x: any) => x.id === acaoId)?.podeEditar === false);
        confere("responsável não abre a aba do painel (lista geral) = 403", (await chamar("/acoes", tR)).status === 403);
        confere("responsável não cria = 403", (await chamar("/acoes", tR, { method: "POST", body: corpoBase })).status === 403);
        confere("responsável não edita = 403", (await chamar(`/acoes/${acaoId}`, tR, { method: "PATCH", body: { titulo: "x" } })).status === 403);
        confere("responsável não exclui = 403", (await chamar(`/acoes/${acaoId}`, tR, { method: "DELETE" })).status === 403);
        confere("status inválido = 400", (await chamar(`/acoes/${acaoId}/status`, tR, { method: "PATCH", body: { status: "feito" } })).status === 400);
        const andamento = await chamar(`/acoes/${acaoId}/status`, tR, { method: "PATCH", body: { status: "andamento" } });
        confere("responsável põe em andamento = 200", andamento.status === 200 && andamento.corpo.status === "andamento");
        const concluida = await chamar(`/acoes/${acaoId}/status`, tR, { method: "PATCH", body: { status: "concluida" } });
        confere("responsável conclui: data de conclusão gravada", concluida.status === 200 && concluida.corpo.status === "concluida" && concluida.corpo.concluidaEm != null);
        confere("concluída sai de 'abertas' e entra em 'concluídas'", (await comoGestor("?filtro=abertas")).corpo.acoes.every((x: any) => x.id !== acaoId) && (await comoGestor("?filtro=concluidas")).corpo.acoes.some((x: any) => x.id === acaoId));
        const reaberta = await comoGestor(`/${acaoId}/status`, { method: "PATCH", body: { status: "aberta" } });
        confere("gestor reabre: conclusão é limpa", reaberta.status === 200 && reaberta.corpo.concluidaEm == null);
      } else {
        console.warn("AVISO: sem responsável com login no time do gestor — pulei os testes do responsável.");
      }

      // Edição pelo gestor: prazo novo e título novo; auditoria registra o antes/depois.
      const prazoNovo = daqui(15);
      const editada = await comoGestor(`/${acaoId}`, { method: "PATCH", body: { titulo: "[teste] Título editado", prazo: prazoNovo } });
      confere("gestor edita título e prazo = 200", editada.status === 200 && editada.corpo.titulo === "[teste] Título editado" && editada.corpo.prazo === prazoNovo);
      confere("edição vazia = 400", (await comoGestor(`/${acaoId}`, { method: "PATCH", body: {} })).status === 400);
      confere("prazo novo no passado = 400", (await comoGestor(`/${acaoId}`, { method: "PATCH", body: { prazo: daqui(-2) } })).status === 400);
      if (foraDoTime) confere("trocar para responsável fora do time = 403", (await comoGestor(`/${acaoId}`, { method: "PATCH", body: { responsavelCodfor: foraDoTime.codfor } })).status === 403);

      // Rotina de vencidas: uma ação com prazo ontem (inserida direto; a API não deixa criar no passado).
      if (resp) {
        const vencida = await prisma.acaoEficiencia.create({
          data: { titulo: "[teste] Ação vencida", responsavelCodfor: resp.codfor, prazo: new Date(`${daqui(-3)}T00:00:00.000Z`), criadoPor: gestor.userId, depexe: deps[0] },
        });
        acoesCriadas.add(vencida.id);
        const r1 = await avisarAcoesVencidas();
        confere("a rotina avisou a ação vencida", r1.avisadas >= 1, JSON.stringify(r1));
        const avisosR = await prisma.notificacao.findMany({ where: { userId: resp.userId, tipo: "acao_eficiencia_vencida", criadoEm: { gte: inicio } } });
        const avisosG = await prisma.notificacao.findMany({ where: { userId: gestor.userId, tipo: "acao_eficiencia_vencida_gestor", criadoEm: { gte: inicio } } });
        confere("o responsável e o gestor que criou foram avisados (1 aviso cada)", avisosR.length === 1 && avisosG.length === 1, `${avisosR.length}/${avisosG.length}`);
        const r2 = await avisarAcoesVencidas();
        confere("rodar de novo NÃO avisa outra vez (dedupe)", r2.avisadas === 0, JSON.stringify(r2));
        confere("a notificação continua sendo 1", (await prisma.notificacao.count({ where: { userId: resp.userId, tipo: "acao_eficiencia_vencida", criadoEm: { gte: inicio } } })) === 1);
        const painelComAtraso = await chamar("/painel?tipo=all", tG);
        confere("o painel conta a ação atrasada", painelComAtraso.corpo.acoes.atrasadas >= 1);
        const alertaAcao = painelComAtraso.corpo.alertas.find((x: any) => x.rotulo === "Plano de ação");
        confere("e mostra o alerta, que leva à aba do plano", !!alertaAcao && alertaAcao.alvo.aba === "acoes" && alertaAcao.alvo.filtro === "atrasadas" && alertaAcao.severidade === "bad");
        confere("a lista 'atrasadas' traz a ação", (await comoGestor("?filtro=atrasadas")).corpo.acoes.some((x: any) => x.id === vencida.id && x.atrasada === true));
        // Concluir tira do atraso e do alerta.
        await comoGestor(`/${vencida.id}/status`, { method: "PATCH", body: { status: "concluida" } });
        const painelSemAtraso = await chamar("/painel?tipo=all", tG);
        confere("concluída, deixa de ser atraso", !painelSemAtraso.corpo.alertas.some((x: any) => x.rotulo === "Plano de ação"));
        // Prazo novo reabre o aviso: a ação pode vencer de novo.
        await prisma.acaoEficiencia.update({ where: { id: vencida.id }, data: { status: "aberta", concluidaEm: null } });
        await comoGestor(`/${vencida.id}`, { method: "PATCH", body: { prazo: daqui(5) } });
        confere("prazo novo zera o aviso de vencida", (await prisma.acaoEficiencia.findUnique({ where: { id: vencida.id } }))?.avisoVencidaEm == null);
      }

      // Auditoria e exclusão.
      const excl = await comoGestor(`/${acaoId}`, { method: "DELETE" });
      confere("gestor exclui a ação = 200", excl.status === 200);
      confere("e ela some (404)", (await comoGestor(`/${acaoId}/status`, { method: "PATCH", body: { status: "aberta" } })).status === 404);
      const eventosAcao = await prisma.auditEvento.findMany({ where: { entidadeTipo: "eficiencia_acao", entidadeId: String(acaoId), ocorridoEm: { gte: inicio } }, select: { eventoTipo: true, alteracoes: true } });
      const tipos = eventosAcao.map((e) => e.eventoTipo);
      confere("auditoria: criada, alterada e excluída", tipos.includes("EFICIENCIA_ACAO_CRIADA") && tipos.includes("EFICIENCIA_ACAO_ALTERADA") && tipos.includes("EFICIENCIA_ACAO_EXCLUIDA"), JSON.stringify(tipos));
      if (resp) confere("auditoria: mudanças de status registradas", tipos.filter((t) => t === "EFICIENCIA_ACAO_STATUS_ALTERADO").length >= 3, JSON.stringify(tipos));
      const edicao = eventosAcao.find((e) => e.eventoTipo === "EFICIENCIA_ACAO_ALTERADA");
      confere("auditoria: a edição guarda o antes e o depois do título", JSON.stringify(edicao?.alteracoes ?? {}).includes("[teste] Título editado") && JSON.stringify(edicao?.alteracoes ?? {}).includes("[teste] Redistribuir carga"));
    } else {
      console.warn("AVISO: nenhum gestor não-admin com usuário correspondente — pulei os testes de recorte.");
    }
  } finally {
    const ids = [...ratItensTocados];
    if (ids.length > 0) {
      const ex = await prisma.apontamentoForaDoCalculo.deleteMany({ where: { ratItemId: { in: ids }, excluidoEm: { gte: inicio } } });
      const au = await prisma.auditEvento.deleteMany({ where: { entidadeTipo: "eficiencia_apontamento", entidadeId: { in: ids.map(String) }, ocorridoEm: { gte: inicio } } });
      console.log(`limpeza: ${ex.count} exclusões e ${au.count} eventos de auditoria de teste apagados`);
    }
    const acoesIds = [...acoesCriadas];
    if (acoesIds.length > 0) {
      const ac = await prisma.acaoEficiencia.deleteMany({ where: { id: { in: acoesIds } } });
      const au = await prisma.auditEvento.deleteMany({ where: { entidadeTipo: "eficiencia_acao", entidadeId: { in: acoesIds.map(String) }, ocorridoEm: { gte: inicio } } });
      const no = await prisma.notificacao.deleteMany({ where: { tipo: { startsWith: "acao_eficiencia" }, criadoEm: { gte: inicio } } });
      console.log(`limpeza: ${ac.count} ações, ${au.count} eventos de auditoria e ${no.count} notificações de teste apagados`);
    }
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
