import { Prisma } from "@prisma/client";
import type { ColunaConsulta } from "./consultaColunas";

// Declaração de colunas da subconsulta `x` das listas de servidor (routes/listaConsultavel.ts). Mora aqui, sem banco, para o catálogo de campos
// relacionados (camposRelacionados.ts) montar colunas com a MESMA regra (data pelo dia de Brasília) sem importar uma rota.

const ref = (nome: string) => Prisma.raw(`x."${nome}"`);
const DIA_BRT = (nome: string) => Prisma.raw(`(x."${nome}"::timestamp AT TIME ZONE 'America/Sao_Paulo')`);

export type OpcoesColuna = Pick<ColunaConsulta, "obrigatoria" | "semValores" | "dominio" | "titulo" | "fonte">;

/** Colunas da subconsulta `x`: a expressão é sempre o próprio nome da coluna exposta pela consulta interna. */
export const col = {
  texto: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "texto", expr: ref(nome), ...o }),
  inteiro: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "inteiro", expr: ref(nome), ...o }),
  decimal: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "decimal", expr: ref(nome), ...o }),
  booleano: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "booleano", expr: ref(nome), ...o }),
  /** Data (date ou timestamp): compara pelo dia de Brasília, como as outras listas. */
  data: (nome: string, o: OpcoesColuna = {}): ColunaConsulta => ({ nome, tipo: "data", expr: DIA_BRT(nome), ...o }),
};
