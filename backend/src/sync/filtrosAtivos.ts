// Resolver central dos filtros ativos — Fase 3 do plano de filtros na importação
// (~/.claude/plans/se-liga-na-necessidade-resilient-lark.md, seção C). Como o filtro é salvo
// e vale também no cron (decisão do Vitor, 21/08/2026), ele não precisa trafegar pela rota:
// cada job pergunta a este módulo no momento de montar a query. Snapshot em memória, carregado
// no boot (server.ts) e recarregado depois de qualquer salvamento (routes/syncErp.ts) —
// premissa: processo único no backend (mesma premissa que upsertEmLote.ts e o resto do compose
// já assumem), então não existe outro processo com snapshot desatualizado pra sincronizar.
import { prisma } from "../db/prisma";
// `import type`: SyncJobDescriptor só é usado como anotação de tipo aqui — nunca importamos
// SYNC_JOBS (o valor) deste módulo. `carregarFiltrosAtivos` recebe a lista de jobs por
// parâmetro em vez de importar `SYNC_JOBS` de registry.ts de propósito: registry.ts importa
// pedidoSync.ts (pro catálogo da Fase 1/2), que importa `filtroDoJob` deste arquivo — um
// import de VALOR de volta pra registry.ts fecharia um ciclo (registry -> pedidoSync ->
// filtrosAtivos -> registry) que quebra a montagem de SYNC_JOBS: o array é construído de
// forma EAGER no import do módulo, e um ciclo faria `catalogo()` rodar com a query de
// pedidoSync ainda `undefined` (visto na prática: `TypeError: Cannot read properties of
// undefined (reading 'match')` em extrairTabela). Passar a lista por parâmetro rompe o ciclo
// sem perder nada — os dois chamadores (server.ts no boot, routes/syncErp.ts ao salvar) já
// têm `SYNC_JOBS` em mãos.
import type { SyncJobDescriptor } from "./registry";
import {
  validarEMontarPredicado,
  PredicadoFiltro,
  PredicadoValidado,
  OperadorFiltro,
  VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO,
  substituirVariavelUltimaSincronizacao,
} from "./filtroSenior";
import { campoLocal } from "./catalogoCampos";

// Fase 6 do plano de filtros: até 2 filtros INDEPENDENTES por tabela, um por modo. "todos"
// vale pro cron também (o cron sempre roda sem `desde`); "alterados" só quando a
// sincronização incremental roda (mesmo vocabulário já usado em `req.body.modo` de
// `POST /:jobName/run`, routes/syncErp.ts — não um enum novo).
export type ModoFiltro = "todos" | "alterados";

function chaveSnapshot(jobName: string, modo: ModoFiltro): string {
  return `${jobName}:${modo}`;
}

export interface FiltroResolvido {
  // Fragmentos SQL já validados, prontos pra entrar em `montarQuerySenior` — é o que
  // `montarQuery(desde?)` de cada job consome.
  predicadosSql: string[];
  // Equivalente local (`where` do Prisma, tipado fraco — o call site casta pro WhereInput do
  // model certo, mesmo padrão que varrerRemovidos já usa) pra escopar a varredura de
  // removidos. `null` = pelo menos um predicado é sobre campo NÃO espelhado — sem isso a
  // varredura marcaria a base inteira como removida (ver seção F do plano), então o job
  // precisa desligar a varredura nessa rodada.
  escopoLocal: Record<string, unknown> | null;
  motivoNaoEscopavel: string | null;
  // Nomes de ORIGEM (lowercase) de todo predicado validado, escopável ou não — usado só pelo
  // modo Alterados pra saber se o admin já assumiu o controle do corte de data (CAMPO_DATA) e
  // então o job deve pular a injeção automática de `CAMPO_DATA >= desde` (ver montarQuery dos
  // 15 jobs com incremental). Pedido do Vitor, 21/08/2026.
  camposCobertos: Set<string>;
}

const FILTRO_VAZIO: FiltroResolvido = { predicadosSql: [], escopoLocal: {}, motivoNaoEscopavel: null, camposCobertos: new Set() };

let snapshot = new Map<string, FiltroResolvido>();

