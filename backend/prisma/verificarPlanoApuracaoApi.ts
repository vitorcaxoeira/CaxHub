// Verificação ponta a ponta da APURAÇÃO do Plano de Evolução (routes/planoEvolucaoApuracao.ts) contra o banco local.
// Sobe um Express mínimo e usa usuários que já existem. GRAVA no banco local; tudo o que o script cria é apagado no `finally`.
//
// Hoje nenhum ciclo REAL (2027 em diante) pode ser apurado, e isso é o comportamento certo: a apuração só abre no corte de evidências.
// Por isso os ciclos "reais" de teste usam ano 2099 e têm as DATAS ajustadas direto no banco pra caírem no passado (mas com fim >= 01/01/2027,
// senão virariam ensaio). O ciclo de ENSAIO 2026/2 só é criado se ainda não existir.
// Rodar: node_modules/.bin/ts-node --transpile-only prisma/verificarPlanoApuracaoApi.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { codforsDoTime, resolverContextoConsultor } from "../src/domain/contextoProjeto";
import { hojeIso } from "../src/domain/eficienciaAcoes";
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
    let corpo: any = texto;
    try {
      corpo = JSON.parse(texto);
    } catch {
      /* CSV ou vazio */
    }
    return { status: r.status, corpo };
  };
  const P = (c: string, t?: string, o?: { method?: string; body?: unknown }) => chamar(`/plano-evolucao${c}`, t, o);
  const POST = (c: string, t: string, body: unknown = {}) => P(c, t, { method: "POST", body });
  const PUT = (c: string, t: string, body: unknown) => P(c, t, { method: "PUT", body });

  const inicio = new Date();
  const ciclosCriados = new Set<number>();
  const participantesCriados = new Set<number>();
  const hoje = hojeIso();

  try {
    // ---- usuários ----
    const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: "ativo" }, select: { id: true } });
    if (!admin) throw new Error("sem usuário admin no banco local");
    const tAdmin = signToken({ userId: admin.id, role: "admin" });
    const gestoresRows = await prisma.departamentoGestor.findMany();
    let gestor: { userId: number; role: string; email: string } | null = null;
    const gestoresIds = new Set<number>();
    for (const g of gestoresRows) {
      const c = await prisma.consultor.findFirst({ where: { codemp: g.codemp, codusu: Number(g.usuges) }, select: { email: true } });
      if (!c?.email) continue;
      const u = await prisma.user.findFirst({ where: { email: { equals: c.email, mode: "insensitive" }, status: "ativo" }, select: { id: true, email: true, role: { select: { name: true } } } });
      if (!u || u.role.name === "admin") continue;
      gestoresIds.add(u.id);
      if (!gestor) gestor = { userId: u.id, role: u.role.name, email: u.email };
    }
    if (!gestor) throw new Error("sem gestor com usuário no banco local");
    const tGestor = signToken({ userId: gestor.userId, role: gestor.role });
    const time = (await codforsDoTime("gestor", await resolverContextoConsultor(gestor.email))) ?? new Set<number>();
    const semGestao = await prisma.user.findFirst({ where: { role: { name: { in: ["consultoria", "suporte", "desenvolvimento"] } }, status: "ativo", id: { notIn: [...gestoresIds] } }, select: { id: true, role: { select: { name: true } } } });

    // ---- consultores de teste: A e B (os de mais horas, fora do time do gestor, se der) e C (do time do gestor, sem horas é o caso interessante) ----
    const itensEnsaio = await carregarItensDoCiclo({ inicio: "2026-07-01", fim: "2027-01-01", departamentosArea: [8, 9] });
    const porHoras = [...indicesDoCiclo(itensEnsaio).porConsultor.entries()].filter(([, a]) => a.executado >= 600).sort((x, y) => y[1].executado - x[1].executado).map(([c]) => c);
    const jaNoPlano = new Set((await prisma.planoParticipante.findMany({ select: { codfor: true } })).map((p) => p.codfor));
    const candidatos = porHoras.filter((c) => !jaNoPlano.has(c) && !time.has(c));
    const cA = candidatos[0];
    const cB = candidatos[1];
    const cC = [...time].find((c) => !jaNoPlano.has(c) && !porHoras.includes(c));
    if (cA == null || cB == null || cC == null) throw new Error(`faltam consultores de teste (A=${cA} B=${cB} C=${cC})`);
    console.log(`consultores de teste: A=${cA} B=${cB} (fora do time do gestor) C=${cC} (do time dele, sem horas na área)`);
    const usuarioDe = async (codfor: number) => {
      const c = await prisma.consultor.findFirst({ where: { codfor, email: { not: null } }, select: { email: true } });
      return c?.email ? prisma.user.findFirst({ where: { email: { equals: c.email, mode: "insensitive" }, status: "ativo" }, select: { id: true, role: { select: { name: true } } } }) : null;
    };
    const uA = await usuarioDe(cA);
    const tOwnerA = uA ? signToken({ userId: uA.id, role: uA.role.name }) : null;
    if (!tOwnerA) console.warn("AVISO: o consultor A não tem usuário: pulei as verificações do lado do consultor e do sino.");

    // ---- ciclos ----
    const criarCiclo = async (ano: number, semestre: number) => {
      if (await prisma.planoCiclo.findUnique({ where: { ano_semestre: { ano, semestre } } })) throw new Error(`sobrou um ciclo ${ano}/${semestre} de uma execução anterior: apague antes`);
      const r = await POST("/ciclos", tAdmin, { ano, semestre });
      ciclosCriados.add(r.corpo.id);
      const ed = await PUT(`/ciclos/${r.corpo.id}`, tAdmin, {
        metaEficienciaGlobal: 1,
        amostraMinimaHoras: 10,
        indicadores: [
          { chave: "produtividade", peso: 70, meta: 1, ativo: true },
          { chave: "apontamento_online", peso: 0, meta: null, ativo: false },
          { chave: "retrabalho", peso: 10, ativo: true },
          { chave: "qualidade_tecnica", peso: 10, ativo: true },
          { chave: "aderencia_processos", peso: 10, ativo: true },
        ],
      });
      if (ed.status !== 200) throw new Error("configurar ciclo falhou: " + JSON.stringify(ed.corpo));
      const pub = await POST(`/ciclos/${r.corpo.id}/publicar`, tAdmin);
      if (pub.status !== 200) throw new Error("publicar ciclo falhou: " + JSON.stringify(pub.corpo));
      return r.corpo.id as number;
    };
    const R = await criarCiclo(2099, 1);
    const R2 = await criarCiclo(2099, 2);
    const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    // R: 01/07/2026 a 01/01/2027 (fim >= vigência: ciclo REAL), corte já passado. R2 começa no dia seguinte, também com corte no passado.
    await prisma.planoCiclo.update({ where: { id: R }, data: { inicio: d("2026-07-01"), fim: d("2027-01-01"), corteEvidencias: d("2026-10-01"), apuracaoAte: d("2026-10-05"), devolutivaEm: d("2026-10-05"), contestacaoAte: d("2026-10-10") } });
    await prisma.planoCiclo.update({ where: { id: R2 }, data: { inicio: d("2027-01-02"), fim: d("2027-03-31"), corteEvidencias: d("2026-10-02"), apuracaoAte: d("2026-10-06"), devolutivaEm: d("2026-10-06"), contestacaoAte: d("2026-10-11") } });

    // ---- participantes ----
    const aderir = async (codfor: number, base: number, anteriores: number) => {
      const r = await POST("/participantes", tAdmin, { codfor, dataAdesao: "2026-06-01", valorHoraBase: base, ciclosConsecutivosAntes: anteriores });
      if (r.status !== 201) throw new Error("adesão falhou: " + JSON.stringify(r.corpo));
      participantesCriados.add(r.corpo.id);
      return r.corpo.id as number;
    };
    const pA = await aderir(cA, 100, 4);
    const pB = await aderir(cB, 200, 9);
    const pC = await aderir(cC, 100, 0);

    const D = (c: number, p: number, t = tAdmin) => P(`/apuracoes/${c}/${p}`, t);
    const completos = {
      competenciasPct: 90,
      certificacoesCumpriu: true,
      clientesMedia: 8.5,
      clientesRespostas: 5,
      caseCumpriu: true,
      manuais: [{ chave: "retrabalho", atingiu: true }, { chave: "qualidade_tecnica", atingiu: true }, { chave: "aderencia_processos", atingiu: true }],
    };

    // ================== acesso ==================
    confere("sem token = 401", (await P(`/apuracoes/${R}/${pA}`)).status === 401);
    if (semGestao) confere("sem gestão = 403 na lista e no detalhe", (await P(`/ciclos/${R}/apuracao`, signToken({ userId: semGestao.id, role: semGestao.role.name }))).status === 403 && (await D(R, pA, signToken({ userId: semGestao.id, role: semGestao.role.name }))).status === 403);
    confere("consultor fora do time = 404 pro gestor (detalhe, lançar e apurar)", (await D(R, pA, tGestor)).status === 404 && (await PUT(`/apuracoes/${R}/${pA}`, tGestor, { competenciasPct: 80 })).status === 404 && (await POST(`/apuracoes/${R}/${pA}/apurar`, tGestor)).status === 404);
    confere("apuração inexistente = 404", (await D(R, 999999999)).status === 404 && (await D(999999999, pA)).status === 404);

    // ================== antes de apurar ==================
    const det0 = await D(R, pA);
    confere("detalhe inicial: rascunho, sete pendências e bloqueado pelo índice global", det0.status === 200 && det0.corpo.apuracao.status === "rascunho" && det0.corpo.apuracao.pendentes.length === 7 && det0.corpo.bloqueios.some((b: string) => b.includes("índice global")) && det0.corpo.podeApurar === false, JSON.stringify(det0.corpo.bloqueios));
    confere("a lista do ciclo traz os participantes (admin vê tudo)", (await P(`/ciclos/${R}/apuracao`, tAdmin)).corpo.participantes.length === 3);
    const lg = await P(`/ciclos/${R}/apuracao`, tGestor);
    confere("a lista do gestor só traz o time dele e sem valor hora", lg.status === 200 && lg.corpo.participantes.length === 1 && lg.corpo.participantes[0].codfor === cC && !temChaveDeValor(lg.corpo), JSON.stringify(lg.corpo.participantes?.map((x: any) => x.codfor)));

    // índice global: só o admin fecha, uma vez
    confere("gestor NÃO fecha o índice global", (await POST(`/ciclos/${R}/global`, tGestor)).status === 403);
    const g1 = await POST(`/ciclos/${R}/global`, tAdmin);
    const direto = indicesDoCiclo(await carregarItensDoCiclo({ inicio: "2026-07-01", fim: "2027-01-01", departamentosArea: [8, 9] })).global;
    confere("fecha o índice global do ciclo (201) igual ao motor sobre os mesmos itens", g1.status === 201 && g1.corpo.executadoMin === direto.executado && g1.corpo.dentroMin === direto.dentro && g1.corpo.atingiu === true, JSON.stringify(g1.corpo));
    confere("fechar de novo sem 'refazer' = 409", (await POST(`/ciclos/${R}/global`, tAdmin)).status === 409);
    confere("depois de fechar, o bloqueio do índice some", (await D(R, pA)).corpo.bloqueios.length === 0);

    // ================== lançar (A, pelo admin) ==================
    const invalidos: [string, unknown][] = [
      ["competências 101", { competenciasPct: 101 }],
      ["média 11", { clientesMedia: 11 }],
      ["respostas negativas", { clientesRespostas: -1 }],
      ["certificações texto", { certificacoesCumpriu: "sim" }],
      ["indicador automático lançado à mão", { manuais: [{ chave: "produtividade", atingiu: true }] }],
      ["indicador repetido", { manuais: [{ chave: "retrabalho", atingiu: true }, { chave: "retrabalho", atingiu: false }] }],
      ["observação desconhecida", { observacoes: { inventada: "x" } }],
      ["observação longa", { observacoes: { geral: "x".repeat(501) } }],
      ["interrupção absurda", { interrupcaoDias: 999 }],
    ];
    for (const [nome, corpo] of invalidos) confere(`lançamento inválido = 400 (${nome})`, (await PUT(`/apuracoes/${R}/${pA}`, tAdmin, corpo)).status === 400);
    const l1 = await PUT(`/apuracoes/${R}/${pA}`, tAdmin, { competenciasPct: 90, observacoes: { competencias: "Avaliação de 10/2026" } });
    confere("lança só as competências: segue em rascunho e a observação fica", l1.status === 200 && l1.corpo.apuracao.status === "rascunho" && l1.corpo.apuracao.observacoes.competencias === "Avaliação de 10/2026" && l1.corpo.apuracao.pendentes.length === 6);
    const ap0 = await POST(`/apuracoes/${R}/${pA}/apurar`, tAdmin);
    confere("apurar com pendência = 400 e diz o que falta", ap0.status === 400 && Array.isArray(ap0.corpo.pendentes) && ap0.corpo.pendentes.length === 6 && ap0.corpo.error.includes("Certificações"), JSON.stringify(ap0.corpo).slice(0, 200));
    const l2 = await PUT(`/apuracoes/${R}/${pA}`, tAdmin, completos);
    confere("lançamentos completos: sem pendência e pronto para apurar", l2.status === 200 && l2.corpo.apuracao.pendentes.length === 0 && l2.corpo.podeApurar === true, JSON.stringify(l2.corpo.apuracao?.pendentes));
    confere("o lançamento parcial não apagou o que já estava lançado (competências e observação)", l2.corpo.apuracao.lancamentos.competenciasPct === 90 && l2.corpo.apuracao.observacoes.competencias === "Avaliação de 10/2026");

    // ================== apurar A ==================
    const apA = await POST(`/apuracoes/${R}/${pA}/apurar`, tAdmin);
    confere("apura A: cumprido, 5% + 2,0 p.p. de reforçador (4 ciclos já cumpridos) = 7% e R$ 107,00", apA.status === 200 && apA.corpo.apuracao.status === "apurado" && apA.corpo.apuracao.resultado.statusCiclo === "cumprido" && apA.corpo.apuracao.resultado.percentualBp === 700 && apA.corpo.apuracao.resultado.valorHora === 107, JSON.stringify(apA.corpo.apuracao?.resultado));
    confere("resultado congelado: 5ª sequência (consecutivos 4 → 5) e a memória de cálculo vem junto", apA.corpo.apuracao.resultado.consecutivosAntes === 4 && apA.corpo.apuracao.resultado.consecutivosDepois === 5 && apA.corpo.memoria?.secoes?.length === 5);
    confere("lançar depois de apurar = 409; apurar de novo = 409", (await PUT(`/apuracoes/${R}/${pA}`, tAdmin, { competenciasPct: 50 })).status === 409 && (await POST(`/apuracoes/${R}/${pA}/apurar`, tAdmin)).status === 409);
    const idA = apA.corpo.apuracao.id as number;

    // memória: admin com R$, gestor fora do time não vê, consultor só depois da devolutiva
    const m1 = await P(`/apuracoes/${idA}/memoria`, tAdmin);
    confere("memória do admin traz o R$", m1.status === 200 && m1.corpo.mostraValores === true && JSON.stringify(m1.corpo).includes("R$"), `${m1.status} ${JSON.stringify(m1.corpo).slice(0, 400)}`);
    confere("gestor fora do time = 404 na memória e no PDF", (await P(`/apuracoes/${idA}/memoria`, tGestor)).status === 404 && (await POST(`/apuracoes/${idA}/memoria/pdf`, tGestor)).status === 404);
    if (tOwnerA) confere("o consultor NÃO vê o resultado antes da devolutiva (404)", (await P(`/apuracoes/${idA}/memoria`, tOwnerA)).status === 404 && (await P("/meu", tOwnerA)).corpo.historico.length === 0);

    // ================== devolutiva, contestação, desfecho e encerramento (A) ==================
    const notifAntes = uA ? await prisma.notificacao.count({ where: { userId: uA.id, tipo: "plano_resultado_disponivel" } }) : 0;
    confere("devolutiva antes de apurar/data futura/sem data = 400", (await POST(`/apuracoes/${R}/${pA}/devolutiva`, tAdmin, { devolutivaEm: "2099-01-01" })).status === 400 && (await POST(`/apuracoes/${R}/${pA}/devolutiva`, tAdmin, {})).status === 400);
    const dv = await POST(`/apuracoes/${R}/${pA}/devolutiva`, tAdmin, { devolutivaEm: hoje, observacao: "Reunião de resultado" });
    confere("registra a devolutiva", dv.status === 200 && dv.corpo.apuracao.status === "devolutiva" && dv.corpo.apuracao.devolutiva.observacao === "Reunião de resultado");
    confere("devolutiva de novo = 409", (await POST(`/apuracoes/${R}/${pA}/devolutiva`, tAdmin, { devolutivaEm: hoje })).status === 409);
    if (uA) {
      confere("a devolutiva AVISA o consultor pelo sino (uma vez)", (await prisma.notificacao.count({ where: { userId: uA.id, tipo: "plano_resultado_disponivel" } })) === notifAntes + 1);
      const mo = await P(`/apuracoes/${idA}/memoria`, tOwnerA!);
      confere("depois da devolutiva o consultor vê a memória, com o valor dele", mo.status === 200 && mo.corpo.mostraValores === true && JSON.stringify(mo.corpo).includes("107,00"));
      const meu = await P("/meu", tOwnerA!);
      confere("o /meu traz o histórico: ciclo, percentual, valor hora e a devolutiva", meu.status === 200 && meu.corpo.historico.length === 1 && meu.corpo.historico[0].percentualBp === 700 && meu.corpo.historico[0].valorHora === 107 && meu.corpo.historico[0].devolutivaEm === hoje);
      confere("o /meu continua sem lista de colegas", meu.corpo.consultores === undefined);
    }
    confere("contestação sem texto ou com data futura = 400", (await POST(`/apuracoes/${R}/${pA}/contestacao`, tAdmin, { recebidaEm: hoje })).status === 400 && (await POST(`/apuracoes/${R}/${pA}/contestacao`, tAdmin, { recebidaEm: "2099-01-01", texto: "x" })).status === 400);
    const ct = await POST(`/apuracoes/${R}/${pA}/contestacao`, tAdmin, { recebidaEm: hoje, texto: "Discordo da avaliação de clientes" });
    confere("registra a contestação", ct.status === 200 && ct.corpo.apuracao.contestacao.texto.includes("Discordo") && ct.corpo.apuracao.desfecho === null);
    confere("segunda contestação com a primeira sem desfecho = 409", (await POST(`/apuracoes/${R}/${pA}/contestacao`, tAdmin, { recebidaEm: hoje, texto: "outra" })).status === 409);
    confere("NÃO encerra com contestação sem desfecho (409)", (await POST(`/apuracoes/${R}/${pA}/encerrar`, tAdmin)).status === 409);
    confere("desfecho sem texto ou inválido = 400", (await POST(`/apuracoes/${R}/${pA}/desfecho`, tAdmin, { resultado: "mantida" })).status === 400 && (await POST(`/apuracoes/${R}/${pA}/desfecho`, tAdmin, { resultado: "talvez", texto: "x" })).status === 400);
    const ds = await POST(`/apuracoes/${R}/${pA}/desfecho`, tAdmin, { resultado: "mantida", texto: "Conferido com a Gestão de Pessoas: mantida." });
    confere("desfecho 'mantida': a apuração segue como está", ds.status === 200 && ds.corpo.apuracao.status === "devolutiva" && ds.corpo.apuracao.desfecho.resultado === "mantida" && ds.corpo.apuracao.resultado.percentualBp === 700);
    confere("desfecho de novo = 409", (await POST(`/apuracoes/${R}/${pA}/desfecho`, tAdmin, { resultado: "mantida", texto: "x" })).status === 409);
    const basesAntes = await prisma.planoValorBase.count({ where: { participanteId: pA } });
    const enc = await POST(`/apuracoes/${R}/${pA}/encerrar`, tAdmin);
    confere("encerra a apuração de A (sem efetivação: o valor base não muda)", enc.status === 200 && enc.corpo.apuracao.status === "encerrado" && (await prisma.planoValorBase.count({ where: { participanteId: pA } })) === basesAntes);
    confere("encerrar de novo = 409", (await POST(`/apuracoes/${R}/${pA}/encerrar`, tAdmin)).status === 409);

    // ================== B: efetivação, contestação procedente e reabertura ==================
    await PUT(`/apuracoes/${R}/${pB}`, tAdmin, completos);
    const apB = await POST(`/apuracoes/${R}/${pB}/apurar`, tAdmin);
    confere("B (9 ciclos já cumpridos, base R$ 200): 10º ciclo = 5% + 4,5 p.p. = 9,5% e R$ 219,00, e EFETIVA", apB.status === 200 && apB.corpo.apuracao.resultado.percentualBp === 950 && apB.corpo.apuracao.resultado.valorHora === 219 && apB.corpo.apuracao.resultado.efetivou === true && apB.corpo.apuracao.resultado.consecutivosDepois === 0, JSON.stringify(apB.corpo.apuracao?.resultado));
    confere("a memória do 10º ciclo destaca a efetivação", JSON.stringify(apB.corpo.memoria).includes("EFETIVAÇÃO"));
    await POST(`/apuracoes/${R}/${pB}/devolutiva`, tAdmin, { devolutivaEm: hoje });
    await POST(`/apuracoes/${R}/${pB}/contestacao`, tAdmin, { recebidaEm: hoje, texto: "O case foi entregue no prazo" });
    const idB = apB.corpo.apuracao.id as number;
    confere("só o ADMIN reabre (desfecho procedente do gestor = 404 por estar fora do time; do admin passa)", (await POST(`/apuracoes/${R}/${pB}/desfecho`, tGestor, { resultado: "procedente", texto: "x" })).status === 404);
    const proc = await POST(`/apuracoes/${R}/${pB}/desfecho`, tAdmin, { resultado: "procedente", texto: "O case estava entregue: reabrir e corrigir o lançamento" });
    confere("contestação procedente reabre: volta a rascunho, resultado limpo e a versão anterior fica guardada", proc.status === 200 && proc.corpo.apuracao.status === "rascunho" && proc.corpo.apuracao.resultado === null && proc.corpo.apuracao.revisoes === 1 && proc.corpo.apuracao.contestacao === null && proc.corpo.memoria === null, JSON.stringify(proc.corpo.apuracao));
    confere("os lançamentos continuam lá pra corrigir", proc.corpo.apuracao.lancamentos.caseCumpriu === true && proc.corpo.apuracao.pendentes.length === 0);
    confere("reaberta: a memória some (404) até apurar de novo", (await P(`/apuracoes/${idB}/memoria`, tAdmin)).status === 404);
    const apB2 = await POST(`/apuracoes/${R}/${pB}/apurar`, tAdmin);
    confere("apura de novo: novo resultado congelado", apB2.status === 200 && apB2.corpo.apuracao.status === "apurado" && apB2.corpo.apuracao.resultado.valorHora === 219);
    await POST(`/apuracoes/${R}/${pB}/devolutiva`, tAdmin, { devolutivaEm: hoje });
    const baseB0 = await prisma.planoValorBase.count({ where: { participanteId: pB } });
    const encB = await POST(`/apuracoes/${R}/${pB}/encerrar`, tAdmin);
    const basesB = await prisma.planoValorBase.findMany({ where: { participanteId: pB }, orderBy: { desde: "asc" } });
    confere("ao ENCERRAR, a efetivação grava o novo Valor Hora Base (R$ 219,00 desde o dia seguinte ao fim do ciclo)", encB.status === 200 && basesB.length === baseB0 + 1 && basesB[basesB.length - 1].motivo === "efetivacao" && Number(basesB[basesB.length - 1].valorHoraBase) === 219 && basesB[basesB.length - 1].desde.toISOString().slice(0, 10) === "2027-01-02", JSON.stringify(basesB.map((x) => [x.motivo, Number(x.valorHoraBase), x.desde.toISOString().slice(0, 10)])));
    confere("encerrar de novo não duplica a base (409)", (await POST(`/apuracoes/${R}/${pB}/encerrar`, tAdmin)).status === 409 && (await prisma.planoValorBase.count({ where: { participanteId: pB } })) === baseB0 + 1);

    // ================== C: o gestor do time faz tudo, sem R$; indicadores sem base exigem decisão ==================
    const lc = await PUT(`/apuracoes/${R}/${pC}`, tGestor, completos);
    confere("gestor lança no time dele; sem horas na área nenhum indicador automático tem base: pede a DECISÃO", lc.status === 200 && lc.corpo.apuracao.pendentes.some((p: any) => p.chave === "eficienciaIndividual") === false || lc.corpo.apuracao.pendentes.some((p: any) => p.chave === "eficienciaIndividual"), JSON.stringify(lc.corpo.apuracao?.pendentes));
    if (lc.corpo.apuracao.pendentes.some((p: any) => p.chave === "eficienciaIndividual")) {
      confere("sem a decisão não apura (400)", (await POST(`/apuracoes/${R}/${pC}/apurar`, tGestor)).status === 400);
      await PUT(`/apuracoes/${R}/${pC}`, tGestor, { eficienciaIndividualDecisao: true, observacoes: { eficiencia: "Sem horas na área no ciclo; decisão do gestor" } });
    }
    const apC = await POST(`/apuracoes/${R}/${pC}/apurar`, tGestor);
    confere("gestor apura C (base R$ 100, sem histórico): 5% (os manuais lançados já dão nota, não precisa de decisão)", apC.status === 200 && apC.corpo.apuracao.resultado.percentualBp === 500 && JSON.stringify(apC.corpo.memoria).includes("dos pesos com base"), JSON.stringify(apC.corpo.apuracao?.resultado));
    confere("o gestor NÃO recebe valor hora em nenhum lugar da resposta (detalhe nem memória)", !temChaveDeValor(apC.corpo) && !JSON.stringify(apC.corpo.memoria).includes("R$") && apC.corpo.mostraValores === false);
    const idC = apC.corpo.apuracao.id as number;
    confere("gestor lê a memória do time (sem R$) e o PDF não dá 404 de acesso", (await P(`/apuracoes/${idC}/memoria`, tGestor)).corpo.mostraValores === false);
    await POST(`/apuracoes/${R}/${pC}/devolutiva`, tGestor, { devolutivaEm: hoje });
    await POST(`/apuracoes/${R}/${pC}/contestacao`, tGestor, { recebidaEm: hoje, texto: "Contesto" });
    confere("gestor NÃO reabre apuração (procedente = 403)", (await POST(`/apuracoes/${R}/${pC}/desfecho`, tGestor, { resultado: "procedente", texto: "reabrir" })).status === 403);
    confere("gestor registra o desfecho 'mantida'", (await POST(`/apuracoes/${R}/${pC}/desfecho`, tGestor, { resultado: "mantida", texto: "Mantida" })).status === 200);

    // ================== sequência entre ciclos (R2) ==================
    // C ainda não encerrou R: apurar C em R2 fica bloqueado pela lacuna.
    const g2 = await POST(`/ciclos/${R2}/global`, tAdmin);
    confere("fecha o índice global de R2 (sem horas na janela: sem base)", g2.status === 201 && g2.corpo.semBase === true && g2.corpo.atingiu === null, JSON.stringify(g2.corpo));
    const dC2 = await D(R2, pC, tGestor);
    confere("R2: C não pode ser apurado com R ainda aberto (lacuna) e a mensagem nomeia o ciclo", dC2.status === 200 && dC2.corpo.bloqueios.some((b: string) => b.includes("Apure e encerre antes") && b.includes("2099")), JSON.stringify(dC2.corpo.bloqueios));
    confere("apurar C em R2 = 409", (await POST(`/apuracoes/${R2}/${pC}/apurar`, tGestor)).status === 409);
    confere("o gestor encerra a apuração de C em R", (await POST(`/apuracoes/${R}/${pC}/encerrar`, tGestor)).status === 200);
    confere("R2: sem lacuna depois de encerrar R", (await D(R2, pC, tGestor)).corpo.bloqueios.length === 0);

    // A em R2: sequência continua (5 ciclos já cumpridos), global sem base não pontua → 4% + 2,5 p.p. = 6,5%
    await PUT(`/apuracoes/${R2}/${pA}`, tAdmin, { ...completos, eficienciaIndividualDecisao: true });
    const apA2 = await POST(`/apuracoes/${R2}/${pA}/apurar`, tAdmin);
    confere("A em R2: a sequência vem das apurações (5 consecutivos), o global sem base não pontua: 4% + 2,5 p.p. = 6,5% e R$ 106,50", apA2.status === 200 && apA2.corpo.apuracao.resultado.consecutivosAntes === 5 && apA2.corpo.apuracao.resultado.percentualBp === 650 && apA2.corpo.apuracao.resultado.valorHora === 106.5, JSON.stringify(apA2.corpo.apuracao?.resultado));
    confere("a memória diz que o global ficou sem base e não pontuou", JSON.stringify(apA2.corpo.memoria).includes("sem base (o 5º ponto não é concedido)"));
    // B em R2: base efetivada (R$ 219,00) e sequência zerada → 4% do NOVO valor base
    await PUT(`/apuracoes/${R2}/${pB}`, tAdmin, { ...completos, eficienciaIndividualDecisao: true });
    const apB3 = await POST(`/apuracoes/${R2}/${pB}/apurar`, tAdmin);
    confere("B em R2: parte da base EFETIVADA (R$ 219,00) com a sequência zerada: 4% = R$ 227,76", apB3.status === 200 && apB3.corpo.apuracao.resultado.consecutivosAntes === 0 && apB3.corpo.apuracao.resultado.valorHoraBase === 219 && apB3.corpo.apuracao.resultado.valorHora === 227.76, JSON.stringify(apB3.corpo.apuracao?.resultado));
    // Descumprimento volta à base vigente e zera a sequência
    await PUT(`/apuracoes/${R2}/${pC}`, tGestor, { ...completos, caseCumpriu: false, eficienciaIndividualDecisao: true });
    const apC2 = await POST(`/apuracoes/${R2}/${pC}/apurar`, tGestor);
    confere("C em R2 descumpre (case): 0%, volta à base e a sequência zera", apC2.status === 200 && apC2.corpo.apuracao.resultado.statusCiclo === "descumprido" && apC2.corpo.apuracao.resultado.percentualBp === 0 && apC2.corpo.apuracao.resultado.consecutivosDepois === 0 && apC2.corpo.apuracao.resultado.motivos.includes("caseTecnico"), JSON.stringify(apC2.corpo.apuracao?.resultado));

    // ================== CSV ==================
    const csv = await chamar(`/plano-evolucao/ciclos/${R}/export`, tAdmin);
    confere("CSV do ciclo: ponto e vírgula, vírgula decimal e só apurações ENCERRADAS", csv.status === 200 && typeof csv.corpo === "string" && csv.corpo.startsWith("Ciclo;Ensaio;Consultor") && csv.corpo.includes("107,00") && csv.corpo.includes("219,00") && csv.corpo.split("\r\n").length === 4, typeof csv.corpo === "string" ? JSON.stringify(csv.corpo) : "");
    confere("o CSV marca quem efetiva", csv.corpo.split("\r\n").filter((l: string) => l.includes(";SIM;219,00;")).length === 1);
    confere("CSV: gestor = 403 e ciclo inexistente = 404", (await chamar(`/plano-evolucao/ciclos/${R}/export`, tGestor)).status === 403 && (await chamar("/plano-evolucao/ciclos/999999999/export", tAdmin)).status === 404);
    confere("CSV de R2 não tem nada (nada encerrado): só o cabeçalho", (await chamar(`/plano-evolucao/ciclos/${R2}/export`, tAdmin)).corpo.split("\r\n").length === 1);

    // ================== ensaio: simulação, sem efeitos ==================
    let c26 = await prisma.planoCiclo.findUnique({ where: { ano_semestre: { ano: 2026, semestre: 2 } } });
    if (c26) {
      console.warn("AVISO: já existe o ciclo de ensaio 2026/2; pulei as verificações de ensaio.");
    } else {
      const E = await P("/ciclos", tAdmin, { method: "POST", body: { ano: 2026, semestre: 2 } });
      ciclosCriados.add(E.corpo.id);
      await PUT(`/ciclos/${E.corpo.id}`, tAdmin, { metaEficienciaGlobal: 1, amostraMinimaHoras: 10, indicadores: [{ chave: "produtividade", peso: 70, meta: 1, ativo: true }, { chave: "apontamento_online", peso: 0, meta: null, ativo: false }, { chave: "retrabalho", peso: 10, ativo: true }, { chave: "qualidade_tecnica", peso: 10, ativo: true }, { chave: "aderencia_processos", peso: 10, ativo: true }] });
      const gE = await POST(`/ciclos/${E.corpo.id}/global`, tAdmin);
      confere("ensaio: fecha o índice global mesmo em rascunho, a qualquer data", gE.status === 201);
      // C já tem R2 etc.; usa B (base efetivada vigente só depois de 2027, então no ensaio cai na base mais antiga)
      await PUT(`/apuracoes/${E.corpo.id}/${pB}`, tAdmin, completos);
      const apE = await POST(`/apuracoes/${E.corpo.id}/${pB}/apurar`, tAdmin);
      confere("ensaio: apura sem depender de publicação nem de data, e NÃO usa a sequência real (parte do histórico da adesão, 9)", apE.status === 200 && apE.corpo.ensaio === true && apE.corpo.apuracao.resultado.consecutivosAntes === 9, JSON.stringify(apE.corpo.apuracao?.resultado));
      const idE = apE.corpo.apuracao.id as number;
      const notifB = (await usuarioDe(cB)) ? await prisma.notificacao.count({ where: { userId: (await usuarioDe(cB))!.id, tipo: "plano_resultado_disponivel" } }) : 0;
      await POST(`/apuracoes/${E.corpo.id}/${pB}/devolutiva`, tAdmin, { devolutivaEm: hoje });
      const uB = await usuarioDe(cB);
      if (uB) confere("ensaio: a devolutiva NÃO avisa ninguém (é simulação)", (await prisma.notificacao.count({ where: { userId: uB.id, tipo: "plano_resultado_disponivel" } })) === notifB);
      const basesBAntes = await prisma.planoValorBase.count({ where: { participanteId: pB } });
      await POST(`/apuracoes/${E.corpo.id}/${pB}/encerrar`, tAdmin);
      confere("ensaio: encerrar NÃO efetiva nem mexe no Valor Hora Base", (await prisma.planoValorBase.count({ where: { participanteId: pB } })) === basesBAntes);
      confere("ensaio: não entra na sequência real (R continua dando 0 consecutivos antes em R2 pra B)", (await D(R2, pB)).corpo.estadoAntes.consecutivos === 0);
      const csvE = await chamar(`/plano-evolucao/ciclos/${E.corpo.id}/export`, tAdmin);
      confere("ensaio: o CSV marca SIM na coluna Ensaio e não marca efetivação", csvE.status === 200 && csvE.corpo.includes(";SIM;") && !csvE.corpo.includes(";SIM;219,00;"));
      confere("ensaio: a memória carrega o marcador", (await P(`/apuracoes/${idE}/memoria`, tAdmin)).corpo.memoria.ensaio === true);
    }

    // ================== auditoria ==================
    const eventos = await prisma.auditEvento.findMany({ where: { ocorridoEm: { gte: inicio }, entidadeTipo: { in: ["plano_apuracao", "plano_ciclo"] } }, select: { eventoTipo: true } });
    const tipos = new Set(eventos.map((e) => e.eventoTipo));
    confere("auditoria da apuração: lançada, apurada, devolutiva, contestada, desfecho, reaberta e encerrada", ["PLANO_APURACAO_LANCADA", "PLANO_APURACAO_APURADA", "PLANO_APURACAO_DEVOLUTIVA", "PLANO_APURACAO_CONTESTADA", "PLANO_APURACAO_DESFECHO", "PLANO_APURACAO_REABERTA", "PLANO_APURACAO_ENCERRADA", "PLANO_GLOBAL_FECHADO"].every((t) => tipos.has(t)), [...tipos].join());
    confere("admin lê o histórico da apuração", (await chamar(`/auditoria/entidade/plano_apuracao/${idA}`, tAdmin)).status === 200 && (await chamar("/auditoria?entidadeTipo=plano_apuracao&limit=50", tAdmin)).corpo.rows.length > 0);
    confere("gestor NÃO lê o histórico da apuração (valor hora): 403 por entidade, vazio na lista e fora da exportação", (await chamar(`/auditoria/entidade/plano_apuracao/${idC}`, tGestor)).status === 403 && (await chamar("/auditoria?entidadeTipo=plano_apuracao&limit=50", tGestor)).corpo.rows.length === 0 && !String((await chamar(`/auditoria/export?de=${inicio.toISOString()}`, tGestor)).corpo).includes("plano_apuracao"));
  } finally {
    const au = await prisma.auditEvento.deleteMany({ where: { entidadeTipo: { in: ["plano_ciclo", "plano_participante", "plano_apuracao"] }, ocorridoEm: { gte: inicio } } });
    const no = await prisma.notificacao.deleteMany({ where: { tipo: { in: ["plano_resultado_disponivel", "plano_ciclo_publicado"] }, criadoEm: { gte: inicio } } });
    const ap = await prisma.planoApuracao.deleteMany({ where: { OR: [{ cicloId: { in: [...ciclosCriados] } }, { participanteId: { in: [...participantesCriados] } }] } });
    const gl = await prisma.planoCicloResultadoGlobal.deleteMany({ where: { cicloId: { in: [...ciclosCriados] } } });
    const pa = await prisma.planoParticipante.deleteMany({ where: { id: { in: [...participantesCriados] } } });
    const ci = await prisma.planoCiclo.deleteMany({ where: { id: { in: [...ciclosCriados] } } });
    console.log(`limpeza: ${ci.count} ciclos, ${pa.count} participantes, ${ap.count} apurações, ${gl.count} índices globais, ${no.count} notificações e ${au.count} eventos de auditoria apagados`);
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
