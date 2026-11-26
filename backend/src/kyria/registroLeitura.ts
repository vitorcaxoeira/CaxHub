// Registro das leituras do Kyria (25/11/2026, adaptado do controle de leituras do CaxHub_Dash): cada execução de um job com `comLeitura` vira uma
// linha em `kyria_leituras`, e cada chamada HTTP à API (inclusive a tentativa que levou 429 ou falhou) uma linha em `kyria_leituras_paginas`.
// Só registro: quem retoma uma carga parada é o cursor do próprio job (feed de apontamentos: `kyria_sync_cursor`); aqui a tela mostra até
// onde a leitura chegou (`ultimoCursor`).
//
// Tudo aqui é acessório à sincronização: qualquer falha de gravação vira console.warn e o job segue sem registro, nunca cai por isso.
import cron from "node-cron";
import { prisma } from "../db/prisma";
import { LIMITE_MAXIMO_KYRIA, TIMEOUT_KYRIA_MS } from "./client";

export const RETENCAO_LEITURAS_DIAS = 30;

function avisar(acao: string, erro: unknown): void {
  console.warn(`[leituras-kyria] falha ao ${acao} (a sincronização segue sem registro):`, erro instanceof Error ? erro.message : erro);
}

/** Itens de uma resposta do Kyria: lista paginada (`data: []`) ou relatório agregado (`data.rows`). */
export function linhasDaResposta(corpo: unknown): number {
  const dados = (corpo as { data?: unknown } | null | undefined)?.data;
  if (Array.isArray(dados)) return dados.length;
  const rows = (dados as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) ? rows.length : 0;
}

/** Tamanho da resposta em KB: usa o Content-Length quando a API manda; senão mede o JSON recebido. */
export function kbDaResposta(corpo: unknown, contentLength?: unknown): number {
  const cabecalho = Number(contentLength);
  const bytes = Number.isFinite(cabecalho) && cabecalho > 0 ? cabecalho : Buffer.byteLength(JSON.stringify(corpo ?? ""), "utf8");
  return Math.max(0, Math.round(bytes / 1024));
}

export interface DadosChamada {
  disparadaEm: Date;
  cursor: string | null;
  proximoCursor: string | null;
  limite: number | null;
  linhas: number;
  kb: number;
  msKyria: number;
  tentativa: number;
  httpStatus: number | null;
  esperaS: number | null;
  status: "ok" | "erro";
  requestId: string | null;
  erro: string | null;
}

/** Uma leitura em curso, com o id do registro (ou null quando o registro não pôde ser criado: a leitura segue sem log). */
export class LeituraKyria {
  constructor(
    readonly id: number | null,
    readonly jobName: string
  ) {}

  /** Grava uma chamada à API e, se foi bem-sucedida, soma página, linhas e o último cursor na leitura. */
  async registrarChamada(d: DadosChamada): Promise<void> {
    if (this.id == null) return;
    try {
      await prisma.kyriaLeituraPagina.create({ data: { leituraId: this.id, jobName: this.jobName, ...d, erro: d.erro ? d.erro.slice(0, 500) : null } });
      await prisma.kyriaLeitura.update({
        where: { id: this.id },
        data: {
          atualizadaEm: new Date(),
          ...(d.status === "ok" ? { paginas: { increment: 1 }, linhas: { increment: d.linhas }, ...(d.proximoCursor ? { ultimoCursor: d.proximoCursor } : {}) } : {}),
        },
      });
    } catch (erro) {
      avisar("gravar a chamada", erro);
    }
  }

  async finalizar(status: "concluida" | "falhou", erro?: unknown): Promise<void> {
    if (this.id == null) return;
    try {
      const mensagem = erro == null ? null : (erro instanceof Error ? erro.message : String(erro)).slice(0, 1000);
      await prisma.kyriaLeitura.update({ where: { id: this.id }, data: { status, finalizadaEm: new Date(), atualizadaEm: new Date(), erro: mensagem } });
    } catch (e) {
      avisar("finalizar a leitura", e);
    }
  }
}

export interface AbrirLeitura {
  jobName: string;
  /** Caminho do recurso na API (ex.: "/tickets"). */
  recurso: string;
  /** Itens por página pedidos; nulo nos relatórios (não paginam). */
  limite: number | null;
}

