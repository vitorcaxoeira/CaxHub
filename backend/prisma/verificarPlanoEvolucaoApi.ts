// Verificação ponta a ponta de routes/planoEvolucao.ts contra o banco local.
// Sobe um Express mínimo (sem os syncs do server.ts) e usa usuários que já existem.
// GRAVA no banco local (ciclos, participantes, valor base e auditoria de teste); tudo o que o script cria é apagado no `finally`.
// Rodar: node_modules/.bin/ts-node --transpile-only prisma/verificarPlanoEvolucaoApi.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { codforsDoTime, resolverContextoConsultor } from "../src/domain/contextoProjeto";
import { DEPEXES_PLANO_EVOLUCAO } from "../src/domain/propostasDominio";
import { auditoriaRouter } from "../src/routes/auditoria";
import { planoEvolucaoRouter } from "../src/routes/planoEvolucao";
import { carregarItensDoCiclo } from "../src/domain/planoEvolucao/planoEvolucaoDados";
import { indicesDoCiclo } from "../src/domain/planoEvolucao/eficienciaItens";

let falhas = 0;
let total = 0;
function confere(nome: string, ok: boolean, detalhe = "") {
  total++;
  if (!ok) {
    falhas++;
    console.error(`FALHOU: ${nome} ${detalhe}`);
  }
}

