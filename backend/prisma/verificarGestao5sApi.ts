// Teste ponta a ponta do módulo Gestão 5S: sobe só o router /5s num Express mínimo (sem os syncs
// agendados do server.ts), cria dados temporários e apaga tudo no final.
//
// Roda num SCHEMA ISOLADO do Postgres local (nunca no `public`): os perguntas/áreas reais cadastradas
// no banco de desenvolvimento mudariam as contagens e os percentuais esperados. Sequência:
//   1. DATABASE_URL apontando pro mesmo banco com ?schema=t5s_e2e
//   2. criar o schema (CREATE SCHEMA t5s_e2e) e rodar `prisma migrate deploy` com essa URL
//   3. DATABASE_URL=<essa URL> node_modules/.bin/ts-node --transpile-only prisma/verificarGestao5sApi.ts
//   4. DROP SCHEMA t5s_e2e CASCADE
import "dotenv/config";
import assert from "assert";
import express from "express";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { gestao5sRouter } from "../src/routes/gestao5s";
import { CINCO_S_DIR, garantirDiretorioUploads } from "../src/config/uploads";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const TAG = `t5s${Date.now()}`;

if (!/schema=(?!public\b)[^&]+/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Recusado: rode num schema isolado (DATABASE_URL com ?schema=<outro que não public>). Veja o comentário no topo.");
  process.exit(1);
}

