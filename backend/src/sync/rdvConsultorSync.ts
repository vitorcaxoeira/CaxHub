// "Atualizar" do card de RDV da Home (25/09/2026): busca no Senior, sob demanda, os títulos a
// pagar de reembolso de UM consultor — os mesmos que o card mostra (rdvDoConsultor em
// domain/resumoConsultor.ts): fornecedor = o consultor e tipo de título = CODTPT_RDV.
//
// Traz o título em QUALQUER situação, não só em aberto ("AB"): é assim que um título que foi
// pago no Senior desde a última sincronização vira "LQ" aqui e sai do card. Filtrar por "AB" na
// consulta deixaria o título pago parado como "aberto" pra sempre.
//
// Reaproveita a query, as colunas e a linha do sync noturno completo (tituloPagarSync.ts) — não
// existe segunda definição de "o que é um título" —, só restringe o recorte. Não apaga nada e
// não roda a varredura de removidos: um título excluído no Senior continua sendo tratado só pelo
// sync noturno (que respeita a política de varredura configurada).
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { CODTPT_RDV } from "../domain/resumoConsultor";
import { montarQuerySenior } from "./consultaSenior";
import { upsertEmLote } from "./upsertEmLote";
import { BASE_QUERY, COLUNAS_TITULO_PAGAR, linhaDeTituloPagar, TituloPagarRow } from "./tituloPagarSync";

// Lock e último resultado em memória (processo único, mesmo raciocínio de
// contabilSyncOrchestrator.ts). Por consultor: dois consultores atualizando ao mesmo tempo não
// se atrapalham, mas o mesmo consultor não dispara duas consultas iguais ao ERP.
const emAndamento = new Set<number>();
const ultimoResultado = new Map<number, { em: Date; erro: string | null; duracaoMs: number }>();

export function rdvConsultorEmAndamento(codfor: number): boolean {
  return emAndamento.has(codfor);
}

export async function statusRdvConsultor(codfor: number) {
  // Última vez que QUALQUER sincronização (esta ou a noturna) confirmou um título deste
  // consultor: `visto_em_sync` é carimbado em todo upsert. Sem título nenhum, cai no resultado
  // em memória da última atualização manual, se houver.
  const agregado = await prisma.tituloPagar.aggregate({
    where: { codfor, codtpt: CODTPT_RDV },
    _max: { vistoEmSync: true },
  });
  const manual = ultimoResultado.get(codfor);
  const datas = [agregado._max.vistoEmSync, manual && !manual.erro ? manual.em : null].filter((d): d is Date => d != null);
  return {
    emAndamento: emAndamento.has(codfor),
    ultimaAtualizacao: datas.length > 0 ? new Date(Math.max(...datas.map((d) => d.getTime()))) : null,
    ultimaDuracaoMs: manual && !manual.erro ? manual.duracaoMs : null,
    // Falha da última tentativa manual — sem isto ela seria invisível: a chamada roda em
    // segundo plano e a tela só descobriria "terminou".
    ultimoErro: manual?.erro ?? null,
  };
}

/** Roda a atualização e nunca lança: o resultado (ou o erro) fica no status. */
export async function runSincronizacaoRdvConsultor(codfor: number): Promise<void> {
  if (!Number.isInteger(codfor)) throw new Error("codfor inválido");
  emAndamento.add(codfor);
  const inicio = new Date();
  try {
    // `codfor` já é inteiro validado acima e o tipo é constante — nada vem de texto livre.
    const query = montarQuerySenior(BASE_QUERY, [`codfor = ${codfor}`, `codtpt = '${CODTPT_RDV}'`]);
    const rows = (await runSqlViaSoapPaginated(query, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
      "codfor",
    ])) as TituloPagarRow[];

    const resultado = await upsertEmLote(rows.map(linhaDeTituloPagar), {
      tabela: "titulos_pagar",
      colunas: COLUNAS_TITULO_PAGAR,
      colunasPk: ["codemp", "codfil", "numtit", "codtpt", "codfor"],
      carimbo: inicio,
    });
    ultimoResultado.set(codfor, { em: inicio, erro: null, duracaoMs: Date.now() - inicio.getTime() });
    console.log(
      `[rdv-consultor-sync] codfor ${codfor}: ${resultado.linhasProcessadas} títulos em ${Date.now() - inicio.getTime()}ms`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ultimoResultado.set(codfor, { em: inicio, erro: message, duracaoMs: Date.now() - inicio.getTime() });
    console.error(`[rdv-consultor-sync] codfor ${codfor} falhou:`, message);
  } finally {
    emAndamento.delete(codfor);
  }
}