/** Leitura síncrona do snapshot — chamada de dentro de `montarQuery`/`run()` de cada job.
 * `modo` é derivado no call site de `desde ? "alterados" : "todos"` (Fase 6). `desde` (3º
 * parâmetro, opcional): quando `modo==="alterados"`, resolve a variável "última sincronização"
 * (se algum predicado salvo a usa) pra data real ANTES de devolver — os 34 outros call sites
 * (que sempre passam 2 argumentos) continuam compilando sem mudança. */
export function filtroDoJob(jobName: string, modo: ModoFiltro, desde?: Date): FiltroResolvido {
  const resolvido = snapshot.get(chaveSnapshot(jobName, modo)) ?? FILTRO_VAZIO;
  if (modo !== "alterados" || !desde) return resolvido;
  return { ...resolvido, predicadosSql: substituirVariavelUltimaSincronizacao(resolvido.predicadosSql, desde) };
}

/**
 * Valida uma lista de predicados CANDIDATA (ainda não necessariamente salva) e resolve o
 * equivalente local pra varredura. Usada tanto pelo carregamento do snapshot (predicados já
 * salvos no banco) quanto pelas rotas de salvar/preview (predicados que o admin ainda está
 * editando) — um só lugar decide "isso é um filtro válido e o que ele quer dizer localmente".
 * Lança no primeiro predicado inválido: um filtro corrompido nunca é aplicado pela metade.
 */
export async function resolverPredicados(job: SyncJobDescriptor, predicados: PredicadoFiltro[]): Promise<FiltroResolvido> {
  if (predicados.length === 0) return { predicadosSql: [], escopoLocal: {}, motivoNaoEscopavel: null, camposCobertos: new Set() };

  const validados: PredicadoValidado[] = [];
  for (const predicado of predicados) {
    validados.push(await validarEMontarPredicado(job, predicado));
  }

  const escopoLocal: Record<string, unknown> = {};
  let motivoNaoEscopavel: string | null = null;
  const camposCobertos = new Set<string>();
  for (const validado of validados) {
    camposCobertos.add(validado.colunaOrigem.toLowerCase());

    // Pedido do Vitor (21/08/2026): predicado com a variável "última sincronização" é
    // resolvido em tempo de execução (ver filtroDoJob), nunca vira uma condição Prisma
    // estática aqui — mesmo caminho que "campo não espelhado" já usa. Sem impacto prático: o
    // modo Alterados nunca varre mesmo, isso é só sobre estar correto, não sobre comportamento.
    if (validado.valores.includes(VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO)) {
      motivoNaoEscopavel = `predicado em "${validado.colunaOrigem}" usa uma variável resolvida em tempo de execução — não dá pra escopar a varredura por ele`;
      continue;
    }

    const coluna = job.colunas.find((c) => c.origem.toLowerCase() === validado.colunaOrigem.toLowerCase());
    if (!coluna) {
      motivoNaoEscopavel = `campo "${validado.colunaOrigem}" não é espelhado localmente`;
      continue;
    }
    const condicao = condicaoPrisma(job.tabelaLocal, coluna.alias, validado);
    // Dois predicados no MESMO campo (ex.: duas faixas) não podem virar duas chaves iguais
    // num objeto JS — o segundo sobrescreveria o primeiro. Acumula em `AND` explícito.
    if (Object.prototype.hasOwnProperty.call(escopoLocal, coluna.alias)) {
      const existente = { [coluna.alias]: escopoLocal[coluna.alias] };
      delete escopoLocal[coluna.alias];
      escopoLocal.AND = [...(Array.isArray(escopoLocal.AND) ? (escopoLocal.AND as unknown[]) : [existente]), { [coluna.alias]: condicao }];
    } else {
      escopoLocal[coluna.alias] = condicao;
    }
  }

  return {
    predicadosSql: validados.map((v) => v.fragmentoSql),
    escopoLocal: motivoNaoEscopavel ? null : escopoLocal,
    motivoNaoEscopavel,
    camposCobertos,
  };
}

