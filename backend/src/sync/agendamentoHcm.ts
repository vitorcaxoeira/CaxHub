import cron from "node-cron";
import { hcmConfigurado } from "../config/sistemaSenior";
import { CRON_HCM, SYNC_JOBS_HCM } from "./registry";

// O HCM roda ENCADEADO num cron só (cadastros antes dos fatos, na ordem de sync/hcm/tabelasHcm.ts) e
// nunca em paralelo: são 27 tabelas lendo o mesmo serviço SOAP, e rodar todas às 4h ao mesmo tempo
// estouraria o timeout de 20s por página. Um job que falha não derruba os seguintes (cada run()
// já grava o próprio erro no SyncLog).
let rodandoHcm = false;

export async function rodarTodosJobsHcm(): Promise<void> {
  if (rodandoHcm) return;
  rodandoHcm = true;
  try {
    for (const job of SYNC_JOBS_HCM) await job.run();
  } finally {
    rodandoHcm = false;
  }
}

export function agendarSyncHcm(): void {
  if (!hcmConfigurado()) {
    console.warn("[boot] canal do HCM não configurado (SENIOR_HCM_BANCO ou SENIOR_HCM_SOAP_*): sincronização do RH não agendada");
    return;
  }
  cron.schedule(CRON_HCM, () => void rodarTodosJobsHcm());
}
