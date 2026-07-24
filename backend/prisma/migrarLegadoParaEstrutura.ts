// Migração de dado (não de schema): converte alocações do fluxo antigo "item" — direto
// em AtividadeConsultor, sem `estruturaAtividadeId` — pro formato "estrutura" (EAP),
// criando 1 EstruturaAtividade (tipo "atividade") por alocação legada, filha direta do
// item, e linkando via estruturaAtividadeId. Mesmo formato que o lote novo já grava
// (ver alocacaoRouter.post(".../alocar-lote") em backend/src/routes/alocacao.ts):
// nome = nome do item, responsavelCodfor = consultor.
//
// Escopo: só propostas com sitpro Aprovada(4) ou Em Execução(7) — as únicas situações
// que as telas de alocação (item ou estrutura) liberam hoje (SITPRO_ALOCAVEL, ver
// backend/src/domain/propostasDominio.ts). Propostas fora desse recorte já são
// inacessíveis nas duas telas, migrar não muda nada visível.
//
// Cobre as 2 formas de "modo item" que existem hoje: implícita (sem PropostaModoAlocacao,
// inferida por já ter AtividadeConsultor ativa — era o fallback de resolverModoAlocacao)
// e explícita (PropostaModoAlocacao.modo="item", de quando o modal "Como esta proposta
// será alocada?" ainda existia e alguém escolheu "Por item"). As duas viram "estrutura".
//
// Idempotente: pula proposta que já esteja em "estrutura" — seguro rodar mais de uma vez.
//
// Uso:
//   npx ts-node prisma/migrarLegadoParaEstrutura.ts              (relatório, não grava nada)
//   npx ts-node prisma/migrarLegadoParaEstrutura.ts --aplicar    (grava de verdade)
import { prisma } from "../src/db/prisma";

const SITPRO_ALOCAVEL = [4, 7];

// EstruturaAtividade.nome é VarChar(200) — PropostaItem.despro é VarChar(2000) e vários
// itens reais passam de 200 (achado rodando este script pela 1ª vez contra o banco real:
// 40 itens no escopo, um deles com 1545 caracteres). Trunca preservando o texto completo
// só no `despro` do item em si (que não muda) — aqui é só o rótulo da atividade.
function truncarNome(nome: string): string {
  return nome.length > 200 ? `${nome.slice(0, 197)}...` : nome;
}

const aplicar = process.argv.includes("--aplicar");

