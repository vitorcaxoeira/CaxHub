import bcrypt from "bcrypt";
import { prisma } from "../src/db/prisma";

const PAPEIS_NOVOS = ["administrativo", "comercial", "consultoria", "suporte", "desenvolvimento", "system"];

// Papéis antigos que separavam gerente/colaborador por área — consolidados de volta
// no papel único da área, já que "quem gerencia o quê" agora é derivado dinamicamente
// de DepartamentoGestor/DepartamentoTime (GET /dashboard/meu-perfil), não precisa
// mais estar embutido no papel do usuário.
const PAPEIS_CONSOLIDADOS: Record<string, string> = {
  gerente_comercial: "comercial",
  gerente_consultoria: "consultoria",
  gerente_suporte: "suporte",
  gerente_desenvolvimento: "desenvolvimento",
};

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin" },
  });

  for (const nome of PAPEIS_NOVOS) {
    await prisma.role.upsert({ where: { name: nome }, update: {}, create: { name: nome } });
  }

  for (const [nomeAntigo, nomeNovo] of Object.entries(PAPEIS_CONSOLIDADOS)) {
    const antigo = await prisma.role.findUnique({ where: { name: nomeAntigo } });
    if (!antigo) continue;
    const novo = await prisma.role.findUniqueOrThrow({ where: { name: nomeNovo } });
    await prisma.user.updateMany({ where: { roleId: antigo.id }, data: { roleId: novo.id } });
    await prisma.role.delete({ where: { id: antigo.id } });
    console.log(`Papel "${nomeAntigo}" consolidado em "${nomeNovo}"`);
  }

  const passwordHash = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: "admin@caxhub.local" },
    update: {},
    create: {
      email: "admin@caxhub.local",
      passwordHash,
      nome: "Administrador",
      roleId: adminRole.id,
    },
  });

  console.log("Seed concluído: admin@caxhub.local / admin123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