export async function abrirLeitura(a: AbrirLeitura): Promise<LeituraKyria> {
  try {
    const criada = await prisma.kyriaLeitura.create({ data: { jobName: a.jobName, recurso: a.recurso, limite: a.limite, timeoutMs: TIMEOUT_KYRIA_MS }, select: { id: true } });
    return new LeituraKyria(criada.id, a.jobName);
  } catch (erro) {
    avisar("abrir o registro da leitura", erro);
    return new LeituraKyria(null, a.jobName);
  }
}

/**
 * Roda `fn` dentro de uma leitura registrada: abre o registro, entrega a `leitura` para o client (que grava cada chamada) e fecha como concluída
 * ou falhou (o erro continua subindo, o job decide o que fazer com ele). `paginado: false` nos relatórios, que não têm `limit`.
 */
export async function comLeitura<T>(opcoes: { jobName: string; recurso: string; paginado?: boolean }, fn: (leitura: LeituraKyria) => Promise<T>): Promise<T> {
  const leitura = await abrirLeitura({ jobName: opcoes.jobName, recurso: opcoes.recurso, limite: opcoes.paginado === false ? null : LIMITE_MAXIMO_KYRIA });
  try {
    const resultado = await fn(leitura);
    await leitura.finalizar("concluida");
    return resultado;
  } catch (erro) {
    await leitura.finalizar("falhou", erro);
    throw erro;
  }
}

/** Boot: leitura que ficou "em_andamento" é de um processo que caiu (deploy, restart, falta de memória): vira "interrompida". */
export async function marcarLeiturasInterrompidas(): Promise<number> {
  try {
    const r = await prisma.kyriaLeitura.updateMany({ where: { status: "em_andamento" }, data: { status: "interrompida", finalizadaEm: new Date() } });
    return r.count;
  } catch (erro) {
    avisar("marcar as leituras interrompidas", erro);
    return 0;
  }
}

/**
 * Limpeza pela tela (só admin): apaga as leituras (e, em cascata, as chamadas) da tabela ou de todas, MENOS a que está em andamento. Nunca toca
 * no SyncLog (o histórico de sincronizações) nem no cursor do feed (`kyria_sync_cursor`, de onde o job retoma).
 */
export async function limparLeituras(where: { jobName?: string }): Promise<{ leiturasApagadas: number; chamadasApagadas: number }> {
  const alvo = { ...where, status: { not: "em_andamento" } };
  const chamadas = await prisma.kyriaLeituraPagina.count({ where: { leitura: alvo } });
  const leituras = await prisma.kyriaLeitura.deleteMany({ where: alvo });
  return { leiturasApagadas: leituras.count, chamadasApagadas: chamadas };
}

/** Retenção diária: some o que passou de 30 dias, menos a leitura em andamento. */
export async function limparLeiturasAntigas(dias: number = RETENCAO_LEITURAS_DIAS): Promise<{ leiturasApagadas: number }> {
  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const r = await prisma.kyriaLeitura.deleteMany({ where: { iniciadaEm: { lt: corte }, status: { not: "em_andamento" } } });
  return { leiturasApagadas: r.count };
}

/** No boot: o que ficou "em andamento" de um processo que caiu vira "interrompida" e a retenção de 30 dias roda todo dia às 02:50 (São Paulo). */
export function agendarRegistroDeLeituras(): void {
  marcarLeiturasInterrompidas()
    .then((n) => n > 0 && console.log(`[leituras-kyria] ${n} leitura(s) interrompida(s) por queda do processo`))
    .catch(() => undefined);
  cron.schedule(
    "50 2 * * *",
    () => {
      limparLeiturasAntigas()
        .then((r) => r.leiturasApagadas > 0 && console.log(`[leituras-kyria] retenção: ${r.leiturasApagadas} leitura(s) com mais de ${RETENCAO_LEITURAS_DIAS} dias apagadas`))
        .catch((e) => console.warn("[leituras-kyria] retenção falhou:", e instanceof Error ? e.message : e));
    },
    { timezone: "America/Sao_Paulo" }
  );
}
