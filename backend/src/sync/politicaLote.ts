// Tamanho do lote de upsert (ver upsertEmLote.ts), configurado pelo admin, por job — mesmo
// padrão de politicaVarredura.ts: snapshot em memória, carregado no boot e recarregado após
// toda gravação. `undefined` (sem linha salva) significa "usa o default do próprio
// upsertEmLote.ts" (TAMANHO_LOTE_PADRAO = 1000) — esse número nunca é duplicado aqui.
//
// Diferente de politicaVarredura.ts, não existe válvula de emergência tipo
// `SYNC_VARREDURA=off`: tamanho de lote não é um recurso que precisa de kill switch, é só um
// parâmetro de performance — o pior caso de um valor mal configurado já é protegido dentro do
// próprio upsertEmLote.ts (Math.min contra o teto de parâmetros do protocolo).
import { prisma } from "../db/prisma";

let tamanhosAtivos = new Map<string, number>();

/** `undefined` = sem configuração salva, upsertEmLote.ts usa o próprio default. */
export function tamanhoLoteConfigurado(jobName: string): number | undefined {
  return tamanhosAtivos.get(jobName);
}

/** Recarrega o snapshot inteiro a partir do banco — chamado no boot e após toda gravação de
 * PUT /:jobName/lote. Job sem linha salva (ou com tamanhoLote NULL) continua sem entrada no
 * Map, o que `tamanhoLoteConfigurado` já trata como "usa o default". */
export async function carregarTamanhosLoteAtivos(): Promise<void> {
  const linhas = await prisma.configuracaoLote.findMany();
  tamanhosAtivos = new Map(
    linhas
      .filter((l): l is typeof l & { tamanhoLote: number } => l.tamanhoLote != null && l.tamanhoLote >= 1)
      .map((l) => [l.jobName, l.tamanhoLote])
  );
}
