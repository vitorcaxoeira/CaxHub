import { runSqlViaSoap } from "../soap/client";
import { modoVarredura, ModoVarredura } from "./politicaVarredura";

// Detecção de registros EXCLUÍDOS no Senior.
//
// Os jobs de sync são upsert-only: quando uma linha é apagada no ERP, o espelho local
// nunca fica sabendo e ela vira um fantasma que continua contando em listagem e KPI.
// Este módulo fecha esse buraco sem nunca apagar nada — só marca `removidoEmSenior`.
//
// COMO FUNCIONA (carimbo por linha, não "marca tudo obsoleto e revalida"):
// todo upsert grava `vistoEmSync = inicio` (o instante em que a execução começou). No
// fim, quem continua com carimbo ANTERIOR a esse instante não veio na consulta — ou
// seja, sumiu da origem. Três motivos pra ser assim e não o flip global:
//
//   1. Os jobs engolem erro (catch -> console.error, sem throw). Se um job morresse
//      depois de marcar tudo como obsoleto e antes de revalidar, a tabela inteira ficaria
//      marcada e a tela zeraria. Com carimbo, job abortado não altera nada.
//   2. Não há lock entre o cron e o disparo manual do painel (jobsEmAndamento em
//      routes/syncErp.ts não é consultado pelo cron.schedule), então duas execuções da
//      mesma tabela podem se sobrepor. Cada uma varre só o que é anterior ao próprio
//      início, então uma não atropela a outra.
//   3. `NULL < x` é NULL em SQL, então linha nunca carimbada nunca é varrida. Isso dá
//      imunidade estrutural (não só por filtro) a registro que nasça no CaxHub e não
//      exista no Senior — irrelevante em Pedido, decisivo em Rat/RatItem/AtividadeConsultor.
export interface ResultadoVarredura {
  /** true só quando `removidoEmSenior` foi de fato gravado (modo "marcar"). */
  executada: boolean;
  modo: ModoVarredura;
  /** Por que não executou, quando executada = false. */
  motivo?: string;
  /** Linhas que sumiram da origem (contadas mesmo em "simular"). */
  candidatos: number;
  /** Quantas foram efetivamente marcadas (0 fora do modo "marcar"). */
  marcados: number;
  /** Linhas vivas no escopo, antes da varredura. */
  totalEscopo: number;
  /** Quantas a origem disse ter, quando houve contagem. */
  linhasOrigem: number | null;
  /** Frase pronta pro campo `message` do SyncLog e pro painel de administração. */
  resumo: string;
}

// Só o que a varredura precisa de um delegate do Prisma (prisma.pedido, prisma.rat, ...).
// Declarado com sintaxe de MÉTODO (`count(args): ...`) e não de propriedade-função
// (`count: (args) => ...`) de propósito: o TypeScript compara parâmetro de método de
// forma bivariante, e é isso que deixa passar o delegate gerado pelo Prisma — com todos
// os overloads dele — sem precisar de `as any` em cada job.
export interface DelegateEspelho<TWhere> {
  count(args: { where: TWhere }): Promise<number>;
  updateMany(args: { where: TWhere; data: { removidoEmSenior: Date } }): Promise<{ count: number }>;
}

