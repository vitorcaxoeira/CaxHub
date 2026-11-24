// Teste manual do canal de leitura GET /teams do Kyria (ver src/kyria/client.ts).
// Só leitura — sem risco de escrever nada.
//
// Uso:
//   node_modules/.bin/ts-node prisma/verificarKyriaTeams.ts
import "dotenv/config";
import { listAllTeams } from "../src/kyria/client";

async function main() {
  const teams = await listAllTeams();
  console.log(`Times recebidos: ${teams.length}`);
  console.log(JSON.stringify(teams, null, 2));
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
