import bcrypt from "bcrypt";
import { prisma } from "../src/db/prisma";

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin" },
  });

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
