import bcrypt from "bcrypt";
import { prisma } from "../src/db/prisma";

const PAPEIS_NOVOS = [
  "administrativo",
  "comercial",
  "gerente_comercial",
  "consultoria",
  "gerente_consultoria",
  "suporte",
  "gerente_suporte",
  "desenvolvimento",
  "gerente_desenvolvimento",
  "system",
];

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin" },
  });

  for (const nome of PAPEIS_NOVOS) {
    await prisma.role.upsert({ where: { name: nome }, update: {}, create: { name: nome } });
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