async function main() {
  const propostasComModo = await prisma.propostaModoAlocacao.findMany({ select: { codemp: true, codpro: true, modo: true } });
  // "estrutura" já migrada/definida: pula (idempotência). "item" explícito: entra no
  // recorte pra virar "estrutura" também (com UPDATE em vez de CREATE no final).
  const jaEstrutura = new Set(propostasComModo.filter((p) => p.modo === "estrutura").map((p) => `${p.codemp}-${p.codpro}`));
  const itemExplicito = new Set(propostasComModo.filter((p) => p.modo === "item").map((p) => `${p.codemp}-${p.codpro}`));

  const alocacoesLegadas = await prisma.atividadeConsultor.findMany({
    where: { sitreg: "A", estruturaAtividadeId: null },
    orderBy: [{ codemp: "asc" }, { codpro: "asc" }, { id: "asc" }],
  });

  const porProposta = new Map<string, typeof alocacoesLegadas>();
  for (const a of alocacoesLegadas) {
    const chave = `${a.codemp}-${a.codpro}`;
    if (jaEstrutura.has(chave)) continue;
    if (!porProposta.has(chave)) porProposta.set(chave, []);
    porProposta.get(chave)!.push(a);
  }
  // Proposta com "item" explícito mas 0 alocação ativa não aparece em `porProposta`
  // (não tem nenhuma linha em atividades_consultor pra iterar) — garante que ela ainda
  // entre no recorte, só pra trocar o modo (sem nó nenhum pra criar).
  for (const chave of itemExplicito) {
    if (!jaEstrutura.has(chave) && !porProposta.has(chave)) porProposta.set(chave, []);
  }

  const chaves = [...porProposta.keys()];
  const propostasInfo =
    chaves.length > 0
      ? await prisma.proposta.findMany({
          where: { OR: chaves.map((c) => { const [codemp, codpro] = c.split("-").map(Number); return { codemp, codpro }; }) },
          select: { codemp: true, codpro: true, sitpro: true },
        })
      : [];
  const sitproPorProposta = new Map(propostasInfo.map((p) => [`${p.codemp}-${p.codpro}`, p.sitpro]));

  const candidatas: { chave: string; codemp: number; codpro: number; alocacoes: typeof alocacoesLegadas; jaTinhaConfigItem: boolean }[] = [];
  for (const [chave, alocs] of porProposta) {
    const sitpro = sitproPorProposta.get(chave);
    if (sitpro == null || !SITPRO_ALOCAVEL.includes(sitpro)) continue;
    const [codemp, codpro] = chave.split("-").map(Number);
    candidatas.push({ chave, codemp, codpro, alocacoes: alocs, jaTinhaConfigItem: itemExplicito.has(chave) });
  }

  const totalAlocacoes = candidatas.reduce((s, c) => s + c.alocacoes.length, 0);
  const comConfigItem = candidatas.filter((c) => c.jaTinhaConfigItem).length;
  console.log(`\n=== Migração legado -> estrutura ${aplicar ? "(APLICANDO)" : "(RELATÓRIO — nada será gravado)"} ===\n`);
  console.log(`Propostas candidatas (sitpro 4 ou 7, ainda não em "estrutura"): ${candidatas.length}`);
  console.log(`  — das quais com PropostaModoAlocacao="item" explícita: ${comConfigItem}`);
  console.log(`Alocações ativas nessas propostas: ${totalAlocacoes}`);

  const anomalas = candidatas.flatMap((c) =>
    c.alocacoes.filter((a) => a.qtdhor == null || a.qtdhor <= 0).map((a) => ({ ...a, codemp: c.codemp, codpro: c.codpro }))
  );
  if (anomalas.length > 0) {
    console.log(`\n${anomalas.length} alocação(ões) com qtdhor inválido (NÃO serão migradas, revisar manualmente):`);
    for (const a of anomalas) {
      console.log(`  id=${a.id} codemp=${a.codemp} codpro=${a.codpro} seqite=${a.seqite} codfor=${a.codfor} qtdhor=${a.qtdhor}`);
    }
  }

  if (!aplicar) {
    console.log("\nRodar com --aplicar para gravar.\n");
    return;
  }

  let propostasMigradas = 0;
  let nosCriados = 0;

  for (const c of candidatas) {
    const validas = c.alocacoes.filter((a) => a.qtdhor != null && a.qtdhor > 0);

    const seqites = [...new Set(validas.map((a) => a.seqite))];
    const itens =
      seqites.length > 0
        ? await prisma.propostaItem.findMany({
            where: { codemp: c.codemp, codpro: c.codpro, seqite: { in: seqites } },
            select: { seqite: true, despro: true, codser: true },
          })
        : [];
    const itemPorSeqite = new Map(itens.map((i) => [i.seqite, i]));

    await prisma.$transaction(async (tx) => {
      const ordemPorSeqite = new Map<number, number>();
      for (const a of validas) {
        const item = itemPorSeqite.get(a.seqite);
        if (!item) {
          console.warn(`  aviso: PropostaItem não encontrado pra codemp=${c.codemp} codpro=${c.codpro} seqite=${a.seqite}, pulando alocação id=${a.id}`);
          continue;
        }
        const nome = truncarNome(item.despro ?? item.codser);
        const ordem = ordemPorSeqite.get(a.seqite) ?? 0;
        ordemPorSeqite.set(a.seqite, ordem + 1);

        const no = await tx.estruturaAtividade.create({
          data: {
            codemp: c.codemp,
            codpro: c.codpro,
            seqite: a.seqite,
            parentId: null,
            tipo: "atividade",
            nome,
            ordem,
            duracaoHoras: a.qtdhor,
            responsavelCodfor: a.codfor,
            dataPrevistaInicio: a.dataPrevistaInicio,
            dataPrevistaFim: a.dataPrevistaFim,
          },
        });
        await tx.atividadeConsultor.update({ where: { id: a.id }, data: { estruturaAtividadeId: no.id } });
        nosCriados++;
      }
      if (c.jaTinhaConfigItem) {
        await tx.propostaModoAlocacao.update({ where: { codemp_codpro: { codemp: c.codemp, codpro: c.codpro } }, data: { modo: "estrutura" } });
      } else {
        await tx.propostaModoAlocacao.create({ data: { codemp: c.codemp, codpro: c.codpro, modo: "estrutura" } });
      }
    });
    propostasMigradas++;
  }

  console.log(`\nConcluído: ${propostasMigradas} propostas migradas, ${nosCriados} nós criados.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
