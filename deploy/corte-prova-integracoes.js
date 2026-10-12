// Usado pelo deploy/corte-soeltech.sh dentro do container do backend: prova que a VPS nova fala com
// o Senior (ERP), o HCM e a Kyria com as credenciais reais. Token de 10 min, nunca impresso.
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

(async () => {
  const p = new PrismaClient();
  const [a] = await p.$queryRawUnsafe(
    `select u.id, r.name as role from "User" u join "Role" r on r.id = u."roleId" where r.name = 'admin' and u.status = 'ativo' order by u.id limit 1`,
  );
  const t = jwt.sign({ userId: a.id, role: a.role }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const jobs = [["sync-erp", "empresa-sync"], ["sync-hcm", "hcm-empresas-sync"], ["sync-kyria", "kyria-teams-sync"]];
  for (const [rota, job] of jobs) {
    const t0 = Date.now();
    const res = await fetch(`http://frontend/api/${rota}/${job}/run`, {
      method: "POST",
      headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
      body: "{}",
    });
    console.log(`${job}: HTTP ${res.status} em ${Date.now() - t0} ms ${(await res.text()).slice(0, 160)}`);
  }
  await new Promise((r) => setTimeout(r, 20000));
  const logs = await p.$queryRawUnsafe(
    `select distinct on ("jobName") "jobName", status, "runAt" from "SyncLog" where "jobName" in ('empresa-sync','hcm-empresas-sync','kyria-teams-sync') order by "jobName", "runAt" desc`,
  );
  for (const l of logs) console.log(`SyncLog ${l.jobName}: ${l.status} ${new Date(l.runAt).toISOString()}`);
  await p.$disconnect();
})().catch((e) => {
  console.error("FALHA", e.message);
  process.exit(1);
});