// `tabelaLocal`/`alias` decidem o tipo pro `where` do Prisma a partir do SCHEMA LOCAL, não da
// categoria do dicionário do Senior — as duas divergem exatamente no caso que causou um bug
// real na primeira verificação desta fase: um campo de domínio (categoria "dominio",
// filtroSenior.ts) pode ser Int por baixo no schema local (ex.: `sitped`) mesmo vindo como
// código/string do dicionário do Senior. `campoLocal` (catalogoCampos.ts, Fase 2) já faz essa
// pergunta certa: "o Prisma, pra ESTA coluna, quer que tipo de valor?".
function condicaoPrisma(tabelaLocal: string, alias: string, validado: PredicadoValidado): unknown {
  const tipoLocal = campoLocal(tabelaLocal, alias)?.tipo ?? null;
  const tipar = (v: string) => valorTipado(v, tipoLocal);
  const [v1, v2] = validado.valores;
  const operador: OperadorFiltro = validado.operador;
  switch (operador) {
    case "=":
      return tipar(v1);
    case "≠":
      return { not: tipar(v1) };
    case "IN":
      return { in: validado.valores.map(tipar) };
    case "≥":
      return { gte: tipar(v1) };
    case "≤":
      return { lte: tipar(v1) };
    case "entre":
      return { gte: tipar(v1), lte: tipar(v2) };
    case "contém":
      return { contains: v1 };
    case "começa com":
      return { startsWith: v1 };
  }
}

// Valores já foram checados por filtroSenior.ts (formato/faixa) — aqui só convertemos pro
// tipo que o Prisma Client espera na cláusula `where`, a partir do tipo REAL do schema local
// (`tipoLocal`, de `campoLocal`/Prisma.dmmf — não da categoria do Senior, ver comentário em
// `condicaoPrisma`). Decimal aceita string na comparação (o driver converte), então não
// precisa de Number() ali — converter perderia precisão à toa. `tipoLocal: null` (coluna sem
// match no schema — só acontece no campo sem @map do projeto, ver Rat.dataApr) cai no
// default string; se isso um dia gerar erro de tipo do Prisma, o erro é claro (mesma classe
// do bug que este comentário documenta), não um resultado errado silencioso.
function valorTipado(v: string, tipoLocal: string | null): string | number | bigint | Date {
  switch (tipoLocal) {
    case "Int":
      return Number(v);
    case "BigInt":
      return BigInt(v);
    case "DateTime":
      return new Date(v);
    case "Decimal":
    case "String":
    default:
      return v;
  }
}

// Substitui (ou insere) o predicado de UM campo dentro de uma lista já salva, preservando os
// demais — usado pela propagação de dimensão (Fase 4): aplicar `codemp = 1` em pedidos-sync
// não pode apagar um predicado que já existisse lá em outro campo (ex.: `SitPed IN (1,2)`),
// e reaplicar a mesma dimensão com outro valor tem que TROCAR o predicado antigo, não empilhar
// os dois (senão `codemp = 1 AND codemp = 2` nunca bate com nada).
export function substituirPredicadoDoCampo(existentes: PredicadoFiltro[], novo: PredicadoFiltro): PredicadoFiltro[] {
  const semOAtual = existentes.filter((p) => p.campo.toLowerCase() !== novo.campo.toLowerCase());
  return [...semOAtual, novo];
}

/** Remove o predicado de um campo específico, preservando os demais. */
export function removerPredicadoDoCampo(existentes: PredicadoFiltro[], campo: string): PredicadoFiltro[] {
  return existentes.filter((p) => p.campo.toLowerCase() !== campo.toLowerCase());
}

/** Recarrega o snapshot inteiro a partir do banco — chamado no boot e após todo salvamento
 * (inclusive a propagação Todos -> Alterados). Até 2 linhas por job agora (Fase 6). */
export async function carregarFiltrosAtivos(jobs: SyncJobDescriptor[]): Promise<void> {
  const linhas = await prisma.filtroSincronizacao.findMany();
  const novo = new Map<string, FiltroResolvido>();
  for (const linha of linhas) {
    const job = jobs.find((j) => j.jobName === linha.jobName);
    if (!job) continue; // job removido/renomeado — filtro órfão, ignora sem quebrar o boot
    const modo = linha.modo === "alterados" ? "alterados" : "todos";
    try {
      novo.set(chaveSnapshot(linha.jobName, modo), await resolverPredicados(job, linha.predicados as unknown as PredicadoFiltro[]));
    } catch (error) {
      // Um filtro salvo pode ficar inválido depois (ex.: o dicionário do Senior mudou) —
      // melhor logar bem alto e seguir sem filtro nesse (job, modo) do que derrubar o
      // carregamento de todos os outros por causa de um só.
      console.error(
        `[filtrosAtivos] filtro salvo de "${linha.jobName}" (modo ${modo}) ficou inválido — ignorado nesta carga:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  snapshot = novo;
}
