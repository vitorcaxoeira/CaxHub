// Preenche User.consultorCodemp/consultorCodusu pra usuários que ficaram sem esse
// vínculo — hoje ele só é resolvido em POST /users/convites e (depois deste commit)
// POST /users e PUT /users/:id (quando o e-mail muda). Usuários criados antes dessa
// correção, ou por qualquer outro caminho que não passe por lá, ficam com os dois campos
// nulos mesmo tendo um Consultor com o mesmo e-mail — e como o Kanban/Atividades resolvem
// a foto do consultor via Consultor.usuariosCaxHub (User[]), sem o vínculo o avatar real
// nunca aparece, só o fallback de iniciais.
//
// Idempotente: só toca em User com os dois campos nulos — seguro rodar quantas vezes
// precisar.
//
// Uso:
//   npx ts-node prisma/vincularConsultorPorEmail.ts              (relatório, não grava nada)
//   npx ts-node prisma/vincularConsultorPorEmail.ts --aplicar    (grava de verdade)
import { prisma } from "../src/db/prisma";

const aplicar = process.argv.includes("--aplicar");

async function main() {
  const usuariosSemVinculo = await prisma.user.findMany({
    where: { consultorCodemp: null, consultorCodusu: null },
  });

  console.log(`\n=== Vincular Consultor por e-mail ${aplicar ? "(APLICANDO)" : "(RELATÓRIO — nada será gravado)"} ===\n`);
  console.log(`Usuários sem vínculo: ${usuariosSemVinculo.length}`);

  let comMatch = 0;
  for (const user of usuariosSemVinculo) {
    const consultor = await prisma.consultor.findFirst({
      where: { email: { equals: user.email, mode: "insensitive" } },
    });
    if (!consultor) continue;
    comMatch++;
    console.log(
      `  id=${user.id} nome="${user.nome}" email=${user.email} -> Consultor codemp=${consultor.codemp} codusu=${consultor.codusu} codfor=${consultor.codfor}`
    );
    if (aplicar) {
      await prisma.user.update({
        where: { id: user.id },
        data: { consultorCodemp: consultor.codemp, consultorCodusu: consultor.codusu },
      });
    }
  }

  console.log(`\nCom Consultor correspondente por e-mail: ${comMatch}`);
  if (!aplicar) {
    console.log("\nRodar com --aplicar para gravar.\n");
  } else {
    console.log(`\nConcluído: ${comMatch} usuário(s) vinculado(s).\n`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
