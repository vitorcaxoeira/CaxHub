import fs from "fs";
import path from "path";

// process.cwd() é sempre a raiz do projeto backend (tanto rodando via ts-node-dev
// quanto o build compilado em dist/), diferente de __dirname que varia entre os dois.
export const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// Única subpasta de uploads servida como estático (express.static, sem auth) — avatar
// precisa carregar via <img src> puro, sem header Authorization. Todo outro upload do
// projeto continua só acessível via rota autenticada (res.download), de propósito.
export const AVATARS_DIR = path.join(UPLOADS_DIR, "avatars");

export function garantirDiretorioUploads(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}