export interface OpcoesVarredura<TWhere> {
  jobName: string;
  /**
   * Força o modo, ignorando politicaVarredura.ts. Os jobs NÃO passam isso — o modo deles
   * é decisão de rollout, não de código. Existe para o script de verificação conseguir
   * exercitar o caminho de "marcar" sem ter que promover a tabela em produção.
   */
  modo?: ModoVarredura;
  /** Instante capturado ANTES do primeiro upsert — o mesmo gravado em `vistoEmSync`. */
  inicio: Date;
  /** Linhas processadas nesta execução, já depois de qualquer filtro do próprio job. */
  linhasProcessadas: number;
  /**
   * Delimita o universo consultado e, quando for o caso, exclui registros locais.
   * Obrigatório: um sync parcial (por cliente, por numrat) que varresse a tabela inteira
   * marcaria como removido tudo que ele simplesmente não consultou. `{}` = tabela toda.
   */
  escopo: TWhere;
  /**
   * Consulta que conta as linhas na ORIGEM — mesmo FROM/WHERE do sync, sem ORDER BY.
   * É a guarda principal (ver abaixo). Sem ela, ou sem `contarOrigem`, a varredura no
   * máximo simula: sem saber quanto a origem tinha, não dá pra marcar nada com segurança.
   */
  queryContagemOrigem?: string;
  /** Alternativa injetável a `queryContagemOrigem`, pra testar sem depender do SOAP. */
  contarOrigem?: () => Promise<number>;
  /**
   * Tolerância na comparação origem x processado, como fração da contagem de origem.
   * `deficit` = origem tem MAIS do que processamos (linha que devia ter vindo e não veio:
   * é a assinatura do truncamento, o caso perigoso). `excesso` = processamos mais do que
   * a origem tem agora (o ERP apagou entre a consulta e a contagem: inofensivo, aquelas
   * linhas serão varridas na próxima rodada de qualquer jeito).
   */
  folgaContagem?: { deficit: number; excesso: number };
  /** Teto de remoções por execução; acima disso não marca nada e alerta. */
  teto?: { pct: number; minimo: number };
  /** Linhas que ESTE run deixou de processar por motivo técnico (ex.: FK não resolvida). */
  puladas?: number;
}

// Proporcional, sem piso absoluto: em tabela grande dá uma folga pequena pra escrita
// concorrente no ERP (0,1% de 12 mil = 12 linhas), e em tabela pequena fica praticamente
// zero — que é o certo, porque ali qualquer linha faltando já é sinal de problema. Um
// piso absoluto (ex.: "tolere até 50") deixaria passar justamente o truncamento pequeno.
const FOLGA_PADRAO = { deficit: 0.001, excesso: 0.05 };
const TETO_PADRAO = { pct: 0.02, minimo: 50 };

/** Bloco que todo upsert de sync espalha no `data`, em create e update. */
export function carimbo(inicio: Date) {
  // `removidoEmSenior: null` no update é o que faz a "ressurreição": se a linha reaparece
  // no Senior depois de ter sido marcada, ela volta a ser viva sozinha, sem intervenção.
  return { vistoEmSync: inicio, removidoEmSenior: null as Date | null };
}

