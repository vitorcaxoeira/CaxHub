// Em que modo cada job de sincronização roda a varredura de registros removidos no
// Senior (ver varrerRemovidos.ts). É AQUI que o rollout acontece, tabela por tabela:
//
//   desligada -> simular -> marcar
//
// "simular" conta e reporta no painel de administração sem escrever nada; só depois de
// alguns dias com número estável e chaves conferidas no Senior é que a tabela sobe pra
// "marcar". Nenhuma tabela deve pular direto pra "marcar".
//
// Até 10/09/2026 isso vivia num Record<string, ModoVarredura> fixo aqui no código — mudar
// exigia deploy (histórico: piloto pedidos-sync promovido 29/07/2026, rateios_lancamento-sync/
// lancamentos_contabeis-sync promovidos 22/08/2026, todos com simulação conferida antes).
// Porte do mecanismo do CaxHub_Atlas (10/09/2026, pedido do Vitor: tornar padrão): trocado por
// snapshot em memória, mesmo padrão de FiltroSincronizacao/filtrosAtivos.ts — carregado no boot
// (server.ts) e recarregado depois de toda gravação (routes/syncErp.ts, PUT
// /:jobName/varredura). Continua síncrono de propósito — `modoVarredura()` é chamada de dentro
// de `varrerRemovidos()`, que não pode virar async só por causa disso.
import { prisma } from "../db/prisma";

export type ModoVarredura = "desligada" | "simular" | "marcar";

let modosAtivos = new Map<string, ModoVarredura>();
// Teto configurado por tabela (fração, ex.: 0.1 = 10%), mesmo snapshot dos modos. Sem entrada = padrão de varrerRemovidos.ts.
let tetosAtivos = new Map<string, number>();

export function modoVarredura(jobName: string): ModoVarredura {
  // Válvula de emergência: desliga a varredura de TODOS os jobs sem precisar de deploy, só
  // mexendo no .env e reiniciando o container — sobrevive intacta à migração pra configuração
  // editável: é checada ANTES do snapshot, então continua vencendo qualquer coisa salva na
  // tela.
  if (process.env.SYNC_VARREDURA === "off") return "desligada";
  return modosAtivos.get(jobName) ?? "desligada";
}

/** O modo CONFIGURADO (salvo na tela), sem passar pela válvula `SYNC_VARREDURA=off` — é o
 * que a tela precisa mostrar/editar. `modoVarredura()` acima é pra dentro de
 * `varrerRemovidos()`, que precisa do comportamento EFETIVO (com a válvula); os dois podem
 * divergir de propósito quando a válvula está ligada. */
export function modoConfiguradoDoJob(jobName: string): ModoVarredura {
  return modosAtivos.get(jobName) ?? "desligada";
}

/** Recarrega o snapshot inteiro a partir do banco — chamado no boot e após toda gravação de
 * PUT /:jobName/varredura. Job sem linha salva continua "desligada" (default seguro: um job
 * novo nunca começa a marcar registro sozinho). */
export async function carregarModosVarreduraAtivos(): Promise<void> {
  const linhas = await prisma.configuracaoVarredura.findMany();
  tetosAtivos = new Map(linhas.filter((l) => l.tetoPct != null).map((l) => [l.jobName, Number(l.tetoPct) / 100]));
  modosAtivos = new Map(
    linhas
      .filter((l): l is typeof l & { modo: ModoVarredura } => l.modo === "desligada" || l.modo === "simular" || l.modo === "marcar")
      .map((l) => [l.jobName, l.modo])
  );
}

/** Teto configurado na tela para este job, como FRAÇÃO (0.1 = 10%); `null` = usar o padrão de varrerRemovidos.ts. */
export function tetoPctDoJob(jobName: string): number | null {
  return tetosAtivos.get(jobName) ?? null;
}

// LIBERAÇÃO ÚNICA DO TETO (21/10/2026, pedido do Vitor): quando a varredura parou no teto, o admin confere os candidatos na tela de
// importação e libera UMA execução sem o teto (POST /:jobName/varredura/liberar-teto). A liberação é consumida pela primeira varredura
// do job que chegar à checagem do teto (a guarda de contagem na origem continua valendo) e expira em 30 min se nada rodar, para nunca
// sobrar e valer sozinha numa sync agendada horas depois.
const VALIDADE_LIBERACAO_MS = 30 * 60 * 1000;
const liberacoesTeto = new Map<string, { userId: number; expira: number }>();

export function liberarTetoUmaVez(jobName: string, userId: number): void {
  liberacoesTeto.set(jobName, { userId, expira: Date.now() + VALIDADE_LIBERACAO_MS });
}

/** Devolve quem liberou (e apaga a liberação), ou `null` se não há liberação válida para este job. */
export function consumirLiberacaoTeto(jobName: string): number | null {
  const l = liberacoesTeto.get(jobName);
  if (!l) return null;
  liberacoesTeto.delete(jobName);
  return l.expira >= Date.now() ? l.userId : null;
}
