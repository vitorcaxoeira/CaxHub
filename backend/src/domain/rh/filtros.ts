import { Prisma } from "@prisma/client";
import { Request } from "express";

// Filtro único das telas de RH. Os mesmos parâmetros valem para todas (a tela guarda e reenvia):
//   de / ate     período (AAAA-MM-DD). Padrão: os 12 meses fechados até hoje.
//   empresa      numemp
//   filial       codfil
//   tipcol       lista (1 Empregado, 2 Terceiro, 3 Parceiro), separada por vírgula
//   ccu          centro de custo (codccu)
//   local        numloc
//   cargo        "estcar:codcar"
// Os atributos do colaborador (centro de custo, local, cargo, filial) são os ATUAIS do cadastro.
// O histórico existe (hcm_historico_*), mas fatiar o passado pelo histórico muda o número de acordo
// com a data, e a tela precisa mostrar o mesmo total em qualquer recorte.

export interface FiltroRh {
  de: string;
  ate: string;
  empresa?: number;
  filial?: number;
  tipcol?: number[];
  /** true quando `tipcol` veio do padrão da tela (ex.: só empregados), não de uma escolha do usuário. */
  tipcolImplicito?: boolean;
  ccu?: string;
  local?: number;
  cargo?: { estcar: number; codcar: string };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isoValido(v: unknown): v is string {
  if (typeof v !== "string" || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function inteiro(v: unknown): number | undefined {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}

export function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function somarMeses(iso: string, meses: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

export function primeiroDiaDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Lê o filtro da query string. Valor inválido é ignorado (cai no padrão), nunca vira SQL.
 * `tipcolPadrao`: recorte de tipo de colaborador que a tela aplica quando o usuário não escolheu um
 * (ponto, absenteísmo e férias medem empregados: terceiros e parceiros não seguem a jornada CLT). */
export function lerFiltro(req: Request, tipcolPadrao?: number[]): FiltroRh {
  const q = req.query;
  const hoje = hojeIso();
  const ate = isoValido(q.ate) ? q.ate : hoje;
  // Padrão: 12 meses terminando no mês de `ate` (do dia 1 de 11 meses antes até `ate`).
  const de = isoValido(q.de) ? q.de : primeiroDiaDoMes(somarMeses(ate, -11));
  const f: FiltroRh = { de: de <= ate ? de : ate, ate };
  const empresa = inteiro(q.empresa);
  if (empresa !== undefined) f.empresa = empresa;
  const filial = inteiro(q.filial);
  if (filial !== undefined) f.filial = filial;
  if (typeof q.tipcol === "string" && q.tipcol.trim()) {
    const lista = q.tipcol.split(",").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 9);
    if (lista.length) f.tipcol = lista;
  }
  if (!f.tipcol && tipcolPadrao) {
    f.tipcol = tipcolPadrao;
    f.tipcolImplicito = true;
  }
  if (typeof q.ccu === "string" && /^[A-Za-z0-9._-]{1,18}$/.test(q.ccu)) f.ccu = q.ccu;
  const local = inteiro(q.local);
  if (local !== undefined) f.local = local;
  if (typeof q.cargo === "string") {
    const m = /^(\d{1,5}):([A-Za-z0-9._-]{1,12})$/.exec(q.cargo);
    if (m) f.cargo = { estcar: Number(m[1]), codcar: m[2] };
  }
  return f;
}

/** Condições (AND) sobre a tabela de colaboradores de alias `c`. Sempre retorna um fragmento
 * válido (`TRUE` quando não há filtro de cadastro). O período fica por conta de cada tela. */
export function condicoesColaborador(f: FiltroRh, alias = "c"): Prisma.Sql {
  const a = Prisma.raw(alias);
  const partes: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.empresa !== undefined) partes.push(Prisma.sql`${a}.numemp = ${f.empresa}`);
  if (f.filial !== undefined) partes.push(Prisma.sql`${a}.codfil = ${f.filial}`);
  if (f.tipcol) partes.push(Prisma.sql`${a}.tipcol IN (${Prisma.join(f.tipcol)})`);
  if (f.ccu !== undefined) partes.push(Prisma.sql`${a}.codccu = ${f.ccu}`);
  if (f.local !== undefined) partes.push(Prisma.sql`${a}.numloc = ${f.local}`);
  if (f.cargo) partes.push(Prisma.sql`${a}.estcar = ${f.cargo.estcar} AND ${a}.codcar = ${f.cargo.codcar}`);
  return Prisma.join(partes, " AND ");
}

/** Quem vê nome e valor individual. Hoje só o admin chega às rotas de RH (routes/rh/index.ts), e ele vê
 * tudo. A supressão de grupos pequenos (comum.ts, GRUPO_MINIMO) continua no cálculo das telas para o dia em
 * que existir um papel que veja só o agregado: bastaria esta função devolver false para ele. */
export function veIndividual(_req: Request): boolean {
  return true;
}

/** Menor grupo que um papel só-agregado poderia ver: abaixo disso o número identificaria a pessoa (ex.: o
 * salário médio de um cargo com 1 ocupante é o salário dele). Quem vê o individual não tem supressão. */
export const GRUPO_MINIMO = 3;
