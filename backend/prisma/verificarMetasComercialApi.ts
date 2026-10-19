// Verificação ponta a ponta de routes/metasComercial.ts contra o banco local.
// Sobe um Express mínimo (sem os syncs do server.ts) e usa usuários que já existem (admin, a gestora do Comercial e alguém do time).
// GRAVA no banco local (ano 2098, um indicador de teste e auditoria); tudo o que o script cria é apagado no `finally`.
// Rodar: node_modules/.bin/ts-node --transpile-only prisma/verificarMetasComercialApi.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { DEPEXE_COMERCIAL } from "../src/domain/propostasDominio";
import { PESOS_PADRAO } from "../src/domain/metasComercial/calculo";
import { metasComercialRouter } from "../src/routes/metasComercial";

let falhas = 0;
let total = 0;
function confere(nome: string, ok: boolean, detalhe = "") {
  total++;
  if (!ok) {
    falhas++;
    console.error(`FALHOU: ${nome} ${detalhe}`);
  }
}

const ANO = 2098;

async function usuarioDoConsultor(codusu: number) {
  const c = await prisma.consultor.findFirst({ where: { codusu }, select: { email: true } });
  if (!c?.email) return null;
  return prisma.user.findFirst({ where: { email: { equals: c.email, mode: "insensitive" }, status: "ativo" }, select: { id: true, role: { select: { name: true } } } });
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/metas-comercial", metasComercialRouter);
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
    return { status: r.status, corpo, headers: r.headers };
  };
  const M = (c: string, t?: string, o?: { method?: string; body?: unknown }) => chamar(`/metas-comercial${c}`, t, o);

  let indicadorTesteId: number | null = null;
  try {
    const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: "ativo" }, select: { id: true } });
    if (!admin) throw new Error("sem usuário admin no banco local");
    const gestorDep = await prisma.departamentoGestor.findFirst({ where: { depexe: DEPEXE_COMERCIAL } });
    const gestora = gestorDep ? await usuarioDoConsultor(Number(gestorDep.usuges)) : null;
    // Alguém do time do Comercial que NÃO é o gestor.
    const time = await prisma.departamentoTime.findMany({ where: { depexe: DEPEXE_COMERCIAL, sitreg: "A" } });
    let doTime: { id: number; role: { name: string } } | null = null;
    let codforDoTime: number | null = null;
    for (const t of time) {
      if (gestorDep && Number(t.codusu) === Number(gestorDep.usuges)) continue;
      const u = await usuarioDoConsultor(Number(t.codusu));
      const c = await prisma.consultor.findFirst({ where: { codusu: Number(t.codusu) }, select: { codfor: true } });
      if (u && c?.codfor) {
        doTime = u;
        codforDoTime = c.codfor;
        break;
      }
    }
    // Alguém que nem é do Comercial nem gestor dele.
    const gestoresDeOutros = new Set((await prisma.departamentoGestor.findMany({ where: { depexe: { not: DEPEXE_COMERCIAL } } })).map((g) => Number(g.usuges)));
    const outro = await prisma.user.findFirst({ where: { role: { name: { in: ["consultoria", "suporte", "desenvolvimento"] } }, status: "ativo" }, select: { id: true, role: { select: { name: true } } } });
    const tAdmin = signToken({ userId: admin.id, role: "admin" });
    const tGestora = gestora ? signToken({ userId: gestora.id, role: gestora.role.name }) : null;
    const tTime = doTime ? signToken({ userId: doTime.id, role: doTime.role.name }) : null;
    const tOutro = outro ? signToken({ userId: outro.id, role: outro.role.name }) : null;
    console.log(`admin=${admin.id} gestora=${gestora?.id ?? "NENHUMA"} doTime=${doTime?.id ?? "NENHUM"} outro=${outro?.id ?? "NENHUM"} (gestoresDeOutros=${gestoresDeOutros.size})`);

    // ---- acesso: admin e gestora do Comercial; o resto não ----
    confere("sem token = 401", (await M("/anos")).status === 401);
    if (tTime) confere("integrante do time (não gestor) = 403", (await M("/anos", tTime)).status === 403);
    if (tOutro) confere("outro consultor = 403", (await M("/anos", tOutro)).status === 403);
    confere("admin = 200", (await M("/anos", tAdmin)).status === 200);
    if (tGestora) confere("gestora do Comercial = 200", (await M("/anos", tGestora)).status === 200);
    const tOp = tGestora ?? tAdmin;

    if (await prisma.metaComercialAno.findUnique({ where: { ano: ANO } })) throw new Error(`sobrou o ano ${ANO} de uma execução anterior: apague antes`);

    // ---- indicadores ----
    const lista = await M("/indicadores", tOp);
    const cod = (c: string) => lista.corpo.indicadores.find((i: any) => i.codigo === c);
    confere("traz os 9 indicadores da planilha", lista.status === 200 && ["MENSALIDADE", "INCREMENTO_MENSAL", "LICENCAS", "HORAS_SERVICOS", "FATURAMENTO", "QUALIFICACOES", "REUNIOES", "OPORTUNIDADES", "NOVOS_CLIENTES"].every((c) => cod(c)));
    confere("Faturamento e Mensalidade vêm do Senior; Mensalidade é saldo", cod("FATURAMENTO")?.origem === "FATURAMENTO_SENIOR" && cod("MENSALIDADE")?.origem === "CARTEIRA_SENIOR" && cod("MENSALIDADE")?.acumulacao === "SALDO");
    confere("indicador inválido = 400", (await M("/indicadores", tOp, { method: "POST", body: { nome: "", unidade: "BRL" } })).status === 400 && (await M("/indicadores", tOp, { method: "POST", body: { nome: "X", unidade: "KG" } })).status === 400);
    confere("nome repetido = 409", (await M("/indicadores", tOp, { method: "POST", body: { nome: "licenças", unidade: "BRL" } })).status === 409);
    const novoInd = await M("/indicadores", tOp, { method: "POST", body: { nome: "Teste Verificacao Metas", unidade: "QTD", acumulacao: "SOMA" } });
    confere("cria indicador", novoInd.status === 201 && Number.isInteger(novoInd.corpo.id), JSON.stringify(novoInd.corpo));
    indicadorTesteId = novoInd.corpo.id ?? null;
    if (indicadorTesteId) {
      confere("renomeia e desativa indicador sem uso", (await M(`/indicadores/${indicadorTesteId}`, tOp, { method: "PUT", body: { nome: "Teste Verificacao Metas 2", ativo: false, unidade: "HORAS" } })).status === 200);
    }

    // ---- ano ----
    confere("ano inválido = 400", (await M("/anos", tOp, { method: "POST", body: { ano: 1999 } })).status === 400);
    confere("copiar de ano inexistente = 400", (await M("/anos", tOp, { method: "POST", body: { ano: ANO, copiarDe: 1950 } })).status === 400);
    const criado = await M("/anos", tOp, { method: "POST", body: { ano: ANO } });
    confere("cria o ano", criado.status === 201, JSON.stringify(criado.corpo));
    confere("ano repetido = 409", (await M("/anos", tOp, { method: "POST", body: { ano: ANO } })).status === 409);
    let cfg = (await M(`/anos/${ANO}`, tOp)).corpo;
    confere("nasce com pesos da planilha e a linha Não atribuído", cfg.pesosMensais.length === 12 && Math.abs(cfg.pesosMensais[0] - 6.666667) < 1e-9 && cfg.participantes.length === 1 && cfg.participantes[0].naoAtribuido === true);

    const inc = cod("INCREMENTO_MENSAL").id;
    const lic = cod("LICENCAS").id;
    const mens = cod("MENSALIDADE").id;
    const fat = cod("FATURAMENTO").id;
    confere("pesos que não somam 100 = 400", (await M(`/anos/${ANO}`, tOp, { method: "PUT", body: { pesosMensais: new Array(12).fill(5), empresa: [] } })).status === 400);
    confere("meta negativa = 400", (await M(`/anos/${ANO}`, tOp, { method: "PUT", body: { pesosMensais: PESOS_PADRAO, empresa: [{ indicadorId: inc, metaAnual: -1 }] } })).status === 400);
    confere("indicador inexistente = 400", (await M(`/anos/${ANO}`, tOp, { method: "PUT", body: { pesosMensais: PESOS_PADRAO, empresa: [{ indicadorId: 999999, metaAnual: 10 }] } })).status === 400);
    const plan = await M(`/anos/${ANO}`, tOp, {
      method: "PUT",
      body: { pesosMensais: PESOS_PADRAO, observacao: "teste", empresa: [{ indicadorId: inc, metaAnual: 200000 }, { indicadorId: lic, metaAnual: 840000 }, { indicadorId: mens, metaAnual: 1000000 }, { indicadorId: fat, metaAnual: 1200000 }] },
    });
    confere("grava o planejamento", plan.status === 200, JSON.stringify(plan.corpo));

    // ---- participantes ----
    confere("pessoa fora do time = 400", (await M(`/anos/${ANO}/participantes`, tOp, { method: "POST", body: { codfor: 987654321, indicadores: [] } })).status === 400);
    const elegiveis = await M("/elegiveis", tOp);
    confere("lista o time do Comercial", elegiveis.status === 200 && elegiveis.corpo.elegiveis.length > 0 && (codforDoTime == null || elegiveis.corpo.elegiveis.some((e: any) => e.codfor === codforDoTime)));
    const codfor = codforDoTime ?? elegiveis.corpo.elegiveis[0].codfor;
    const add = await M(`/anos/${ANO}/participantes`, tOp, { method: "POST", body: { codfor, funcao: "Vendas", indicadores: [{ indicadorId: inc, rotulo: "Mensalidade" }, { indicadorId: lic }, { indicadorId: fat }] } });
    confere("inclui a pessoa", add.status === 201, JSON.stringify(add.corpo));
    const pid = add.corpo.id;
    confere("pessoa repetida = 409", (await M(`/anos/${ANO}/participantes`, tOp, { method: "POST", body: { codfor, indicadores: [] } })).status === 409);
    cfg = (await M(`/anos/${ANO}`, tOp)).corpo;
    const naoAtrib = cfg.participantes.find((p: any) => p.naoAtribuido);
    confere("pessoa tem 3 indicadores e o rótulo próprio", cfg.participantes.find((p: any) => p.id === pid)?.indicadores.length === 3 && cfg.participantes.find((p: any) => p.id === pid)?.indicadores[0].rotulo === "Mensalidade");
    confere("Não atribuído não se exclui", (await M(`/anos/${ANO}/participantes/${naoAtrib.id}`, tOp, { method: "DELETE" })).status === 400);
    await M(`/anos/${ANO}/participantes/${naoAtrib.id}`, tOp, { method: "PUT", body: { indicadores: [{ indicadorId: inc }, { indicadorId: mens }] } });

    // ---- lançamentos ----
    const L = (itens: unknown[]) => M(`/anos/${ANO}/lancamentos`, tOp, { method: "PUT", body: { itens } });
    confere("lote vazio = 400", (await L([])).status === 400);
    confere("mês 13 = 400", (await L([{ participanteId: pid, indicadorId: inc, mes: 13, meta: 1 }])).status === 400);
    confere("indicador que a pessoa não tem = 400", (await L([{ participanteId: pid, indicadorId: mens, mes: 1, meta: 1 }])).status === 400);
    const horas = cod("HORAS_SERVICOS");
    confere("Horas de Serviços vêm das propostas (Senior)", horas?.origem === "PROPOSTAS_SENIOR" && horas?.unidade === "HORAS");
    await M(`/anos/${ANO}/participantes/${naoAtrib.id}`, tOp, { method: "PUT", body: { indicadores: [{ indicadorId: inc }, { indicadorId: mens }, { indicadorId: horas.id }] } });
    confere("realizado de Horas (propostas do Senior) = 400", (await L([{ participanteId: naoAtrib.id, indicadorId: horas.id, mes: 1, realizado: 10 }])).status === 400);
    const reps = await M("/representantes", tOp);
    confere("lista representantes com proposta", reps.status === 200 && reps.corpo.representantes.some((r: any) => r.codrep === 32));
    confere("representante inexistente = 400", (await M(`/anos/${ANO}/participantes/${pid}`, tOp, { method: "PUT", body: { codrep: 987654321 } })).status === 400);
    confere("vincula representante à pessoa", (await M(`/anos/${ANO}/participantes/${pid}`, tOp, { method: "PUT", body: { codrep: 32 } })).status === 200 && (await M(`/anos/${ANO}`, tOp)).corpo.participantes.find((p: any) => p.id === pid)?.codrep === 32);
    confere("realizado da Mensalidade (carteira do Senior) = 400", (await L([{ participanteId: naoAtrib.id, indicadorId: mens, mes: 1, realizado: 10 }])).status === 400);
    confere("realizado de Faturamento (Senior) = 400", (await L([{ participanteId: pid, indicadorId: fat, mes: 1, realizado: 10 }])).status === 400);
    confere("valor negativo = 400", (await L([{ participanteId: pid, indicadorId: inc, mes: 1, meta: -5 }])).status === 400);
    confere("lançamento repetido no lote = 400", (await L([{ participanteId: pid, indicadorId: inc, mes: 1, meta: 1 }, { participanteId: pid, indicadorId: inc, mes: 1, meta: 2 }])).status === 400);
    const g1 = await L([
      { participanteId: pid, indicadorId: inc, mes: 1, meta: 6560, realizado: 8376.31 },
      { participanteId: pid, indicadorId: inc, mes: 2, meta: 6560, realizado: 46367.63 },
      { participanteId: pid, indicadorId: lic, mes: 1, meta: 28000 },
      { participanteId: pid, indicadorId: fat, mes: 1, meta: 0 },
      { participanteId: naoAtrib.id, indicadorId: inc, mes: 3, realizado: 14493.21 },
      { participanteId: naoAtrib.id, indicadorId: mens, mes: 3, meta: 1000000 },
    ]);
    confere("grava 6 lançamentos", g1.status === 200 && g1.corpo.gravados === 6, JSON.stringify(g1.corpo));
    const g2 = await L([{ participanteId: pid, indicadorId: inc, mes: 1, meta: 6560, realizado: 8376.31 }]);
    confere("regravar o mesmo valor não conta como alteração", g2.status === 200 && g2.corpo.gravados === 0, JSON.stringify(g2.corpo));
    const rel = (await M(`/anos/${ANO}/lancamentos`, tOp)).corpo;
    const l1 = rel.lancamentos.find((l: any) => l.participanteId === pid && l.indicadorId === inc && l.mes === 1);
    confere("lê de volta com 2 casas", l1?.meta === 6560 && l1?.realizado === 8376.31, JSON.stringify(l1));
    confere("traz o faturamento do Senior (12 meses)", Array.isArray(rel.faturamentoSenior) && rel.faturamentoSenior.length === 12);
    const parcial = await L([{ participanteId: pid, indicadorId: inc, mes: 2, realizado: 40000 }]);
    const l2 = (await M(`/anos/${ANO}/lancamentos`, tOp)).corpo.lancamentos.find((l: any) => l.participanteId === pid && l.indicadorId === inc && l.mes === 2);
    confere("campo ausente não apaga o outro (só mudou o realizado)", parcial.corpo.gravados === 1 && l2.meta === 6560 && l2.realizado === 40000, JSON.stringify(l2));
    confere("excluir pessoa com lançamento = 409", (await M(`/anos/${ANO}/participantes/${pid}`, tOp, { method: "DELETE" })).status === 409);
    confere("tirar indicador com lançamento = 409", (await M(`/anos/${ANO}/participantes/${pid}`, tOp, { method: "PUT", body: { indicadores: [{ indicadorId: inc }, { indicadorId: fat }] } })).status === 409);

    // ---- painel ----
    const pa = (await M(`/anos/${ANO}/painel?periodo=ano`, tOp)).corpo;
    const pi = (c: string) => pa.indicadores.find((i: any) => i.codigo === c);
    confere("meta mensal da empresa = anual × peso (Jan 13.333,33)", pi("INCREMENTO_MENSAL")?.mensal[0].meta === 13333.33, JSON.stringify(pi("INCREMENTO_MENSAL")?.mensal[0]));
    confere("realizado da empresa soma pessoa + Não atribuído (62.869,52)", Math.abs((pi("INCREMENTO_MENSAL")?.consolidado.realizado ?? 0) - 62869.52) < 0.005, String(pi("INCREMENTO_MENSAL")?.consolidado.realizado));
    confere("meta das pessoas aparece para conferir", pi("INCREMENTO_MENSAL")?.metaDasPessoas === 13120);
    confere("Mensalidade vem da foto da carteira (2098 sem foto = 0 de 1.000.000)", pi("MENSALIDADE")?.consolidado.realizado === 0 && pi("MENSALIDADE")?.consolidado.meta === 1000000 && pi("MENSALIDADE")?.origem === "CARTEIRA_SENIOR" && "ultimaFotoCarteira" in pa);
    confere("Faturamento é do Senior (sem NF em 2098 = 0)", pi("FATURAMENTO")?.consolidado.realizado === 0 && pi("FATURAMENTO")?.origem === "FATURAMENTO_SENIOR");
    confere("pessoa com rótulo próprio e Não atribuído por último", pa.pessoas[0].indicadores[0].rotulo === "Mensalidade" && pa.pessoas[pa.pessoas.length - 1].naoAtribuido === true);
    confere("período t1 recorta (Q1 da meta 3 × 13.333,33)", (await M(`/anos/${ANO}/painel?periodo=t1`, tOp)).corpo.indicadores.find((i: any) => i.codigo === "INCREMENTO_MENSAL").consolidado.meta === 39999.99);
    confere("período inválido = 400", (await M(`/anos/${ANO}/painel?periodo=zzz`, tOp)).status === 400);
    confere("ano sem metas = 404", (await M(`/anos/2097/painel`, tOp)).status === 404);
    const csv = await M(`/anos/${ANO}/painel.csv?periodo=ano`, tOp);
    // fetch().text() descarta o BOM por especificação: confere os bytes crus.
    const bytes = new Uint8Array(await (await fetch(`${raiz}/metas-comercial/anos/${ANO}/painel.csv?periodo=ano`, { headers: { Authorization: `Bearer ${tOp}` } })).arrayBuffer());
    confere("CSV com BOM, ';' e vírgula decimal", csv.status === 200 && String(csv.headers.get("content-type")).includes("text/csv") && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && typeof csv.corpo === "string" && csv.corpo.startsWith("Escopo;Pessoa;") && csv.corpo.includes("Incremento Mensal") && /\d,\d\d/.test(csv.corpo), String(csv.corpo).slice(0, 120));

    // ---- notas do faturamento (detalhe do mês): soma = realizado do painel ----
    const notasSet = await M("/anos/2026/faturamento/notas?mes=9", tOp);
    const painel2026 = await M("/anos/2026/painel?periodo=ano", tOp);
    const fatSet = painel2026.status === 200 ? painel2026.corpo.indicadores.find((i: any) => i.codigo === "FATURAMENTO")?.mensal[8]?.realizado ?? 0 : null;
    confere("notas de set/2026 somam o realizado do painel", notasSet.status === 200 && (fatSet == null || Math.abs(notasSet.corpo.total - fatSet) < 0.01), `notas ${notasSet.corpo?.total} painel ${fatSet}`);
    confere("cada nota traz cliente e valor", notasSet.status === 200 && notasSet.corpo.notas.every((n: any) => typeof n.valor === "number" && n.numero > 0));
    confere("mês inválido = 400", (await M("/anos/2026/faturamento/notas?mes=13", tOp)).status === 400);
    if (tOutro) confere("notas: consultor sem gestão = 403", (await M("/anos/2026/faturamento/notas?mes=9", tOutro)).status === 403);

    // ---- licenças: pedidos com rateio na conta 177 ----
    confere("Licenças vêm dos pedidos (Senior)", cod("LICENCAS")?.origem === "PEDIDOS_SENIOR");
    confere("realizado de Licenças (pedidos do Senior) = 400", (await L([{ participanteId: pid, indicadorId: lic, mes: 2, realizado: 10 }])).status === 400);
    const pedAbr = await M("/anos/2026/licencas/pedidos?mes=4", tOp);
    const licAbr = painel2026.status === 200 ? painel2026.corpo.indicadores.find((i: any) => i.codigo === "LICENCAS")?.mensal[3]?.realizado ?? 0 : null;
    confere("pedidos de abr/2026 somam o realizado de Licenças do painel", pedAbr.status === 200 && (licAbr == null || Math.abs(pedAbr.corpo.total - licAbr) < 0.01), `pedidos ${pedAbr.corpo?.total} painel ${licAbr}`);
    confere("licenças: mês inválido = 400", (await M("/anos/2026/licencas/pedidos?mes=0", tOp)).status === 400);
    if (tOutro) confere("licenças: consultor sem gestão = 403", (await M("/anos/2026/licencas/pedidos?mes=4", tOutro)).status === 403);

    // ---- copiar de um ano, limpar valor e excluir ----
    const c2 = await M("/anos", tOp, { method: "POST", body: { ano: ANO - 1, copiarDe: ANO } });
    confere("copia o ano (sem lançamentos)", c2.status === 201);
    const cfg2 = (await M(`/anos/${ANO - 1}`, tOp)).corpo;
    confere("cópia leva metas da empresa, pessoas e indicadores, sem lançamentos", cfg2.empresa.length === 4 && cfg2.participantes.length === 2 && ((await M(`/anos/${ANO - 1}/lancamentos`, tOp)).corpo.lancamentos.length === 0));
    const limpar = await L([{ participanteId: pid, indicadorId: fat, mes: 1, meta: null }]);
    confere("limpar todos os campos apaga a linha", limpar.corpo.gravados === 1 && !(await M(`/anos/${ANO}/lancamentos`, tOp)).corpo.lancamentos.some((l: any) => l.participanteId === pid && l.indicadorId === fat));

    // ---- auditoria gravada ----
    const eventos = await prisma.auditEvento.findMany({ where: { entidadeTipo: "meta_comercial", entidadeId: String(ANO) } });
    const tipos = new Set(eventos.map((e) => e.eventoTipo));
    confere("auditoria: criação, planejamento e lançamento", tipos.has("META_COMERCIAL_ANO_CRIADO") && tipos.has("META_COMERCIAL_PLANEJAMENTO_ALTERADO") && tipos.has("META_COMERCIAL_LANCAMENTO"), [...tipos].join());
  } finally {
    await prisma.metaComercialAno.deleteMany({ where: { ano: { in: [ANO, ANO - 1] } } });
    if (indicadorTesteId) await prisma.metaComercialIndicador.deleteMany({ where: { id: indicadorTesteId } });
    await prisma.auditEvento.deleteMany({ where: { entidadeTipo: "meta_comercial", OR: [{ entidadeId: { in: [String(ANO), String(ANO - 1)] } }, { entidadeId: indicadorTesteId ? `indicador:${indicadorTesteId}` : "-" }] } });
    server.close();
    await prisma.$disconnect();
  }
  console.log(falhas === 0 ? `OK: ${total} verificações` : `${falhas} de ${total} verificações falharam`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