async function main() {
  garantirDiretorioUploads();
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/5s", gestao5sRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/5s`;

  const role = await prisma.role.upsert({ where: { name: "consultoria" }, update: {}, create: { name: "consultoria" } });
  const roleAdmin = await prisma.role.upsert({ where: { name: "admin" }, update: {}, create: { name: "admin" } });
  const admin = await prisma.user.create({ data: { email: `${TAG}-admin@teste.local`, nome: "Teste admin", roleId: roleAdmin.id, status: "ativo" } });
  const mk = (n: string) => prisma.user.create({ data: { email: `${TAG}-${n}@teste.local`, nome: `Teste ${n}`, roleId: role.id, status: "ativo" } });
  const [uAval, uLider, uNada] = await Promise.all([mk("aval"), mk("lider"), mk("nada")]);
  const tok = (u: { id: number }, r: string) => signToken({ userId: u.id, role: r });
  const T = { admin: tok(admin, "admin"), aval: tok(uAval, "consultoria"), lider: tok(uLider, "consultoria"), nada: tok(uNada, "consultoria") };

  async function api(quem: keyof typeof T, metodo: string, rota: string, corpo?: unknown, form?: FormData) {
    const r = await fetch(base + rota, {
      method: metodo,
      headers: { Authorization: `Bearer ${T[quem]}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
      body: form ?? (corpo ? JSON.stringify(corpo) : undefined),
    });
    const ct = r.headers.get("content-type") ?? "";
    const dados = ct.includes("json") ? await r.json() : r.status === 204 ? null : Buffer.from(await r.arrayBuffer());
    return { status: r.status, dados: dados as any };
  }
  const ok = (r: { status: number; dados: any }, esperado: number, msg: string) => assert.strictEqual(r.status, esperado, `${msg}: ${r.status} ${JSON.stringify(r.dados)?.slice(0, 200)}`);

  const areaIds: number[] = [];
  const avaliacaoIds: number[] = [];
  try {
    // 1. Acesso
    let r = await api("admin", "GET", "/meu-acesso");
    assert.strictEqual(r.dados.papel, "coordenador");
    r = await api("nada", "GET", "/meu-acesso");
    assert.strictEqual(r.dados.papel, null);
    ok(await api("nada", "GET", "/areas"), 403, "sem cadastro não acessa áreas");
    ok(await api("nada", "GET", "/dashboard"), 403, "sem cadastro não acessa dashboard");

    // 2. Áreas
    const criarArea = async (corpo: object) => {
      const x = await api("admin", "POST", "/areas", corpo);
      ok(x, 201, "criar área");
      areaIds.push(x.dados.id);
      return x.dados.id as number;
    };
    const adm = await criarArea({ nome: `${TAG} Adm`, tipo: "setor" });
    const dev = await criarArea({ nome: `${TAG} Dev`, tipo: "setor" });
    // Área agrupadora: setor "Comum" com dois ambientes comuns vinculados (como a aba Comum da planilha).
    const mae = await criarArea({ nome: `${TAG} Comum`, tipo: "setor" });
    const copa = await criarArea({ nome: `${TAG} Copa`, tipo: "comum", setorVinculadoId: mae });
    const sala = await criarArea({ nome: `${TAG} Sala`, tipo: "comum", setorVinculadoId: mae });
    ok(await api("admin", "POST", "/areas", { nome: "x", tipo: "comum", setorVinculadoId: copa }), 400, "vínculo só com setor");

    // 3. Perguntas: 2 por senso p/ setor + 1 p/ comum
    const perguntaIds: number[] = [];
    for (const senso of ["seiri", "seiton", "seiso", "seiketsu", "shitsuke"]) {
      for (let i = 1; i <= 2; i++) {
        const x = await api("admin", "POST", "/perguntas", { tipoArea: "setor", senso, texto: `${TAG} ${senso} ${i}` });
        ok(x, 201, "criar pergunta");
        perguntaIds.push(x.dados.id);
      }
    }
    const pc = await api("admin", "POST", "/perguntas", { tipoArea: "comum", senso: "seiri", texto: `${TAG} comum` });
    perguntaIds.push(pc.dados.id);
    ok(await api("admin", "POST", "/perguntas", { tipoArea: "comum", areaId: sala, senso: "seiri", texto: `${TAG} sala` }), 201, "pergunta só da sala");
    ok(await api("admin", "PUT", `/areas/${mae}`, { nome: `${TAG} Comum`, tipo: "comum" }), 400, "setor agrupador não vira ambiente comum");
    ok(await api("aval", "POST", "/perguntas", { tipoArea: "setor", senso: "seiri", texto: "x" }), 403, "avaliador não cadastra");

    // 4. Participantes
    ok(await api("admin", "POST", "/participantes", { userId: uAval.id, papel: "avaliador" }), 201, "avaliador");
    ok(await api("admin", "POST", "/participantes", { userId: uLider.id, papel: "lider" }), 400, "líder sem setor");
    ok(await api("admin", "POST", "/participantes", { userId: uLider.id, papel: "lider", areaIds: [adm] }), 201, "líder");

    // 5. Avaliação do Adm: 10 respostas, todas 5 menos uma NA e uma nota 1 (seiri) → seiri 100%→ (5+... ) ver abaixo
    r = await api("aval", "POST", "/avaliacoes", { areaId: adm });
    ok(r, 201, "criar avaliação");
    const av1 = r.dados.id;
    avaliacaoIds.push(av1);
    ok(await api("lider", "POST", "/avaliacoes", { areaId: adm }), 403, "líder não avalia");
    r = await api("aval", "GET", `/avaliacoes/${av1}`);
    assert.strictEqual(r.dados.respostas.length, 10);
    assert.match(r.dados.titulo, /^Avaliação 5S – \d{2}\/\d{2}\/\d{4} – /);
    ok(await api("aval", "POST", `/avaliacoes/${av1}/finalizar`), 400, "não finaliza com pendências");
    ok(await api("lider", "GET", `/avaliacoes/${av1}`), 403, "líder não vê em andamento");

    const respostas: { id: number; senso: string }[] = r.dados.respostas;
    const notaPara = (rp: { senso: string }, i: number) => (rp.senso === "seiri" ? (i % 2 === 0 ? 4 : 5) : rp.senso === "shitsuke" ? 2 : 5);
    for (const [i, rp] of respostas.entries()) {
      // primeira do seiton vira NA → seiton só com 1 resposta aplicável (5 → 100%)
      const corpo = rp.senso === "seiton" && i === respostas.findIndex((x) => x.senso === "seiton") ? { naoSeAplica: true } : { nota: notaPara(rp, i) };
      ok(await api("aval", "PUT", `/avaliacoes/${av1}/respostas/${rp.id}`, corpo), 200, "responder");
    }
    ok(await api("aval", "PUT", `/avaliacoes/${av1}/respostas/${respostas[0].id}`, { nota: 9 }), 400, "nota inválida");
    ok(await api("lider", "PUT", `/avaliacoes/${av1}/respostas/${respostas[0].id}`, { nota: 1 }), 403, "líder não altera nota");
    ok(await api("aval", "PUT", `/avaliacoes/${av1}/respostas/${respostas[0].id}`, { inconsistencia: "Mesa desorganizada" }), 200, "inconsistência");
    ok(await api("aval", "PUT", `/avaliacoes/${av1}/sensos/seiri`, { observacoes: "ok", melhorias: "melhorar" }), 204, "bloco do senso");

    // 6. Imagem na resposta e no bloco do senso
    const form = new FormData();
    form.append("arquivo", new Blob([PNG], { type: "image/png" }), "foto.png");
    form.append("respostaId", String(respostas[0].id));
    r = await api("aval", "POST", `/avaliacoes/${av1}/imagens`, undefined, form);
    ok(r, 201, "upload na resposta");
    const imgId = r.dados.id;
    const form2 = new FormData();
    form2.append("arquivo", new Blob([PNG], { type: "image/png" }), "foto2.png");
    form2.append("senso", "seiri");
    ok(await api("aval", "POST", `/avaliacoes/${av1}/imagens`, undefined, form2), 201, "upload no senso");
    const formRuim = new FormData();
    formRuim.append("arquivo", new Blob(["x"], { type: "text/plain" }), "a.txt");
    formRuim.append("respostaId", String(respostas[0].id));
    ok(await api("aval", "POST", `/avaliacoes/${av1}/imagens`, undefined, formRuim), 400, "só imagem");

    // 7. Finaliza e confere os percentuais (seiri 90, seiton 100, seiso 100, seiketsu 100, shitsuke 40 → 86)
    ok(await api("aval", "POST", `/avaliacoes/${av1}/finalizar`), 204, "finalizar");
    r = await api("aval", "GET", `/avaliacoes/${av1}`);
    assert.deepStrictEqual(r.dados.percentuais.porSenso, { seiri: 90, seiton: 100, seiso: 100, seiketsu: 100, shitsuke: 40 });
    assert.strictEqual(r.dados.percentuais.geral, 86);
    ok(await api("aval", "PUT", `/avaliacoes/${av1}/respostas/${respostas[0].id}`, { nota: 1 }), 403, "finalizada não edita");
    r = await api("lider", "GET", `/avaliacoes/${av1}/`);
    ok(r, 200, "líder vê finalizada do seu setor");
    assert.strictEqual(r.dados.pode.editar, false);
    r = await api("lider", "GET", `/imagens/${imgId}`);
    ok(r, 200, "líder baixa imagem");
    assert.ok(Buffer.isBuffer(r.dados) && r.dados.length === PNG.length, "imagem íntegra");
    ok(await api("lider", "DELETE", `/imagens/${imgId}`), 403, "líder não remove imagem");

    // 8. Segunda avaliação (Dev) finalizada, com data recuada para o mês anterior
    r = await api("aval", "POST", "/avaliacoes", { areaId: dev });
    const av2 = r.dados.id;
    avaliacaoIds.push(av2);
    r = await api("aval", "GET", `/avaliacoes/${av2}`);
    for (const rp of r.dados.respostas) ok(await api("aval", "PUT", `/avaliacoes/${av2}/respostas/${rp.id}`, { nota: 3 }), 200, "responder dev");
    ok(await api("aval", "POST", `/avaliacoes/${av2}/finalizar`), 204, "finalizar dev");
    ok(await api("lider", "GET", `/avaliacoes/${av2}`), 403, "líder não vê outro setor");
    const mesPassado = new Date();
    mesPassado.setUTCMonth(mesPassado.getUTCMonth() - 1, 10);
    await prisma.avaliacao5S.update({ where: { id: av2 }, data: { data: mesPassado } });

    // 9. Recorte de áreas e avaliações do líder
    r = await api("lider", "GET", "/areas");
    const nomes = (r.dados as { nome: string }[]).map((a) => a.nome);
    assert.ok(nomes.includes(`${TAG} Adm`) && nomes.includes(`${TAG} Copa`), "líder vê seu setor e ambiente compartilhado");
    assert.ok(nomes.includes(`${TAG} Comum`) && nomes.includes(`${TAG} Sala`), "líder vê a agrupadora e todos os ambientes comuns");
    assert.ok(!nomes.includes(`${TAG} Dev`), "líder não vê outro setor");
    assert.ok((await api("admin", "GET", "/areas")).dados.find((a: { id: number }) => a.id === mae).ehAgrupadora, "área com ambientes é agrupadora");
    r = await api("lider", "GET", `/avaliacoes?areaId=${dev}`);
    assert.strictEqual(r.dados.total, 0);

    // 10. Observações da equipe
    ok(await api("lider", "POST", "/observacoes", { areaId: adm, dataOcorrido: new Date().toISOString().slice(0, 10), texto: "Talher sujo na mesa" }), 201, "observação no setor");
    ok(await api("lider", "POST", "/observacoes", { areaId: copa, dataOcorrido: new Date().toISOString().slice(0, 10), texto: "Pia molhada" }), 201, "observação no comum");
    ok(await api("lider", "POST", "/observacoes", { areaId: dev, dataOcorrido: new Date().toISOString().slice(0, 10), texto: "x" }), 403, "sem observar outro setor");
    ok(await api("lider", "POST", "/observacoes", { areaId: sala, dataOcorrido: new Date().toISOString().slice(0, 10), texto: "Xícara suja" }), 201, "líder observa qualquer ambiente comum");
    r = await api("aval", "GET", `/avaliacoes/${av1}`);
    assert.strictEqual(r.dados.observacoesEquipe.length, 1, "observação do mês aparece na avaliação");

    // 11. Dashboard / comparativo
    r = await api("admin", "GET", "/dashboard?tipo=setor");
    const meus = r.dados.ranking.filter((x: { nome: string }) => x.nome.startsWith(TAG));
    assert.deepStrictEqual(meus.map((x: { nome: string; geral: number }) => [x.nome.replace(`${TAG} `, ""), x.geral]), [["Adm", 86], ["Dev", 60]]);
    r = await api("lider", "GET", "/dashboard?tipo=setor");
    assert.deepStrictEqual(r.dados.ranking.map((x: { nome: string }) => x.nome), [`${TAG} Adm`], "dashboard do líder só com o setor dele");
    const mes = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    r = await api("admin", "GET", `/comparativo?meses=${mes(mesPassado)},${mes(new Date())}&areaId=${dev}`);
    ok(r, 200, "comparativo");
    assert.deepStrictEqual(r.dados.linhas.find((l: { chave: string }) => l.chave === "geral").valores, [60, null]);
    ok(await api("admin", "GET", "/comparativo?meses=2026-01"), 400, "comparativo exige 2 meses");

    // 12. Auditoria, reabrir e excluir
    const eventos = await prisma.auditEvento.findMany({ where: { entidadeTipo: "avaliacao_5s", entidadeId: String(av1) }, select: { eventoTipo: true } });
    const tipos = eventos.map((e) => e.eventoTipo);
    for (const t of ["AVALIACAO_5S_CRIADA", "AVALIACAO_5S_NOTA_ALTERADA", "AVALIACAO_5S_FINALIZADA", "AVALIACAO_5S_IMAGEM_ADICIONADA"]) assert.ok(tipos.includes(t), `auditoria ${t}`);
    ok(await api("aval", "POST", `/avaliacoes/${av1}/reabrir`), 204, "reabrir");
    ok(await api("aval", "DELETE", `/avaliacoes/${av1}`), 204, "excluir em andamento");
    avaliacaoIds.splice(avaliacaoIds.indexOf(av1), 1);
    ok(await api("aval", "DELETE", `/avaliacoes/${av2}`), 403, "finalizada não exclui");
    assert.ok(!fs.existsSync(path.join(CINCO_S_DIR, "sentinela")), "sanidade");

    // 13. Área agrupadora: uma avaliação por ambiente, resultado acumulado por respostas
    r = await api("aval", "POST", "/avaliacoes", { areaId: mae });
    ok(r, 201, "avaliar a agrupadora");
    assert.strictEqual(r.dados.ambientes, 2);
    const pai = r.dados.id;
    avaliacaoIds.push(pai);
    r = await api("aval", "GET", `/avaliacoes/${pai}`);
    assert.strictEqual(r.dados.filhas.length, 2, "uma avaliação por ambiente");
    assert.strictEqual(r.dados.respostas.length, 0, "o pai não tem respostas");
    assert.strictEqual(r.dados.pode.editar, false);
    ok(await api("aval", "POST", `/avaliacoes/${pai}/finalizar`), 403, "pai não finaliza direto");
    const idCopa = r.dados.filhas.find((f: { areaNome: string }) => f.areaNome.endsWith("Copa")).id;
    const idSala = r.dados.filhas.find((f: { areaNome: string }) => f.areaNome.endsWith("Sala")).id;
    r = await api("aval", "GET", "/avaliacoes");
    const ids = r.dados.itens.map((x: { id: number }) => x.id);
    assert.ok(ids.includes(pai) && !ids.includes(idCopa) && !ids.includes(idSala), "lista mostra o pai e esconde as filhas");
    assert.strictEqual(r.dados.itens.find((x: { id: number }) => x.id === pai).quantidadeAmbientes, 2);
    r = await api("aval", "GET", `/avaliacoes?areaId=${copa}`);
    assert.ok(r.dados.itens.some((x: { id: number }) => x.id === idCopa), "filtrando o ambiente a filha aparece");

    const responder = async (id: number, notas: number[]) => {
      const d = (await api("aval", "GET", `/avaliacoes/${id}`)).dados;
      assert.strictEqual(d.respostas.length, notas.length, "perguntas do ambiente");
      assert.ok(d.pai && d.pai.id === pai, "filha aponta o pai");
      for (const [i, rp] of d.respostas.entries()) ok(await api("aval", "PUT", `/avaliacoes/${id}/respostas/${rp.id}`, { nota: notas[i] }), 200, "responder ambiente");
    };
    await responder(idCopa, [5]); // pergunta geral de ambiente
    await responder(idSala, [3, 1]); // geral + a específica da sala
    ok(await api("aval", "POST", `/avaliacoes/${idCopa}/finalizar`), 204, "finalizar copa");
    r = await api("aval", "GET", `/avaliacoes/${pai}`);
    assert.strictEqual(r.dados.status, "em_andamento", "pai só finaliza quando todas as filhas finalizam");
    ok(await api("aval", "POST", `/avaliacoes/${idSala}/finalizar`), 204, "finalizar sala");
    r = await api("aval", "GET", `/avaliacoes/${pai}`);
    assert.strictEqual(r.dados.status, "finalizada");
    assert.strictEqual(r.dados.percentuais.porSenso.seiri, 60, "acumulado = soma das notas / (5 × perguntas), não média dos %");
    ok(await api("aval", "POST", `/avaliacoes/${idSala}/reabrir`), 204, "reabrir a sala");
    assert.strictEqual((await api("aval", "GET", `/avaliacoes/${pai}`)).dados.status, "em_andamento", "reabrir uma filha reabre o pai");
    ok(await api("aval", "POST", `/avaliacoes/${idSala}/finalizar`), 204, "refinalizar a sala");

    r = await api("admin", "GET", "/dashboard?tipo=setor");
    const linhaMae = r.dados.ranking.find((x: { nome: string }) => x.nome === `${TAG} Comum`);
    assert.ok(linhaMae && linhaMae.acumulado && linhaMae.geral === 60, "agrupadora entra no ranking de setores com o acúmulo");
    r = await api("admin", "GET", "/dashboard?tipo=comum");
    const comuns = r.dados.ranking.filter((x: { nome: string }) => x.nome.startsWith(TAG)).map((x: { nome: string; geral: number }) => [x.nome.replace(`${TAG} `, ""), x.geral]);
    assert.deepStrictEqual(comuns.sort(), [["Copa", 100], ["Sala", 40]], "a aba de ambientes mostra cada ambiente");
    r = await api("lider", "GET", "/dashboard?tipo=setor");
    assert.ok(r.dados.ranking.some((x: { nome: string }) => x.nome === `${TAG} Comum`), "líder vê a agrupadora no ranking");
    assert.ok(!r.dados.ranking.some((x: { nome: string }) => x.nome === `${TAG} Dev`), "líder não vê outro setor");
    const mesAgora = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const mesAnt = new Date();
    mesAnt.setMonth(mesAnt.getMonth() - 1, 1);
    const mesAntStr = `${mesAnt.getFullYear()}-${String(mesAnt.getMonth() + 1).padStart(2, "0")}`;
    r = await api("admin", "GET", `/comparativo?meses=${mesAntStr},${mesAgora}&areaId=${mae}`);
    assert.deepStrictEqual(r.dados.linhas.find((l: { chave: string }) => l.chave === "geral").valores, [null, 60], "comparativo da agrupadora usa o acúmulo");

    // Avaliar um ambiente sozinho: sem pai, e o resultado acumula na área mãe
    r = await api("aval", "POST", "/avaliacoes", { areaId: copa });
    ok(r, 201, "avaliar só um ambiente");
    const solta = r.dados.id;
    avaliacaoIds.push(solta);
    r = await api("aval", "GET", `/avaliacoes/${solta}`);
    assert.strictEqual(r.dados.pai, null);
    ok(await api("aval", "PUT", `/avaliacoes/${solta}/respostas/${r.dados.respostas[0].id}`, { nota: 5 }), 200, "responder");
    ok(await api("aval", "POST", `/avaliacoes/${solta}/finalizar`), 204, "finalizar ambiente solto");
    r = await api("admin", "GET", "/dashboard?tipo=setor");
    assert.strictEqual(r.dados.ranking.find((x: { nome: string }) => x.nome === `${TAG} Comum`).geral, 70, "ambiente avaliado sozinho acumula na mãe: (5+3+1+5)/20 = 70%");

    // Exclusão: o pai só sai com todas as filhas em andamento e leva as filhas junto
    ok(await api("aval", "DELETE", `/avaliacoes/${pai}`), 403, "pai com filha finalizada não exclui");
    ok(await api("aval", "POST", `/avaliacoes/${idCopa}/reabrir`), 204, "reabrir copa");
    ok(await api("aval", "POST", `/avaliacoes/${idSala}/reabrir`), 204, "reabrir sala");
    ok(await api("aval", "DELETE", `/avaliacoes/${pai}`), 204, "excluir o pai");
    avaliacaoIds.splice(avaliacaoIds.indexOf(pai), 1);
    assert.strictEqual(await prisma.avaliacao5S.count({ where: { id: { in: [pai, idCopa, idSala] } } }), 0, "as filhas saem junto");
    // Excluir a última filha de um pai remove o invólucro
    r = await api("aval", "POST", "/avaliacoes", { areaId: mae });
    const pai2 = r.dados.id;
    avaliacaoIds.push(pai2);
    const filhas2 = (await api("aval", "GET", `/avaliacoes/${pai2}`)).dados.filhas.map((f: { id: number }) => f.id);
    ok(await api("aval", "DELETE", `/avaliacoes/${filhas2[0]}`), 204, "excluir uma filha");
    assert.ok(await prisma.avaliacao5S.findUnique({ where: { id: pai2 } }), "pai continua com a outra filha");
    ok(await api("aval", "DELETE", `/avaliacoes/${filhas2[1]}`), 204, "excluir a última filha");
    assert.strictEqual(await prisma.avaliacao5S.findUnique({ where: { id: pai2 } }), null, "sem filhas o invólucro some");
    avaliacaoIds.splice(avaliacaoIds.indexOf(pai2), 1);

    console.log("OK — API do 5S: acesso, cadastros, avaliação, imagens, recorte de líder, dashboard e auditoria");
  } finally {
    await prisma.auditEvento.deleteMany({ where: { entidadeTipo: "avaliacao_5s", entidadeRotulo: { contains: TAG } } });
    const imgs = await prisma.imagem5S.findMany({ where: { OR: [{ resposta: { avaliacao: { areaId: { in: areaIds } } } }, { avaliacaoSenso: { avaliacao: { areaId: { in: areaIds } } } }, { observacao: { areaId: { in: areaIds } } }] }, select: { caminhoArquivo: true } });
    for (const i of imgs) fs.rmSync(path.join(CINCO_S_DIR, i.caminhoArquivo), { force: true });
    await prisma.avaliacao5S.deleteMany({ where: { areaId: { in: areaIds } } });
    await prisma.area5S.deleteMany({ where: { id: { in: areaIds } } });
    await prisma.pergunta5S.deleteMany({ where: { texto: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
    // Eventos de auditoria de avaliações excluídas ficam com o rótulo do título (contém a área com TAG).
    await prisma.auditEvento.deleteMany({ where: { entidadeRotulo: { contains: TAG } } });
    server.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