export async function varrerRemovidos<TWhere extends object>(
  delegate: DelegateEspelho<TWhere>,
  opcoes: OpcoesVarredura<TWhere>
): Promise<ResultadoVarredura> {
  const modo = opcoes.modo ?? modoVarredura(opcoes.jobName);
  const escopoCom = (extra: object) => ({ ...opcoes.escopo, ...extra } as TWhere);
  const naoExecutou = (motivo: string, extras: Partial<ResultadoVarredura> = {}): ResultadoVarredura => ({
    executada: false,
    modo,
    motivo,
    candidatos: 0,
    marcados: 0,
    totalEscopo: 0,
    linhasOrigem: null,
    resumo: `varredura não rodou (${motivo})`,
    ...extras,
  });

  if (modo === "desligada") return naoExecutou("desligada por política");

  // Linha pulada é linha não carimbada — viraria falso positivo, com o agravante de o
  // motivo ser técnico (ordem de execução dos jobs), não uma exclusão real. Melhor não
  // varrer este run inteiro do que marcar registro que existe no Senior.
  if (opcoes.puladas && opcoes.puladas > 0) {
    return naoExecutou(`${opcoes.puladas} linha(s) pulada(s) por motivo técnico neste run`);
  }

  // GUARDA 1 (principal): a origem confirma quantas linhas deveriam ter vindo?
  //
  // Sem isso a varredura é perigosa, porque hoje o SOAP falha em silêncio: runSqlViaSoap
  // devolve [] sem erro quando o payload não vem (soap/client.ts), e runSqlViaSoapPaginated
  // encerra o laço em `page.length < pageSize` — uma página vazia por falha transitória
  // termina a paginação com dado parcial e o job ainda grava status "success". Sem esta
  // conferência, esse cenário marcaria como removido tudo que faltou vir.
  let linhasOrigem: number | null = null;
  if (opcoes.queryContagemOrigem || opcoes.contarOrigem) {
    try {
      linhasOrigem = opcoes.contarOrigem
        ? await opcoes.contarOrigem()
        : Number(((await runSqlViaSoap(opcoes.queryContagemOrigem as string)) as { total: number }[])?.[0]?.total);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return naoExecutou(`falha ao contar na origem: ${message}`);
    }
    if (!Number.isFinite(linhasOrigem)) return naoExecutou("contagem de origem inválida");

    const folga = opcoes.folgaContagem ?? FOLGA_PADRAO;
    const total = linhasOrigem as number;
    const diferenca = total - opcoes.linhasProcessadas;

    // Faltou linha: é a assinatura do truncamento silencioso. Marcar aqui esconderia da
    // tela justamente o que não conseguimos ler.
    if (diferenca > total * folga.deficit) {
      return naoExecutou(
        `origem tem ${total} linha(s) e só ${opcoes.linhasProcessadas} foram processadas — ` +
          `resposta do SOAP provavelmente truncada, nada foi marcado`,
        { linhasOrigem }
      );
    }
    // Sobrou linha muito além do esperado: não é perigoso pra varredura, mas indica que a
    // consulta de contagem não tem o mesmo recorte da consulta principal — erro de código
    // que desativaria a guarda na prática.
    if (-diferenca > total * folga.excesso + 1) {
      return naoExecutou(
        `foram processadas ${opcoes.linhasProcessadas} linha(s) mas a origem só tem ${total} — ` +
          `a consulta de contagem provavelmente não bate com a do sync`,
        { linhasOrigem }
      );
    }
  } else if (modo === "marcar") {
    return naoExecutou("sem contagem na origem — só é possível simular");
  }

  const totalEscopo = await delegate.count({ where: escopoCom({ removidoEmSenior: null }) });
  const whereCandidatos = escopoCom({ vistoEmSync: { lt: opcoes.inicio }, removidoEmSenior: null });
  const candidatos = await delegate.count({ where: whereCandidatos });

  // GUARDA 2 (secundária): teto do que se pode esconder de uma vez. Exclusão em massa
  // real existe, mas tem que passar por conferência humana — nunca acontecer sozinha às
  // 4 da manhã.
  const teto = opcoes.teto ?? TETO_PADRAO;
  const limite = Math.max(teto.minimo, Math.floor(totalEscopo * teto.pct));
  if (candidatos > limite) {
    return naoExecutou(
      `${candidatos} candidato(s) acima do teto de ${limite} (${totalEscopo} vivos no escopo) — ` +
        `nada marcado, conferir manualmente`,
      { candidatos, totalEscopo, linhasOrigem }
    );
  }

  if (modo === "simular") {
    return {
      executada: false,
      modo,
      motivo: "simulação",
      candidatos,
      marcados: 0,
      totalEscopo,
      linhasOrigem,
      resumo: `varredura SIMULADA: ${candidatos} sumiu(sumiram) do Senior (de ${totalEscopo}), nada marcado`,
    };
  }

  const { count } = await delegate.updateMany({
    where: whereCandidatos,
    data: { removidoEmSenior: new Date() },
  });

  return {
    executada: true,
    modo,
    candidatos,
    marcados: count,
    totalEscopo,
    linhasOrigem,
    resumo: `varredura: ${count} marcado(s) como removido(s) no Senior (de ${totalEscopo})`,
  };
}