// Procura qualquer chave que mencione "valor" (valorHora, valorHoraBase...) em qualquer nível da resposta.
function temChaveDeValor(obj: unknown): boolean {
  if (Array.isArray(obj)) return obj.some(temChaveDeValor);
  if (obj && typeof obj === "object") return Object.entries(obj).some(([k, v]) => /^valorHora/i.test(k) || temChaveDeValor(v));
  return false;
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/plano-evolucao", planoEvolucaoRouter);
  app.use("/auditoria", auditoriaRouter);
  const server = app.listen(0);
  const raiz = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const chamar = async (caminho: string, token?: string, opcoes: { method?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opcoes.body !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(raiz + caminho, { method: opcoes.method ?? "GET", headers, body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined });
    const texto = await r.text();
    let corpo: any = null;
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = texto;
    }
    return { status: r.status, corpo };
  };
  const P = (c: string, t?: string, o?: { method?: string; body?: unknown }) => chamar(`/plano-evolucao${c}`, t, o);

  const inicio = new Date();
  const ciclosCriados = new Set<number>();
  const participantesCriados = new Set<number>();

  try {
    // ---- usuários: admin, gestor da Consultoria ERP/HCM (com time), gestor de OUTRA área e alguém sem gestão ----
    const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: "ativo" }, select: { id: true } });
    if (!admin) throw new Error("sem usuário admin no banco local");
    const gestores = await prisma.departamentoGestor.findMany();
    let gestor: { userId: number; role: string; email: string } | null = null;
    const gestoresIds = new Set<number>();
    const daConsultoria = new Set<number>();
    const papelDe = new Map<number, string>();
    for (const g of gestores) {
      const consultor = await prisma.consultor.findFirst({ where: { codemp: g.codemp, codusu: Number(g.usuges) }, select: { email: true } });
      if (!consultor?.email) continue;
      const user = await prisma.user.findFirst({ where: { email: { equals: consultor.email, mode: "insensitive" }, status: "ativo" }, select: { id: true, email: true, role: { select: { name: true } } } });
      if (!user || user.role.name === "admin") continue;
      gestoresIds.add(user.id);
      papelDe.set(user.id, user.role.name);
      if (!DEPEXES_PLANO_EVOLUCAO.includes(g.depexe)) continue;
      daConsultoria.add(user.id);
      if (!gestor) gestor = { userId: user.id, role: user.role.name, email: user.email };
    }
    // Gestor que NÃO gerencia a Consultoria ERP nem HCM: até 20/10/2026 qualquer gestor entrava no Plano; agora é 403.
    const outraAreaId = [...gestoresIds].find((id) => !daConsultoria.has(id)) ?? null;
    const tOutraArea = outraAreaId != null ? signToken({ userId: outraAreaId, role: papelDe.get(outraAreaId)! }) : null;
    const semGestaoRow = await prisma.user.findFirst({
      where: { role: { name: { in: ["consultoria", "suporte", "desenvolvimento"] } }, status: "ativo", id: { notIn: [...gestoresIds] } },
      select: { id: true, role: { select: { name: true } } },
    });
    const tAdmin = signToken({ userId: admin.id, role: "admin" });
    const tGestor = gestor ? signToken({ userId: gestor.userId, role: gestor.role }) : null;
    const tSem = semGestaoRow ? signToken({ userId: semGestaoRow.id, role: semGestaoRow.role.name }) : null;
    console.log(`admin=${admin.id} gestor=${gestor?.userId ?? "NENHUM"} outraArea=${outraAreaId ?? "NENHUM"} semGestao=${semGestaoRow?.id ?? "NENHUM"}`);

    // ---- acesso ----
    confere("sem token = 401", (await P("/ciclos")).status === 401);
    if (tSem) {
      confere("sem gestão = 403 nos ciclos e participantes", (await P("/ciclos", tSem)).status === 403 && (await P("/participantes", tSem)).status === 403);
      confere("quem não participa recebe 404 em /meu", (await P("/meu", tSem)).status === 404);
    }
    if (tOutraArea) {
      confere("gestor de outra área (não Consultoria ERP/HCM) = 403 nos ciclos, participantes e prévia", (await P("/ciclos", tOutraArea)).status === 403 && (await P("/participantes", tOutraArea)).status === 403 && (await P("/ciclos/1/previa", tOutraArea)).status === 403);
    }
    if (tGestor) {
      confere("gestor lê os ciclos", (await P("/ciclos", tGestor)).status === 200);
      // Desde 20/10/2026 o gestor da Consultoria ERP/HCM administra o Plano como o admin. Corpo inválido = 400 prova que passou da guarda
      // (seria 403) sem gravar nada.
      const ciclosG = await P("/ciclos", tGestor);
      confere("gestor da Consultoria pode editar (podeEditar) e passa da guarda de criar ciclo e participante", ciclosG.corpo.podeEditar === true && (await P("/ciclos", tGestor, { method: "POST", body: { ano: 1999, semestre: 1 } })).status === 400 && (await P("/participantes", tGestor, { method: "POST", body: {} })).status === 400 && (await P("/participantes/opcoes", tGestor)).status === 200);
    }

    // ---- ciclo: criação, validação e trava (ano 2099 não colide com nada real) ----
    if (await prisma.planoCiclo.findUnique({ where: { ano_semestre: { ano: 2099, semestre: 1 } } })) throw new Error("sobrou um ciclo 2099/1 de uma execução anterior: apague antes");
    confere("ciclo inválido = 400", (await P("/ciclos", tAdmin, { method: "POST", body: { ano: 1999, semestre: 1 } })).status === 400 && (await P("/ciclos", tAdmin, { method: "POST", body: { ano: 2099, semestre: 3 } })).status === 400);
    const novo = await P("/ciclos", tAdmin, { method: "POST", body: { ano: 2099, semestre: 1 } });
    confere("cria o ciclo em rascunho", novo.status === 201 && novo.corpo.status === "rascunho" && novo.corpo.editavel === true, JSON.stringify(novo.corpo).slice(0, 160));
    const c99 = novo.corpo;
    if (c99?.id) ciclosCriados.add(c99.id);
    confere("calendário padrão (corte, apuração, devolutiva, contestação)", c99.corteEvidencias === "2099-05-31" && c99.apuracaoAte === "2099-06-20" && c99.devolutivaEm === "2099-06-20" && c99.contestacaoAte === "2099-06-25");
    confere("nasce com os 6 indicadores e a área 8 e 9", c99.indicadores.length === 6 && c99.departamentosArea.join() === "8,9" && c99.indicadores.find((i: any) => i.chave === "cronograma")?.ativo === false);
    confere("ciclo duplicado = 409", (await P("/ciclos", tAdmin, { method: "POST", body: { ano: 2099, semestre: 1 } })).status === 409);

    const pub0 = await P(`/ciclos/${c99.id}/publicar`, tAdmin, { method: "POST" });
    confere("não publica sem meta, e diz o que falta", pub0.status === 400 && Array.isArray(pub0.corpo.pendencias) && pub0.corpo.pendencias.length >= 2, JSON.stringify(pub0.corpo).slice(0, 200));

    const invalidos = [
      { metaEficienciaGlobal: 150 },
      { departamentosArea: [99] },
      { departamentosArea: [] },
      { definicaoOnline: "Z" },
      { amostraMinimaHoras: -1 },
      { corteEvidencias: "2099-13-45" },
      { indicadores: [{ chave: "inventado", peso: 10 }] },
      { indicadores: [{ chave: "produtividade", peso: 10 }, { chave: "produtividade", peso: 20 }] },
      { indicadores: [{ chave: "produtividade", peso: 101 }] },
      { corteEvidencias: "2099-06-28", apuracaoAte: "2099-06-20" }, // fora de ordem
    ];
    for (const corpo of invalidos) confere(`edição inválida = 400 (${JSON.stringify(corpo).slice(0, 50)})`, (await P(`/ciclos/${c99.id}`, tAdmin, { method: "PUT", body: corpo })).status === 400);

    const ed = await P(`/ciclos/${c99.id}`, tAdmin, {
      method: "PUT",
      body: {
        metaEficienciaGlobal: 80,
        amostraMinimaHoras: 5,
        definicaoOnline: "B",
        indicadores: [
          { chave: "produtividade", peso: 50, meta: 85, ativo: true },
          { chave: "apontamento_online", peso: 30, meta: 40, ativo: true },
        ],
      },
    });
    confere("edita parâmetros e metas do rascunho", ed.status === 200 && ed.corpo.metaEficienciaGlobal === 80 && ed.corpo.definicaoOnline === "B" && ed.corpo.indicadores.find((i: any) => i.chave === "produtividade").meta === 85, JSON.stringify(ed.corpo).slice(0, 200));
    confere("sem pendências depois de definir metas e pesos (50+30+10+5+5 = 100)", ed.corpo.pendenciasPublicacao.length === 0, JSON.stringify(ed.corpo.pendenciasPublicacao));
    const soma = await P(`/ciclos/${c99.id}`, tAdmin, { method: "PUT", body: { indicadores: [{ chave: "produtividade", peso: 60, meta: 85, ativo: true }] } });
    confere("pesos que não somam 100 aparecem como pendência (e bloqueiam a publicação)", soma.corpo.pendenciasPublicacao.some((t: string) => t.includes("somar 100")) && (await P(`/ciclos/${c99.id}/publicar`, tAdmin, { method: "POST" })).status === 400);
    await P(`/ciclos/${c99.id}`, tAdmin, { method: "PUT", body: { indicadores: [{ chave: "produtividade", peso: 50, meta: 85, ativo: true }] } });
    if (tGestor) confere("gestor da Consultoria passa da guarda de editar ciclo (corpo inválido = 400, não 403)", (await P(`/ciclos/${c99.id}`, tGestor, { method: "PUT", body: { amostraMinimaHoras: -1 } })).status === 400);

    confere("ciclo inexistente = 404", (await P("/ciclos/999999999", tAdmin, { method: "PUT", body: {} })).status === 404 && (await P("/ciclos/abc/publicar", tAdmin, { method: "POST" })).status === 404);
    const pub = await P(`/ciclos/${c99.id}/publicar`, tAdmin, { method: "POST" });
    confere("publica", pub.status === 200 && pub.corpo.status === "publicado" && pub.corpo.editavel === false, JSON.stringify(pub.corpo).slice(0, 160));
    const trava = await P(`/ciclos/${c99.id}`, tAdmin, { method: "PUT", body: { metaEficienciaGlobal: 10 } });
    confere("ciclo publicado TRAVA os parâmetros (409) e a meta não muda", trava.status === 409 && (await P("/ciclos", tAdmin)).corpo.ciclos.find((c: any) => c.id === c99.id).metaEficienciaGlobal === 80);
    confere("não publica duas vezes (409)", (await P(`/ciclos/${c99.id}/publicar`, tAdmin, { method: "POST" })).status === 409);
    confere("só encerra depois do último dia (409)", (await P(`/ciclos/${c99.id}/encerrar`, tAdmin, { method: "POST" })).status === 409);

    // ---- participantes ----
    const lista0 = await P("/participantes", tAdmin);
    confere("lista de participantes (admin vê valores)", lista0.status === 200 && lista0.corpo.mostraValores === true);
    if (lista0.corpo.participantes.length > 0) console.warn(`AVISO: já existem ${lista0.corpo.participantes.length} participantes reais no banco local; o teste só mexe nos que ele cria.`);

    // Escolhe consultores REAIS com horas na área (jul-dez/2026) pra a prévia ter dado: dois do time do gestor e um de fora, se existirem.
    const itens = await carregarItensDoCiclo({ inicio: "2026-07-01", fim: "2026-12-31", departamentosArea: [8, 9] });
    const todosPorHoras = [...indicesDoCiclo(itens).porConsultor.entries()].filter(([, a]) => a.executado > 0).sort((x, y) => y[1].executado - x[1].executado);
    const porHoras = todosPorHoras.filter(([, a]) => a.executado >= 600).map(([codfor]) => codfor);
    let visiveisGestor: Set<number> | null = null;
    if (gestor) {
      const user = await prisma.user.findUnique({ where: { id: gestor.userId }, select: { email: true } });
      // Mesmo recorte da API: o time do gestor no Plano é só o dos departamentos da Consultoria que ele gerencia.
      const ctx = await resolverContextoConsultor(user!.email);
      ctx.departamentosGerenciados = ctx.departamentosGerenciados.filter((d) => DEPEXES_PLANO_EVOLUCAO.includes(d));
      visiveisGestor = await codforsDoTime("gestor", ctx);
    }
    const jaNoPlano = new Set((await prisma.planoParticipante.findMany({ select: { codfor: true } })).map((p) => p.codfor));
    // Só integrante ativo de um departamento da área do ciclo atual pode aderir (20/10/2026): os participantes de teste saem daí.
    const opcoesAntes = await P("/participantes/opcoes", tAdmin);
    const departamentosOpcoes: any[] = opcoesAntes.corpo?.departamentos ?? [];
    const daArea = new Set<number>(departamentosOpcoes.flatMap((d: any) => d.integrantes.map((i: any) => i.codfor)));
    const areaDoCiclo: number[] = (await prisma.planoCiclo.findUnique({ where: { id: opcoesAntes.corpo?.ciclo?.id ?? -1 } }))?.departamentosArea ?? [];
    confere(
      "opções de adesão: ciclo atual, só os departamentos da área, cada integrante com jaNoPlano",
      opcoesAntes.status === 200 && opcoesAntes.corpo.ciclo != null && departamentosOpcoes.map((d: any) => d.depexe).join(",") === areaDoCiclo.join(",") && daArea.size > 0 && departamentosOpcoes.every((d: any) => d.integrantes.every((i: any) => typeof i.jaNoPlano === "boolean")),
      JSON.stringify({ ciclo: opcoesAntes.corpo?.ciclo, deps: departamentosOpcoes.map((d: any) => `${d.depexe}:${d.integrantes.length}`), area: areaDoCiclo })
    );
    // Os dois primeiros são os de mais horas (>= 10 h: têm base pra a conta de percentuais); o 3º é alguém do time do gestor, mesmo com poucas horas.
    const candidatos = porHoras.filter((c) => !jaNoPlano.has(c) && daArea.has(c));
    const escolhidos: number[] = candidatos.slice(0, 2);
    if (escolhidos.length < 2) throw new Error("sem consultores com horas suficientes na área para testar a prévia");
    const membroDoTime = todosPorHoras.map(([c]) => c).find((c) => !jaNoPlano.has(c) && !escolhidos.includes(c) && daArea.has(c) && visiveisGestor?.has(c)) ?? [...(visiveisGestor ?? [])].find((c) => !jaNoPlano.has(c) && !escolhidos.includes(c) && daArea.has(c));
    const doTime = [...escolhidos.filter((c) => visiveisGestor?.has(c)), ...(membroDoTime != null ? [membroDoTime] : [])];
    const deFora = escolhidos.filter((c) => visiveisGestor != null && !visiveisGestor.has(c));
    console.log(`participantes de teste: ${escolhidos.join(", ")}${membroDoTime != null ? ` + ${membroDoTime} (do time do gestor)` : ""}; do time do gestor: ${doTime.join(",") || "nenhum"}; de fora: ${deFora.join(",") || "nenhum"}`);

    const invalidosP = [
      { codfor: 99999999, dataAdesao: "2026-06-01", valorHoraBase: 100 },
      { codfor: escolhidos[0], dataAdesao: "2026-02-31", valorHoraBase: 100 },
      { codfor: escolhidos[0], dataAdesao: "2026-06-01", valorHoraBase: 0 },
      { codfor: escolhidos[0], dataAdesao: "2026-06-01", valorHoraBase: 100, ciclosConsecutivosAntes: 10 },
      { dataAdesao: "2026-06-01", valorHoraBase: 100 },
    ];
    for (const corpo of invalidosP) confere(`adesão inválida = 400 (${JSON.stringify(corpo).slice(0, 60)})`, (await P("/participantes", tAdmin, { method: "POST", body: corpo })).status === 400);

    const adesoes: { codfor: number; id: number; base: number; consecutivos: number }[] = [];
    const planos = [
      { codfor: escolhidos[0], dataAdesao: "2026-06-01", valorHoraBase: 100, ciclosConsecutivosAntes: 0 },
      { codfor: escolhidos[1], dataAdesao: "2027-03-10", valorHoraBase: 150.5, ciclosConsecutivosAntes: 4 },
      ...(membroDoTime != null ? [{ codfor: membroDoTime, dataAdesao: "2026-06-01", valorHoraBase: 90, ciclosConsecutivosAntes: 0 }] : []),
    ];
    for (const plano of planos) {
      const r = await P("/participantes", tAdmin, { method: "POST", body: plano });
      confere(`adesão do consultor ${plano.codfor} = 201`, r.status === 201, JSON.stringify(r.corpo).slice(0, 160));
      if (r.status === 201) {
        participantesCriados.add(r.corpo.id);
        adesoes.push({ codfor: plano.codfor, id: r.corpo.id, base: plano.valorHoraBase, consecutivos: plano.ciclosConsecutivosAntes });
        confere(`1º ciclo calculado da adesão (${plano.dataAdesao})`, r.corpo.primeiroCicloInicio === (plano.dataAdesao <= "2027-01-01" ? "2027-01-01" : "2027-07-01"), r.corpo.primeiroCicloInicio);
      }
    }
    confere("adesão repetida = 409", (await P("/participantes", tAdmin, { method: "POST", body: planos[0] })).status === 409);
    const opcoes = await P("/participantes/opcoes", tAdmin);
    const integrantesDepois: any[] = (opcoes.corpo?.departamentos ?? []).flatMap((d: any) => d.integrantes);
    confere("as opções de adesão marcam quem já está no plano (jaNoPlano)", opcoes.status === 200 && adesoes.every((a) => integrantesDepois.some((i) => i.codfor === a.codfor && i.jaNoPlano === true)));
    // Consultor ativo no cadastro, mas fora do time dos departamentos da área: o servidor recusa, como a tela não oferece.
    const foraDaArea = await prisma.consultor.findFirst({ where: { codfor: { notIn: [...daArea, ...jaNoPlano] }, sitfor: "A" }, select: { codfor: true } });
    if (foraDaArea?.codfor != null) {
      const r = await P("/participantes", tAdmin, { method: "POST", body: { codfor: foraDaArea.codfor, dataAdesao: "2026-06-01", valorHoraBase: 100 } });
      confere("adesão de quem não é integrante ativo da área = 400", r.status === 400, JSON.stringify(r.corpo).slice(0, 160));
      if (r.status === 201) participantesCriados.add(r.corpo.id);
    }

    // ---- adesão em lote (modal com vários marcados): tudo ou nada ----
    const livres = [...daArea].filter((c) => !jaNoPlano.has(c) && !adesoes.some((a) => a.codfor === c)).slice(0, 2);
    if (livres.length === 2) {
      const L = (corpo: unknown) => P("/participantes/lote", tAdmin, { method: "POST", body: corpo });
      const base = { dataAdesao: "2026-06-01", ciclosConsecutivosAntes: 0 };
      if (foraDaArea?.codfor != null) {
        const r = await L({ ...base, itens: [{ codfor: livres[0], valorHoraBase: 100 }, { codfor: foraDaArea.codfor, valorHoraBase: 100 }] });
        const gravou = await prisma.planoParticipante.findUnique({ where: { codfor: livres[0] } });
        confere("lote com um consultor fora da área = 400 e NÃO grava nenhum (tudo ou nada)", r.status === 400 && gravou == null, JSON.stringify(r.corpo).slice(0, 160));
        if (gravou) participantesCriados.add(gravou.id);
      }
      confere("lote com o mesmo consultor duas vezes = 400", (await L({ ...base, itens: [{ codfor: livres[0], valorHoraBase: 100 }, { codfor: livres[0], valorHoraBase: 90 }] })).status === 400);
      confere("lote sem itens ou com valor inválido = 400", (await L({ ...base, itens: [] })).status === 400 && (await L({ ...base, itens: [{ codfor: livres[0], valorHoraBase: 0 }] })).status === 400);
      if (tGestor) confere("gestor da Consultoria passa da guarda da adesão em lote (valor inválido = 400, não 403)", (await P("/participantes/lote", tGestor, { method: "POST", body: { ...base, itens: [{ codfor: livres[0], valorHoraBase: 0 }] } })).status === 400);
      const ok = await L({ ...base, itens: [{ codfor: livres[0], valorHoraBase: 110.5 }, { codfor: livres[1], valorHoraBase: 95 }] });
      for (const c of ok.corpo?.criados ?? []) participantesCriados.add(c.id);
      const valores = await prisma.planoValorBase.findMany({ where: { participanteId: { in: (ok.corpo?.criados ?? []).map((c: any) => c.id) } }, select: { valorHoraBase: true } });
      confere(
        "lote válido = 201 com as duas adesões, cada uma com o seu Valor Hora Base",
        ok.status === 201 && ok.corpo.criados.length === 2 && valores.map((v) => Number(v.valorHoraBase)).sort((a, b) => a - b).join(",") === "95,110.5",
        JSON.stringify(ok.corpo).slice(0, 200)
      );
    }

    // ---- valor base: histórico nunca reescrito ----
    const [p1, p2, p3] = adesoes;
    const rv = await P(`/participantes/${p1.id}/valor-base`, tAdmin, { method: "POST", body: { valorHoraBase: 120, desde: "2026-06-15", motivo: "reajuste", observacao: "teste" } });
    confere("lança novo Valor Hora Base", rv.status === 201 && rv.corpo.historicoBase.length === 2 && rv.corpo.historicoBase[0].desde === "2026-06-15", JSON.stringify(rv.corpo).slice(0, 200));
    await P(`/participantes/${p1.id}/valor-base`, tAdmin, { method: "POST", body: { valorHoraBase: 999, desde: "2026-09-01", motivo: "reajuste" } });
    confere("valor base com a mesma vigência = 409", (await P(`/participantes/${p1.id}/valor-base`, tAdmin, { method: "POST", body: { valorHoraBase: 130, desde: "2026-06-15", motivo: "reajuste" } })).status === 409);
    confere("valor base inválido = 400", (await P(`/participantes/${p1.id}/valor-base`, tAdmin, { method: "POST", body: { valorHoraBase: -5, desde: "2026-06-20", motivo: "reajuste" } })).status === 400 && (await P(`/participantes/${p1.id}/valor-base`, tAdmin, { method: "POST", body: { valorHoraBase: 100, desde: "2026-06-20", motivo: "outro" } })).status === 400);
    confere("participante inexistente = 404", (await P("/participantes/999999999/valor-base", tAdmin, { method: "POST", body: { valorHoraBase: 100, desde: "2026-06-20", motivo: "reajuste" } })).status === 404);
    if (tGestor) confere("gestor da Consultoria passa da guarda do valor base (inválido = 400, não 403)", (await P(`/participantes/${p1.id}/valor-base`, tGestor, { method: "POST", body: { valorHoraBase: -1, desde: "2026-07-20", motivo: "reajuste" } })).status === 400);

    // ---- prévia: ciclo de ENSAIO 2026/2 (só cria se ainda não existir; senão usa o existente sem alterar) ----
    let c26 = await prisma.planoCiclo.findUnique({ where: { ano_semestre: { ano: 2026, semestre: 2 } } });
    const criouEnsaio = !c26;
    if (!c26) {
      const r = await P("/ciclos", tAdmin, { method: "POST", body: { ano: 2026, semestre: 2 } });
      confere("cria o ciclo de ensaio 2026/2", r.status === 201);
      ciclosCriados.add(r.corpo.id);
      await P(`/ciclos/${r.corpo.id}`, tAdmin, {
        method: "PUT",
        body: { metaEficienciaGlobal: 1, amostraMinimaHoras: 10, definicaoOnline: "A", indicadores: [{ chave: "produtividade", peso: 50, meta: 1, ativo: true }, { chave: "apontamento_online", peso: 30, meta: 0.01, ativo: true }] },
      });
      c26 = await prisma.planoCiclo.findUnique({ where: { id: r.corpo.id } });
    } else {
      console.warn("AVISO: já existe o ciclo 2026/2; as verificações de prévia usam os parâmetros dele.");
    }
    const prev = await P(`/ciclos/${c26!.id}/previa`, tAdmin);
    confere("prévia do ensaio = 200", prev.status === 200 && prev.corpo.ensaio === true && prev.corpo.mostraValores === true, JSON.stringify(prev.corpo).slice(0, 160));
    if (prev.status === 200) {
      // O global da prévia tem que bater com o motor rodando direto sobre os mesmos itens.
      const direto = indicesDoCiclo(await carregarItensDoCiclo({ inicio: "2026-07-01", fim: "2026-12-31", departamentosArea: c26!.departamentosArea }));
      confere("global da prévia = motor sobre os mesmos itens", prev.corpo.global.executadoMin === direto.global.executado && prev.corpo.global.dentroMin === direto.global.dentro && prev.corpo.global.acimaMin === direto.global.acima, JSON.stringify(prev.corpo.global));
      for (const a of adesoes) {
        const c = prev.corpo.consultores.find((x: any) => x.codfor === a.codfor);
        confere(`consultor ${a.codfor} aparece na prévia`, !!c);
        if (!c) continue;
        const d = direto.porConsultor.get(a.codfor);
        confere(`consultor ${a.codfor}: horas e produtividade batem com o motor`, c.produtividade.horasMin === (d?.executado ?? 0) && c.produtividade.dentroMin === (d?.dentro ?? 0));
        confere(`consultor ${a.codfor}: os requisitos do gestor ficam pendentes e há projeção`, ["competencias", "certificacoes", "avaliacaoClientes", "caseTecnico"].every((k) => c.pendentes.includes(k)) && c.projecao?.comGlobal?.statusRotulo !== undefined, JSON.stringify(c.projecao));
      }
      // Percentuais e valores projetados (metas 1% / 0,01%: todo automático com amostra é atingido; o resto vem do reforçador e da base).
      const cA = prev.corpo.consultores.find((x: any) => x.codfor === p1.codfor);
      if (criouEnsaio && cA?.produtividade.semBase === false) {
        confere("sem consecutivos anteriores: 5% com global e 4% sem global", cA.projecao.comGlobal.percentualBp === 500 && cA.projecao.semGlobal.percentualBp === 400, JSON.stringify(cA.projecao));
        confere("valor projetado = base vigente em 01/07/2026 (R$ 120 do reajuste de 15/06; o de 01/09 ainda não vale) × 1,05", cA.valorHoraBase === 120 && cA.projecao.comGlobal.valorHora === 126, `${cA.valorHoraBase} ${cA.projecao.comGlobal.valorHora}`);
      }
      const cB = prev.corpo.consultores.find((x: any) => x.codfor === p2.codfor);
      if (criouEnsaio && cB?.produtividade.semBase === false) {
        confere("4 ciclos já cumpridos: reforçador de 2,0 p.p. (7% com global, R$ 150,50 → 161,04)", cB.projecao.comGlobal.percentualBp === 700 && cB.projecao.comGlobal.valorHora === 161.04, JSON.stringify(cB.projecao.comGlobal));
      }

      // Gestor da Consultoria = administrador do Plano: vê todos os participantes, com valores em R$, como o admin.
      if (tGestor) {
        const g = await P(`/ciclos/${c26!.id}/previa`, tGestor);
        const a = await P(`/ciclos/${c26!.id}/previa`, tAdmin);
        confere("gestor da Consultoria lê a prévia com valores, igual ao admin", g.status === 200 && g.corpo.mostraValores === true && g.corpo.consultores.length === a.corpo.consultores.length, JSON.stringify(g.corpo).slice(0, 120));
        for (const fora of deFora) confere(`consultor ${fora} (de outro departamento da área) aparece pro gestor da Consultoria`, g.corpo.consultores.some((c: any) => c.codfor === fora));
        const gl = await P("/participantes", tGestor);
        const al = await P("/participantes", tAdmin);
        // Igual ao admin (valor vigente hoje pode ser null para quem só começa depois; o que importa é vir o mesmo campo e histórico).
        confere("gestor da Consultoria lista todos os participantes com valores, igual ao admin", gl.status === 200 && gl.corpo.mostraValores === true && JSON.stringify(gl.corpo.participantes) === JSON.stringify(al.corpo.participantes) && adesoes.every((ad) => gl.corpo.participantes.some((p: any) => p.codfor === ad.codfor && "valorHoraBase" in p && Array.isArray(p.historicoBase))));
        confere("a prévia de ciclo inexistente = 404", (await P("/ciclos/999999999/previa", tGestor)).status === 404);
      }
    }

    // ---- /meu: o consultor vê só o próprio andamento ----
    for (const a of adesoes) {
      const cons = await prisma.consultor.findFirst({ where: { codfor: a.codfor, email: { not: null } }, select: { email: true } });
      const user = cons?.email ? await prisma.user.findFirst({ where: { email: { equals: cons.email, mode: "insensitive" }, status: "ativo" }, select: { id: true, role: { select: { name: true } } } }) : null;
      if (!user) continue;
      const m = await P("/meu", signToken({ userId: user.id, role: user.role.name }));
      confere(`/meu do consultor ${a.codfor} = 200 com o próprio andamento e sem lista de colegas`, m.status === 200 && m.corpo.consultor?.codfor === a.codfor && m.corpo.consultores === undefined, JSON.stringify(m.corpo).slice(0, 160));
      confere(`/meu mostra o valor dele e o histórico de base`, Array.isArray(m.corpo.participante?.historicoBase) && m.corpo.participante.historicoBase.length >= 1);
      break;
    }

    // ---- encerramento da participação ----
    confere("encerrar sem motivo = 400", (await P(`/participantes/${p2.id}/encerrar`, tAdmin, { method: "POST", body: {} })).status === 400);
    confere("encerra a participação", (await P(`/participantes/${p2.id}/encerrar`, tAdmin, { method: "POST", body: { motivo: "teste" } })).status === 200);
    confere("encerrar de novo = 409", (await P(`/participantes/${p2.id}/encerrar`, tAdmin, { method: "POST", body: { motivo: "teste" } })).status === 409);
    const prev2 = await P(`/ciclos/${c26!.id}/previa`, tAdmin);
    confere("quem encerrou sai da prévia", !prev2.corpo.consultores.some((c: any) => c.codfor === p2.codfor) && prev2.corpo.consultores.some((c: any) => c.codfor === p1.codfor));

    // ---- auditoria: o histórico do participante traz valor hora e só o admin enxerga ----
    const eventos = await prisma.auditEvento.findMany({ where: { ocorridoEm: { gte: inicio }, entidadeTipo: { in: ["plano_ciclo", "plano_participante"] } }, select: { eventoTipo: true, entidadeTipo: true, alteracoes: true } });
    const tipos = eventos.map((e) => e.eventoTipo);
    confere("auditoria do ciclo: criado, alterado e publicado", ["PLANO_CICLO_CRIADO", "PLANO_CICLO_ALTERADO", "PLANO_CICLO_PUBLICADO"].every((t) => tipos.includes(t)), tipos.join());
    confere("auditoria do participante: adesão, valor base e encerramento", ["PLANO_PARTICIPANTE_ADERIU", "PLANO_PARTICIPANTE_VALOR_BASE_ALTERADO", "PLANO_PARTICIPANTE_ENCERRADO"].every((t) => tipos.includes(t)), tipos.join());
    const alt = eventos.find((e) => e.eventoTipo === "PLANO_CICLO_ALTERADO" && JSON.stringify(e.alteracoes).includes("metaEficienciaGlobal"));
    confere("a alteração do ciclo registra a meta (de/para)", !!alt);

    const idP = p1.id;
    const aAdmin = await chamar(`/auditoria/entidade/plano_participante/${idP}`, tAdmin);
    confere("admin vê o histórico do participante", aAdmin.status === 200, `${aAdmin.status}`);
    const lAdmin = await chamar(`/auditoria?entidadeTipo=plano_participante&limit=50`, tAdmin);
    confere("admin lista os eventos do participante", lAdmin.status === 200 && lAdmin.corpo.rows.length > 0);
    if (tGestor) {
      confere("gestor NÃO vê o histórico do participante (403)", (await chamar(`/auditoria/entidade/plano_participante/${idP}`, tGestor)).status === 403);
      const lG = await chamar(`/auditoria?entidadeTipo=plano_participante&limit=50`, tGestor);
      confere("gestor lista ZERO eventos de participante", lG.status === 200 && lG.corpo.rows.length === 0, JSON.stringify(lG.corpo).slice(0, 100));
      const lGeral = await chamar(`/auditoria?limit=200&de=${inicio.toISOString()}`, tGestor);
      confere("na lista geral o gestor também não recebe o participante", lGeral.status === 200 && !lGeral.corpo.rows.some((r: any) => r.entidadeTipo === "plano_participante"));
      const csv = await chamar(`/auditoria/export?de=${inicio.toISOString()}`, tGestor);
      confere("na exportação CSV o gestor também não recebe o participante", csv.status === 200 && !String(csv.corpo).includes("plano_participante"));
      confere("o ciclo (sem valor hora) o gestor ainda vê", (await chamar(`/auditoria/entidade/plano_ciclo/${c99.id}`, tGestor)).status === 200);
    }
    const csvAdmin = await chamar(`/auditoria/export?de=${inicio.toISOString()}`, tAdmin);
    confere("na exportação o admin recebe o participante", csvAdmin.status === 200 && String(csvAdmin.corpo).includes("plano_participante"));
  } finally {
    // Limpeza: tudo o que este script criou (ciclos 2099/2026 de teste, participantes e a auditoria deles).
    const au = await prisma.auditEvento.deleteMany({ where: { entidadeTipo: { in: ["plano_ciclo", "plano_participante"] }, ocorridoEm: { gte: inicio } } });
    const pa = await prisma.planoParticipante.deleteMany({ where: { id: { in: [...participantesCriados] } } });
    const ci = await prisma.planoCiclo.deleteMany({ where: { id: { in: [...ciclosCriados] } } });
    console.log(`limpeza: ${ci.count} ciclos, ${pa.count} participantes e ${au.count} eventos de auditoria de teste apagados`);
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
