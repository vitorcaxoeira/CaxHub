import fs from "fs";
import path from "path";

// process.cwd() é sempre a raiz do projeto backend (tanto rodando via ts-node-dev
// quanto o build compilado em dist/), diferente de __dirname que varia entre os dois.
export const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export function garantirDiretorioUploads(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
